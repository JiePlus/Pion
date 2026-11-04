//! Read-only Git status and unified diff for the first-party Git/Diff plugin.
//!
//! Every command is workspace-scoped: it runs with the workspace as its working
//! directory, paths must be relative and stay inside the workspace, and output
//! is bounded. No command writes to the repository (`GIT_OPTIONAL_LOCKS=0`) and
//! no command may block on a terminal prompt (`GIT_TERMINAL_PROMPT=0`).

use crate::workspace;
use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Output};

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
}
