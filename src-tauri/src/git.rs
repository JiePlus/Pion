//! Git for the open workspace: read-only status/diff for the plugin API
//! (`workspace.git`) and the Core review pane (scoped diffs, staging, commit,
//! push, pull requests).
//!
//! Every command is workspace-scoped: it runs with the workspace as its working
//! directory, paths must be relative and stay inside the workspace, and output
//! is bounded. Read commands never take repository locks (`GIT_OPTIONAL_LOCKS=0`),
//! and no command may block on a terminal prompt or an editor.

use crate::workspace;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const MAX_STATUS_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIFF_BYTES: usize = 512 * 1024;
const MAX_UNTRACKED_BYTES: u64 = 256 * 1024;
const MAX_FILES: usize = 5000;

struct Branch {
    name: String,
    detached: bool,
    ahead: u64,
    behind: u64,
}

fn run(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("--no-pager")
        .args(["-c", "core.quotepath=false"])
        .args(["-c", "core.fsmonitor=false"])
        .args(args);
    command
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
    command
        .output()
        .map_err(|error| format!("Could not run git: {error}"))
}

fn is_repo(root: &Path) -> Result<bool, String> {
    let output = run(root, &["rev-parse", "--is-inside-work-tree"])?;
    if !output.status.success() {
        return Ok(false);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn branch_info(root: &Path) -> Branch {
    let name = run(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    let detached = name.is_empty() || name == "HEAD";
    let (mut ahead, mut behind) = (0, 0);
    if !detached {
        if let Ok(output) = run(
            root,
            &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        ) {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut parts = text.split_whitespace();
                behind = parts
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                ahead = parts
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
            }
        }
    }
    Branch {
        name,
        detached,
        ahead,
        behind,
    }
}

fn parse_porcelain(bytes: &[u8]) -> Vec<Value> {
    let mut files = Vec::new();
    let mut tokens = bytes.split(|byte| *byte == 0);
    while let Some(token) = tokens.next() {
        if token.len() < 3 {
            continue;
        }
        let index = token[0] as char;
        let worktree = token[1] as char;
        let path = String::from_utf8_lossy(&token[3..]).to_string();
        // Rename/copy entries append the original path as the next NUL-separated token.
        if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            let _ = tokens.next();
        }
        files.push(
            json!({ "path": path, "index": index.to_string(), "worktree": worktree.to_string() }),
        );
        if files.len() >= MAX_FILES {
            break;
        }
    }
    files
}

pub fn status(root: &Path) -> Result<Value, String> {
    if !is_repo(root)? {
        return Ok(json!({ "repo": false, "clean": true, "files": [] }));
    }
    let branch = branch_info(root);
    let output = run(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )?;
    if output.stdout.len() > MAX_STATUS_BYTES {
        return Err("Git status output is too large".into());
    }
    let files = parse_porcelain(&output.stdout);
    Ok(json!({
        "repo": true,
        "branch": branch.name,
        "detached": branch.detached,
        "ahead": branch.ahead,
        "behind": branch.behind,
        "clean": files.is_empty(),
        "files": files,
    }))
}

fn truncate(mut text: String, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text, false);
    }
    let mut cut = limit;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    (text, true)
}

fn untracked_diff(root: &Path, path: &str) -> Result<Option<Value>, String> {
    // `git ls-files --error-unmatch` fails when the path is not tracked, which
    // is exactly when `git diff` prints nothing but the file still has content.
    let tracked = run(root, &["ls-files", "--error-unmatch", "--", path])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if tracked {
        return Ok(None);
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve workspace: {error}"))?;
    let file = match workspace::within(&canonical_root, path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    if !file.is_file() {
        return Ok(None);
    }
    let mut content = match workspace::bounded_read(&file, MAX_UNTRACKED_BYTES) {
        Ok(content) => content,
        // Binary or unreadable files are still untracked, but there is no text
        // diff to render; report them as binary instead of failing the request.
        Err(_) => {
            return Ok(Some(json!({
                "path": path, "staged": false, "binary": true, "truncated": false, "diff": ""
            })));
        }
    };
    let mut truncated = false;
    if content.len() as u64 >= MAX_UNTRACKED_BYTES {
        content = content
            .chars()
            .take(MAX_UNTRACKED_BYTES as usize)
            .collect::<String>();
        truncated = true;
    }
    let normalised = content.replace("\r\n", "\n");
    let body = normalised.strip_suffix('\n').unwrap_or(&normalised);
    let count = if body.is_empty() {
        0
    } else {
        body.lines().count()
    };
    let mut diff = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n"
    );
    for line in body.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if truncated {
        diff.push_str("\\ No newline at end of truncated file\n");
    }
    Ok(Some(json!({
        "path": path, "staged": false, "binary": false, "truncated": truncated, "diff": diff
    })))
}

pub fn diff(root: &Path, path: &str, staged: bool) -> Result<Value, String> {
    let relative = workspace::relative(path)?;
    let path = relative.to_string_lossy().to_string();
    if !is_repo(root)? {
        return Err("Workspace is not a Git repository".into());
    }
    let mut args = vec!["diff", "-M", "--no-color", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&path);
    let output = run(root, &args)?;
    if !output.status.success() {
        return Err(format!(
            "git diff failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        if !staged {
            if let Some(diff) = untracked_diff(root, &path)? {
                return Ok(diff);
            }
        }
        return Ok(json!({
            "path": path, "staged": staged, "binary": false, "truncated": false, "diff": ""
        }));
    }
    let binary = text.contains("Binary files ") || text.contains("GIT binary patch");
    let (text, truncated) = truncate(text, MAX_DIFF_BYTES);
    Ok(json!({
        "path": path, "staged": staged, "binary": binary, "truncated": truncated, "diff": text
    }))
}


// ---------------------------------------------------------------------------
// Review pane (Core): scoped diffs, file/hunk staging, commit, push, pull
// requests and branches. These are host operations, not plugin API. The host
// drops its shared state lock while they run, and every command is bounded by
// a timeout and can never wait on a terminal prompt or an editor.
// ---------------------------------------------------------------------------

const LOCAL_TIMEOUT: Duration = Duration::from_secs(20);
const REMOTE_TIMEOUT: Duration = Duration::from_secs(90);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PATHS: usize = 500;
const MAX_MESSAGE: usize = 10_000;
const MAX_REPORT: usize = 4_000;
const MAX_REVIEW_BYTES: usize = 2 * 1024 * 1024;
const MAX_REVIEW_UNTRACKED: usize = 100;
const MAX_BRANCHES: usize = 200;
/// Review diffs and hunk patches must use identical flags so a hunk the pane
/// shows can be found again byte-for-byte when it is staged or reverted.
const DIFF: &[&str] = &[
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-U3",
];

struct Exec {
    stdout: String,
    stderr: String,
    truncated: bool,
}

fn git_command(root: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .arg("--no-pager")
        .arg("--literal-pathspecs")
        .args(["-c", "core.quotepath=false"])
        .args(["-c", "core.fsmonitor=false"])
        .args(args);
    prepare(&mut command, root);
    command
}

fn prepare(command: &mut Command, root: &Path) {
    command
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("GH_PROMPT_DISABLED", "1")
        .env("LC_ALL", "C");
    // A GUI process has no terminal; make SSH fail fast instead of waiting for a passphrase.
    if std::env::var_os("GIT_SSH_COMMAND").is_none() && std::env::var_os("GIT_SSH").is_none() {
        command.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
}

/// Reads a pipe to the end (so the child never blocks on a full pipe) but keeps
/// at most `limit` bytes.
fn drain<R: Read + Send + 'static>(mut pipe: R, limit: usize) -> JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut overflow = false;
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let room = limit.saturating_sub(kept.len());
                    if read > room {
                        overflow = true;
                    }
                    kept.extend_from_slice(&buffer[..read.min(room)]);
                }
            }
        }
        (kept, overflow)
    })
}

fn exec(
    mut command: Command,
    label: &str,
    input: Option<&str>,
    timeout: Duration,
    limit: usize,
) -> Result<Exec, String> {
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not run {label}: {error}"))?;
    if let Some(text) = input {
        if let Some(mut stdin) = child.stdin.take() {
            // A write error means the child already exited; its status explains why.
            let _ = stdin.write_all(text.as_bytes());
        }
    }
    let stdout = drain(child.stdout.take().ok_or("stdout is unavailable")?, limit);
    let stderr = drain(child.stderr.take().ok_or("stderr is unavailable")?, MAX_REPORT * 4);
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                // Readers stay detached: a grandchild (ssh, a hook) may still hold the pipes.
                return Err(format!(
                    "{label} timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(15)),
        }
    };
    let (out, truncated) = stdout.join().unwrap_or_default();
    let (err, _) = stderr.join().unwrap_or_default();
    let result = Exec {
        stdout: String::from_utf8_lossy(&out).to_string(),
        stderr: String::from_utf8_lossy(&err).to_string(),
        truncated,
    };
    if !status.success() {
        let detail = if result.stderr.trim().is_empty() {
            result.stdout.trim()
        } else {
            result.stderr.trim()
        };
        return Err(format!(
            "{label} failed: {}",
            truncate(detail.to_string(), MAX_REPORT).0
        ));
    }
    Ok(result)
}

fn git(root: &Path, args: &[&str]) -> Result<Exec, String> {
    let label = format!("git {}", args.first().copied().unwrap_or(""));
    exec(git_command(root, args), &label, None, LOCAL_TIMEOUT, MAX_REVIEW_BYTES)
}

fn git_with(
    root: &Path,
    args: &[&str],
    input: Option<&str>,
    timeout: Duration,
) -> Result<Exec, String> {
    let label = format!("git {}", args.first().copied().unwrap_or(""));
    exec(git_command(root, args), &label, input, timeout, MAX_REVIEW_BYTES)
}

fn report(exec: Exec) -> String {
    let combined = [exec.stdout.trim(), exec.stderr.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    truncate(combined, MAX_REPORT).0
}

fn done(exec: Exec) -> Result<Value, String> {
    Ok(json!({ "ok": true, "output": report(exec) }))
}

/// Dispatches a `git.*` host operation. `turn` is the worktree tree captured
/// when the active task's latest prompt was sent, if any.
pub fn call(root: &Path, op: &str, args: &Value, turn: Option<&str>) -> Result<Value, String> {
    if op == "git.init" {
        return done(git(root, &["init"])?);
    }
    if op == "git.summary" {
        return summary(root);
    }
    if !is_repo(root)? {
        return Err("Workspace is not a Git repository".into());
    }
    match op {
        "git.review" => review(root, args["scope"].as_str().unwrap_or("unstaged"), turn),
        "git.stage" => done(git(root, &with_paths(&["add", "-A"], &paths(args)?))?),
        "git.unstage" => unstage(root, &paths(args)?),
        "git.revert" => revert(root, &paths(args)?),
        "git.hunk" => hunk(
            root,
            args["action"].as_str().ok_or("Missing action")?,
            args["path"].as_str().ok_or("Missing path")?,
            args["hunk"].as_str().ok_or("Missing hunk")?,
        ),
        "git.commit" => commit(
            root,
            args["message"].as_str().ok_or("Missing message")?,
            args["includeUnstaged"].as_bool().unwrap_or(false),
            args["then"].as_str().unwrap_or("commit"),
        ),
        "git.push" => Ok(json!({ "ok": true, "output": push(root)? })),
        "git.pr" => create_pr(root).map(|url| json!({ "ok": true, "prUrl": url })),
        "git.fetch" => done(git_with(root, &["fetch", "--prune"], None, REMOTE_TIMEOUT)?),
        "git.pull" => done(git_with(
            root,
            &["pull", "--ff-only", "--no-rebase"],
            None,
            REMOTE_TIMEOUT,
        )?),
        "git.branches" => branches(root),
        "git.checkout" => {
            let branch = args["branch"].as_str().ok_or("Missing branch")?;
            valid_branch(root, branch)?;
            done(git(root, &["switch", branch])?)
        }
        "git.createBranch" => {
            let name = args["name"].as_str().ok_or("Missing name")?;
            valid_branch(root, name)?;
            done(git(root, &["switch", "-c", name])?)
        }
        _ => Err("Unknown Git operation".into()),
    }
}

fn paths(args: &Value) -> Result<Vec<String>, String> {
    let list = args["paths"].as_array().ok_or("Missing paths")?;
    if list.is_empty() || list.len() > MAX_PATHS {
        return Err(format!("Expected 1 to {MAX_PATHS} paths"));
    }
    list.iter()
        .map(|value| -> Result<String, String> {
            let path = value.as_str().ok_or("Invalid path")?;
            if path == "." {
                return Ok(".".to_string());
            }
            Ok(workspace::relative(path)?.to_string_lossy().to_string())
        })
        .collect()
}

fn with_paths<'a>(args: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut all = args.to_vec();
    all.push("--");
    all.extend(paths.iter().map(String::as_str));
    all
}

fn has_head(root: &Path) -> bool {
    run(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn has_upstream(root: &Path) -> bool {
    run(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn remotes(root: &Path) -> Vec<String> {
    run(root, &["remote"])
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_string)
        .collect()
}

fn summary(root: &Path) -> Result<Value, String> {
    if !is_repo(root)? {
        return Ok(json!({ "repo": false }));
    }
    let branch = branch_info(root);
    let mut numstat = Vec::new();
    if has_head(root) {
        numstat.push(git(root, &["diff", "--numstat", "HEAD"])?.stdout);
    } else {
        numstat.push(git(root, &["diff", "--numstat", "--cached"])?.stdout);
        numstat.push(git(root, &["diff", "--numstat"])?.stdout);
    }
    let (mut additions, mut deletions, mut files) = (0u64, 0u64, 0u64);
    for line in numstat.iter().flat_map(|text| text.lines()) {
        let mut parts = line.split('\t');
        additions += parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        deletions += parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        files += 1;
    }
    let untracked = git(root, &["ls-files", "--others", "--exclude-standard", "-z"])?
        .stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .count() as u64;
    Ok(json!({
        "repo": true,
        "branch": branch.name,
        "detached": branch.detached,
        "ahead": branch.ahead,
        "behind": branch.behind,
        "additions": additions,
        "deletions": deletions,
        "files": files + untracked,
    }))
}

/// The branch to compare against for the "branch" scope: the remote default
/// branch when known, otherwise a conventional main branch.
fn base_ref(root: &Path) -> Option<String> {
    let current = branch_info(root).name;
    if let Ok(output) = run(root, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !name.is_empty() {
            return Some(name);
        }
    }
    ["origin/main", "origin/master", "main", "master"]
        .into_iter()
        .filter(|name| *name != current)
        .find(|name| {
            run(root, &["rev-parse", "--verify", "--quiet", *name])
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
        .map(str::to_string)
}

/// Writes the current worktree (tracked and non-ignored untracked files) as a
/// tree object using a throwaway index, leaving the real index untouched.
pub fn snapshot(root: &Path) -> Result<String, String> {
    if !is_repo(root)? {
        return Err("Workspace is not a Git repository".into());
    }
    let index = git(root, &["rev-parse", "--git-path", "index"])?
        .stdout
        .trim()
        .to_string();
    let index = root.join(index);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let temp = std::env::temp_dir().join(format!(
        "pion-snapshot-{}-{nonce}.index",
        std::process::id()
    ));
    if index.is_file() {
        // Starting from the real index keeps stat data, so unchanged files are not rehashed.
        let _ = std::fs::copy(&index, &temp);
    }
    let temp_path = temp.to_string_lossy().to_string();
    let result = (|| {
        let mut add = git_command(root, &["add", "-A", "--", "."]);
        add.env("GIT_INDEX_FILE", &temp_path);
        exec(add, "git add", None, SNAPSHOT_TIMEOUT, MAX_REPORT)?;
        let mut write = git_command(root, &["write-tree"]);
        write.env("GIT_INDEX_FILE", &temp_path);
        let tree = exec(write, "git write-tree", None, SNAPSHOT_TIMEOUT, MAX_REPORT)?;
        Ok::<String, String>(tree.stdout.trim().to_string())
    })();
    let _ = std::fs::remove_file(&temp);
    result
}

fn review(root: &Path, scope: &str, turn: Option<&str>) -> Result<Value, String> {
    let state = status(root)?;
    let files = state["files"].as_array().cloned().unwrap_or_default();
    let (mut staged, mut unstaged) = (0, 0);
    for file in &files {
        let index = file["index"].as_str().unwrap_or(" ");
        if index != " " && index != "?" {
            staged += 1;
        }
        if file["worktree"].as_str().unwrap_or(" ") != " " {
            unstaged += 1;
        }
    }
    let mut base = Value::Null;
    let mut diff = String::new();
    let mut truncated = false;
    match scope {
        "unstaged" => {
            let output = git(root, DIFF)?;
            truncated = output.truncated;
            diff = output.stdout;
            let untracked = files
                .iter()
                .filter(|file| file["index"] == json!("?"))
                .filter_map(|file| file["path"].as_str())
                .take(MAX_REVIEW_UNTRACKED);
            for path in untracked {
                if diff.len() >= MAX_REVIEW_BYTES {
                    truncated = true;
                    break;
                }
                match untracked_diff(root, path)? {
                    Some(value) if value["binary"] == json!(true) => diff.push_str(&format!(
                        "diff --git a/{path} b/{path}\nnew file mode 100644\nBinary files /dev/null and b/{path} differ\n"
                    )),
                    Some(value) => diff.push_str(value["diff"].as_str().unwrap_or("")),
                    None => {}
                }
            }
        }
        "staged" => {
            let mut args = DIFF.to_vec();
            args.extend(["--cached", "-M"]);
            let output = git(root, &args)?;
            truncated = output.truncated;
            diff = output.stdout;
        }
        "branch" => {
            if let Some(name) = base_ref(root) {
                let merge_base = git(root, &["merge-base", "HEAD", name.as_str()])?
                    .stdout
                    .trim()
                    .to_string();
                let mut args = DIFF.to_vec();
                args.extend(["-M", merge_base.as_str()]);
                let output = git(root, &args)?;
                truncated = output.truncated;
                diff = output.stdout;
                base = json!(name);
            }
        }
        "turn" => {
            if let Some(from) = turn {
                let current = snapshot(root)?;
                let mut args = DIFF.to_vec();
                args.extend(["-M", from, current.as_str()]);
                let output = git(root, &args)?;
                truncated = output.truncated;
                diff = output.stdout;
            }
        }
        _ => return Err("Unknown review scope".into()),
    }
    Ok(json!({
        "repo": true,
        "scope": scope,
        "branch": state["branch"],
        "detached": state["detached"],
        "ahead": state["ahead"],
        "behind": state["behind"],
        "upstream": has_upstream(root),
        "remote": !remotes(root).is_empty(),
        "staged": staged,
        "unstaged": unstaged,
        "base": base,
        "turnAvailable": turn.is_some(),
        "diff": diff,
        "truncated": truncated,
    }))
}

fn unstage(root: &Path, paths: &[String]) -> Result<Value, String> {
    // Before the first commit there is no HEAD to restore the index from.
    let args: &[&str] = if has_head(root) {
        &["restore", "--staged"]
    } else {
        &["rm", "--cached", "-r", "-q", "--ignore-unmatch"]
    };
    done(git(root, &with_paths(args, paths))?)
}

/// Discards worktree changes: tracked files are restored from the index and
/// only the named untracked files are deleted (never directories or ignored files).
fn revert(root: &Path, paths: &[String]) -> Result<Value, String> {
    if paths.iter().any(|path| path == ".") {
        return Err("Revert needs explicit file paths".into());
    }
    let listed = git(root, &with_paths(&["ls-files", "-z"], paths))?.stdout;
    let tracked: Vec<String> = paths
        .iter()
        .filter(|path| listed.split('\0').any(|known| known == path.as_str()))
        .cloned()
        .collect();
    let untracked: Vec<String> = paths
        .iter()
        .filter(|path| !tracked.contains(*path))
        .cloned()
        .collect();
    if !tracked.is_empty() {
        git(root, &with_paths(&["restore", "--worktree"], &tracked))?;
    }
    if !untracked.is_empty() {
        git(root, &with_paths(&["clean", "-f", "-q"], &untracked))?;
    }
    Ok(json!({ "ok": true, "output": "" }))
}

/// Splits a single-file unified diff into its header and `@@` hunks, keeping
/// every line ending so the pieces concatenate back to the original text.
pub fn split_hunks(diff: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut hunks: Vec<String> = Vec::new();
    for line in diff.split_inclusive('\n') {
        if line.starts_with("@@") {
            hunks.push(String::new());
        }
        match hunks.last_mut() {
            Some(hunk) => hunk.push_str(line),
            None => header.push_str(line),
        }
    }
    (header, hunks)
}

fn hunk(root: &Path, action: &str, path: &str, wanted: &str) -> Result<Value, String> {
    let path = workspace::relative(path)?.to_string_lossy().to_string();
    let apply: &[&str] = match action {
        "stage" => &["apply", "--cached", "--whitespace=nowarn", "-"],
        "unstage" => &["apply", "--cached", "-R", "--whitespace=nowarn", "-"],
        "revert" => &["apply", "-R", "--whitespace=nowarn", "-"],
        _ => return Err("Unknown hunk action".into()),
    };
    let cached = action == "unstage";
    let mut args = DIFF.to_vec();
    if cached {
        args.push("--cached");
    }
    args.extend(["--", path.as_str()]);
    let current = git(root, &args)?.stdout;
    let (header, hunks) = split_hunks(&current);
    let wanted = wanted.trim_end_matches('\n');
    let found = hunks
        .into_iter()
        .find(|hunk| hunk.trim_end_matches('\n') == wanted)
        .ok_or("This change is out of date; refresh the review and try again")?;
    let mut patch = format!("{header}{found}");
    if !patch.ends_with('\n') {
        patch.push('\n');
    }
    done(git_with(root, apply, Some(&patch), LOCAL_TIMEOUT)?)
}

fn commit(
    root: &Path,
    message: &str,
    include_unstaged: bool,
    then: &str,
) -> Result<Value, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > MAX_MESSAGE || message.contains('\0') {
        return Err(format!("Commit message must be 1 to {MAX_MESSAGE} bytes"));
    }
    if !matches!(then, "commit" | "push" | "pr") {
        return Err("Unknown follow-up".into());
    }
    if include_unstaged {
        git(root, &["add", "-A", "--", "."])?;
    }
    // Hooks run here, so allow the longer timeout.
    git_with(root, &["commit", "-F", "-"], Some(message), REMOTE_TIMEOUT)?;
    let hash = git(root, &["rev-parse", "--short", "HEAD"])?
        .stdout
        .trim()
        .to_string();
    let mut result = json!({ "ok": true, "hash": hash });
    if then == "push" || then == "pr" {
        push(root).map_err(|error| format!("Committed {hash}, but push failed: {error}"))?;
        result["pushed"] = json!(true);
    }
    if then == "pr" {
        let url = create_pr(root)
            .map_err(|error| format!("Committed and pushed {hash}, but the pull request failed: {error}"))?;
        result["prUrl"] = json!(url);
    }
    Ok(result)
}

fn push(root: &Path) -> Result<String, String> {
    if has_upstream(root) {
        return Ok(report(git_with(root, &["push"], None, REMOTE_TIMEOUT)?));
    }
    let remotes = remotes(root);
    let remote = if remotes.iter().any(|remote| remote == "origin") {
        "origin".to_string()
    } else if remotes.len() == 1 {
        remotes[0].clone()
    } else {
        return Err("Add a remote before pushing this branch".into());
    };
    Ok(report(git_with(
        root,
        &["push", "-u", remote.as_str(), "HEAD"],
        None,
        REMOTE_TIMEOUT,
    )?))
}

fn gh_command(root: &Path, args: &[&str]) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    const GH: &str = "gh.exe";
    #[cfg(not(target_os = "windows"))]
    const GH: &str = "gh";
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let program = crate::pi_setup::command_path(GH, &home)
        .ok_or("Creating a pull request needs the GitHub CLI (gh), signed in with gh auth login")?;
    let mut command = Command::new(program);
    command.args(args);
    prepare(&mut command, root);
    Ok(command)
}

fn first_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|word| word.starts_with("https://"))
        .map(|word| word.trim_end_matches(['.', ',', ')']).to_string())
}

/// Opens a pull request for the current branch with `gh pr create --fill`,
/// publishing the branch first. An existing pull request's URL is returned.
fn create_pr(root: &Path) -> Result<String, String> {
    let branch = branch_info(root);
    if branch.detached {
        return Err("Switch to a branch before creating a pull request".into());
    }
    if !has_upstream(root) || branch.ahead > 0 {
        push(root)?;
    }
    let existing = gh_command(root, &["pr", "view", "--json", "url", "--jq", ".url"])
        .and_then(|command| exec(command, "gh pr view", None, REMOTE_TIMEOUT, MAX_REPORT));
    if let Ok(found) = existing {
        if let Some(url) = first_url(&found.stdout) {
            return Ok(url);
        }
    }
    let created = exec(
        gh_command(root, &["pr", "create", "--fill"])?,
        "gh pr create",
        None,
        REMOTE_TIMEOUT,
        MAX_REPORT,
    )?;
    first_url(&created.stdout)
        .or_else(|| first_url(&created.stderr))
        .ok_or_else(|| "gh did not report a pull request URL".to_string())
}

fn valid_branch(root: &Path, name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 200
        || name.starts_with('-')
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Invalid branch name".into());
    }
    let output = run(root, &["check-ref-format", "--branch", name])?;
    if !output.status.success() {
        return Err("Invalid branch name".into());
    }
    Ok(())
}

fn branches(root: &Path) -> Result<Value, String> {
    let output = git(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)",
            "refs/heads",
        ],
    )?;
    let list: Vec<Value> = output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\0');
            let head = parts.next()?;
            let name = parts.next()?.to_string();
            let upstream = parts.next().unwrap_or("").to_string();
            Some(json!({ "name": name, "current": head == "*", "upstream": upstream }))
        })
        .take(MAX_BRANCHES)
        .collect();
    Ok(json!({ "branches": list }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command as StdCommand;

    fn git(dir: &Path, args: &[&str]) {
        let status = StdCommand::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .expect("git runs");
        assert!(status.success(), "git {:?} failed", args);
    }

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pion-git-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q"]);
        dir
    }

    #[test]
    fn reports_status_staged_and_worktree_changes() {
        let dir = repo("status");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        fs::write(dir.join("b.txt"), "new\n").unwrap();
        git(&dir, &["add", "b.txt"]);

        let value = status(&dir).unwrap();
        assert_eq!(value["repo"], json!(true));
        assert_eq!(value["clean"], json!(false));
        let files = value["files"].as_array().unwrap();
        let by_path = |name: &str| {
            files
                .iter()
                .find(|file| file["path"] == json!(name))
                .cloned()
                .unwrap_or_else(|| panic!("missing {name} in {files:?}"))
        };
        assert_eq!(by_path("a.txt")["worktree"], json!("M"));
        assert_eq!(by_path("b.txt")["index"], json!("A"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reports_unified_diff_and_untracked_content() {
        let dir = repo("diff");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();

        let unstaged = diff(&dir, "a.txt", false).unwrap();
        assert_eq!(unstaged["binary"], json!(false));
        let text = unstaged["diff"].as_str().unwrap();
        assert!(text.contains("+two"), "diff was {text:?}");

        // A path outside the workspace is rejected before git sees it.
        assert!(diff(&dir, "../escape.txt", false).is_err());

        fs::write(dir.join("new.txt"), "hello\nworld\n").unwrap();
        let untracked = diff(&dir, "new.txt", false).unwrap();
        let text = untracked["diff"].as_str().unwrap();
        assert!(text.contains("new file mode 100644"), "diff was {text:?}");
        assert!(text.contains("+hello") && text.contains("+world"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn non_repository_is_reported_without_error() {
        let dir = std::env::temp_dir().join(format!("pion-git-plain-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let value = status(&dir).unwrap();
        assert_eq!(value["repo"], json!(false));
        assert_eq!(value["clean"], json!(true));
        assert!(diff(&dir, "any.txt", false).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    fn configured(name: &str) -> PathBuf {
        let dir = repo(name);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);
        dir
    }

    #[test]
    fn review_scopes_hunks_and_commit() {
        let dir = configured("review");
        let lines: String = (1..=30).map(|n| format!("line {n}\n")).collect();
        fs::write(dir.join("a.txt"), &lines).unwrap();
        call(&dir, "git.stage", &json!({ "paths": ["."] }), None).unwrap();
        call(
            &dir,
            "git.commit",
            &json!({ "message": "init", "then": "commit" }),
            None,
        )
        .unwrap();

        // Two separate hunks: change line 2 and line 28.
        let edited = lines
            .replace("line 2\n", "line two\n")
            .replace("line 28\n", "line twenty-eight\n");
        fs::write(dir.join("a.txt"), &edited).unwrap();
        fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        let turn = snapshot(&dir).unwrap();

        let review = call(&dir, "git.review", &json!({ "scope": "unstaged" }), None).unwrap();
        assert_eq!(review["unstaged"], json!(2));
        let diff = review["diff"].as_str().unwrap().to_string();
        assert!(diff.contains("+line two") && diff.contains("+fresh"), "{diff}");

        // Stage only the first hunk of a.txt.
        let file_diff = diff.split("diff --git a/new.txt").next().unwrap();
        let (_, hunks) = split_hunks(file_diff);
        assert_eq!(hunks.len(), 2);
        call(
            &dir,
            "git.hunk",
            &json!({ "action": "stage", "path": "a.txt", "hunk": hunks[0] }),
            None,
        )
        .unwrap();
        let staged = call(&dir, "git.review", &json!({ "scope": "staged" }), None).unwrap();
        let staged_diff = staged["diff"].as_str().unwrap();
        assert!(staged_diff.contains("+line two") && !staged_diff.contains("twenty-eight"));
        // A stale hunk is refused instead of being applied blindly.
        assert!(call(
            &dir,
            "git.hunk",
            &json!({ "action": "stage", "path": "a.txt", "hunk": hunks[0] }),
            None,
        )
        .is_err());

        // Revert the second hunk from the worktree.
        call(
            &dir,
            "git.hunk",
            &json!({ "action": "revert", "path": "a.txt", "hunk": hunks[1] }),
            None,
        )
        .unwrap();
        let content = fs::read_to_string(dir.join("a.txt")).unwrap();
        assert!(content.contains("line two") && content.contains("line 28\n"));

        // Unstage the staged hunk again.
        let (_, staged_hunks) = split_hunks(staged_diff);
        call(
            &dir,
            "git.hunk",
            &json!({ "action": "unstage", "path": "a.txt", "hunk": staged_hunks[0] }),
            None,
        )
        .unwrap();
        assert_eq!(
            call(&dir, "git.review", &json!({ "scope": "staged" }), None).unwrap()["diff"],
            json!("")
        );

        // "Last turn" compares the snapshot with the worktree now.
        fs::write(dir.join("later.txt"), "after the prompt\n").unwrap();
        let turn_review =
            call(&dir, "git.review", &json!({ "scope": "turn" }), Some(&turn)).unwrap();
        let turn_diff = turn_review["diff"].as_str().unwrap();
        assert!(turn_diff.contains("+after the prompt"), "{turn_diff}");
        assert!(turn_diff.contains("-line twenty-eight"), "{turn_diff}");
        assert!(!turn_diff.contains("new.txt"), "{turn_diff}");
        assert_eq!(
            call(&dir, "git.review", &json!({ "scope": "turn" }), None).unwrap()["turnAvailable"],
            json!(false)
        );

        let summary = call(&dir, "git.summary", &json!({}), None).unwrap();
        assert_eq!(summary["files"], json!(3));

        // Commit everything, including unstaged and untracked files.
        let committed = call(
            &dir,
            "git.commit",
            &json!({ "message": "  work  ", "includeUnstaged": true, "then": "commit" }),
            None,
        )
        .unwrap();
        assert!(!committed["hash"].as_str().unwrap().is_empty());
        assert_eq!(status(&dir).unwrap()["clean"], json!(true));
        assert!(call(&dir, "git.commit", &json!({ "message": " " }), None).is_err());
        // No remote: push explains instead of hanging.
        assert!(call(&dir, "git.push", &json!({}), None).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn revert_branches_branch_scope_and_init() {
        let dir = configured("branches");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        call(&dir, "git.stage", &json!({ "paths": ["a.txt"] }), None).unwrap();
        call(&dir, "git.unstage", &json!({ "paths": ["a.txt"] }), None).unwrap();
        assert_eq!(status(&dir).unwrap()["files"][0]["index"], json!("?"));
        call(&dir, "git.stage", &json!({ "paths": ["a.txt"] }), None).unwrap();
        call(&dir, "git.commit", &json!({ "message": "init" }), None).unwrap();
        git(&dir, &["branch", "-M", "main"]);

        call(&dir, "git.createBranch", &json!({ "name": "feature/x" }), None).unwrap();
        fs::write(dir.join("b.txt"), "feature\n").unwrap();
        call(&dir, "git.stage", &json!({ "paths": ["b.txt"] }), None).unwrap();
        call(&dir, "git.commit", &json!({ "message": "feature" }), None).unwrap();
        let branch = call(&dir, "git.review", &json!({ "scope": "branch" }), None).unwrap();
        assert_eq!(branch["base"], json!("main"));
        assert!(branch["diff"].as_str().unwrap().contains("+feature"));

        let listed = call(&dir, "git.branches", &json!({}), None).unwrap();
        assert!(listed["branches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["name"] == json!("feature/x") && b["current"] == json!(true)));
        assert!(call(&dir, "git.checkout", &json!({ "branch": "--orphan" }), None).is_err());
        assert!(call(&dir, "git.createBranch", &json!({ "name": "bad name" }), None).is_err());

        fs::write(dir.join("a.txt"), "changed\n").unwrap();
        fs::write(dir.join("scratch.txt"), "tmp\n").unwrap();
        fs::write(dir.join("keep.txt"), "keep\n").unwrap();
        call(&dir, "git.revert", &json!({ "paths": ["a.txt", "scratch.txt"] }), None).unwrap();
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one\n");
        assert!(!dir.join("scratch.txt").exists() && dir.join("keep.txt").exists());
        assert!(call(&dir, "git.revert", &json!({ "paths": ["."] }), None).is_err());
        assert!(call(&dir, "git.stage", &json!({ "paths": ["../escape"] }), None).is_err());
        fs::remove_dir_all(&dir).unwrap();

        let plain = std::env::temp_dir().join(format!("pion-git-init-{}", std::process::id()));
        let _ = fs::remove_dir_all(&plain);
        fs::create_dir_all(&plain).unwrap();
        assert_eq!(call(&plain, "git.summary", &json!({}), None).unwrap()["repo"], json!(false));
        assert!(call(&plain, "git.review", &json!({}), None).is_err());
        call(&plain, "git.init", &json!({}), None).unwrap();
        assert_eq!(call(&plain, "git.summary", &json!({}), None).unwrap()["repo"], json!(true));
        fs::remove_dir_all(&plain).unwrap();
    }
}
