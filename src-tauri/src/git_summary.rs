//! The review pane's summary (branch, ahead/behind, changed files and lines),
//! computed in process with libgit2 and cached per workspace until a file
//! watcher reports a change. The git CLI stays as the fallback.
use git2::{BranchType, DiffFindOptions, DiffOptions, Repository, Status, StatusOptions};
use notify::{RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Workspaces whose summary is cached at once; each keeps one file watcher.
const MAX_WATCHED: usize = 4;

/// The summary computed with libgit2, matching `git diff --numstat HEAD` plus
/// untracked files from `git ls-files --others --exclude-standard`.
pub fn compute(root: &Path) -> Result<Value, git2::Error> {
    let repo = match Repository::discover(root) {
        Ok(repo) if !repo.is_bare() => repo,
        Ok(_) => return Ok(json!({ "repo": false })),
        Err(error) if error.code() == git2::ErrorCode::NotFound => {
            return Ok(json!({ "repo": false }))
        }
        Err(error) => return Err(error),
    };
    // HEAD's symbolic target names the branch even before the first commit.
    let head = repo.find_reference("HEAD")?;
    let (name, detached) = match head.symbolic_target()? {
        Some(target) => (
            target
                .strip_prefix("refs/heads/")
                .unwrap_or(target)
                .to_string(),
            false,
        ),
        None => ("HEAD".to_string(), true),
    };
    let (mut ahead, mut behind) = (0, 0);
    if !detached {
        if let Ok(branch) = repo.find_branch(&name, BranchType::Local) {
            if let Ok(upstream) = branch.upstream() {
                if let (Some(local), Some(remote)) =
                    (branch.get().target(), upstream.get().target())
                {
                    (ahead, behind) = repo.graph_ahead_behind(local, remote)?;
                }
            }
        }
    }
    let stats = |mut diff: git2::Diff| -> Result<(usize, usize, usize), git2::Error> {
        // `git diff` detects renames by default (diff.renames).
        diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
        let stats = diff.stats()?;
        Ok((stats.files_changed(), stats.insertions(), stats.deletions()))
    };
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let (files, additions, deletions) = match head_tree {
        Some(tree) => stats(
            repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut DiffOptions::new()))?,
        )?,
        None => {
            // No commit yet: staged and unstaged changes are counted separately, as
            // `git diff --numstat --cached` and `git diff --numstat` are.
            let staged = stats(repo.diff_tree_to_index(None, None, None)?)?;
            let unstaged = stats(repo.diff_index_to_workdir(None, Some(&mut DiffOptions::new()))?)?;
            (
                staged.0 + unstaged.0,
                staged.1 + unstaged.1,
                staged.2 + unstaged.2,
            )
        }
    };
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .exclude_submodules(true);
    let untracked = repo
        .statuses(Some(&mut options))?
        .iter()
        .filter(|entry| entry.status().contains(Status::WT_NEW))
        .count();
    Ok(json!({
        "repo": true,
        "branch": name,
        "detached": detached,
        "ahead": ahead,
        "behind": behind,
        "additions": additions,
        "deletions": deletions,
        "files": files + untracked,
    }))
}

struct Entry {
    summary: Option<Value>,
    /// Set by the watcher on any change; the next summary is then recomputed.
    dirty: Arc<AtomicBool>,
    /// None until the watcher is running; until then nothing is cached.
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
}

/// Summaries per workspace, valid until the workspace's files change.
#[derive(Default)]
pub struct SummaryCache {
    entries: Mutex<Vec<(PathBuf, Entry)>>,
}

impl SummaryCache {
    /// The workspace summary: cached while nothing changed, else computed with
    /// `compute` (libgit2), falling back to `fallback` (the git CLI) on error.
    pub fn summary(
        &self,
        root: &Path,
        fallback: impl FnOnce() -> Result<Value, String>,
    ) -> Result<Value, String> {
        let (dirty, watching) = {
            let mut entries = self.entries.lock().map_err(|e| e.to_string())?;
            if let Some(index) = entries.iter().position(|(path, _)| path == root) {
                let entry = entries.remove(index);
                entries.push(entry);
            } else {
                if entries.len() >= MAX_WATCHED {
                    entries.remove(0);
                }
                entries.push((root.to_path_buf(), watch(root)));
            }
            let entry = &entries.last().expect("entry was just pushed").1;
            let watching = entry.watcher.lock().is_ok_and(|watcher| watcher.is_some());
            if watching && !entry.dirty.load(Ordering::Acquire) {
                if let Some(summary) = &entry.summary {
                    return Ok(summary.clone());
                }
            }
            (entry.dirty.clone(), watching)
        };
        // Changes made while this runs mark the entry dirty again.
        dirty.store(false, Ordering::Release);
        let summary = compute(root)
            .map_err(|error| error.to_string())
            .or_else(|_| fallback())?;
        if watching {
            if let Ok(mut entries) = self.entries.lock() {
                if let Some((_, entry)) = entries.iter_mut().find(|(path, _)| path == root) {
                    entry.summary = Some(summary.clone());
                }
            }
        }
        Ok(summary)
    }
}

/// Starts watching `root` in the background: on a large tree, setting up a
/// recursive watch takes a while, and the summary must not wait for it.
fn watch(root: &Path) -> Entry {
    let dirty = Arc::new(AtomicBool::new(true));
    let watcher = Arc::new(Mutex::new(None));
    let (root, flag, slot) = (root.to_path_buf(), dirty.clone(), watcher.clone());
    std::thread::spawn(move || {
        let mark = flag.clone();
        // Build output and other ignored files change all the time but never change
        // the summary; only changes Git can see invalidate it.
        let repo = Repository::discover(&root).ok();
        let workdir = repo
            .as_ref()
            .and_then(|repo| repo.workdir().map(Path::to_path_buf));
        let Ok(mut created) =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else {
                    mark.store(true, Ordering::Release);
                    return;
                };
                // Reading files (computing this very summary opens them) changes nothing.
                if event.kind.is_access() {
                    return;
                }
                if event
                    .paths
                    .iter()
                    .any(|path| visible(repo.as_ref(), workdir.as_deref(), path))
                {
                    mark.store(true, Ordering::Release);
                }
            })
        else {
            return;
        };
        if created.watch(&root, RecursiveMode::Recursive).is_ok() {
            if let Ok(mut slot) = slot.lock() {
                flag.store(true, Ordering::Release);
                *slot = Some(created);
            }
        }
    });
    Entry {
        summary: None,
        dirty,
        watcher,
    }
}

/// Whether a change at `path` can alter the summary: anything inside `.git`, or a
/// working-tree path Git does not ignore.
fn visible(repo: Option<&Repository>, workdir: Option<&Path>, path: &Path) -> bool {
    let (Some(repo), Some(workdir)) = (repo, workdir) else {
        return true;
    };
    if path.starts_with(repo.path()) {
        // Object writes alone never change what is checked out or staged.
        return !path.starts_with(repo.path().join("objects"));
    }
    match path.strip_prefix(workdir) {
        Ok(relative) if !relative.as_os_str().is_empty() => {
            !repo.status_should_ignore(relative).unwrap_or(false)
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=Pion", "-c", "user.email=pion@example.com"])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(status.status.success(), "{args:?}: {status:?}");
    }

    /// libgit2 must agree with the git CLI across the states the pane shows.
    #[test]
    fn libgit2_summary_matches_the_git_cli() {
        let dir = std::env::temp_dir().join(format!("pion-summary-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let same = |label: &str| {
            let fast = compute(&dir).unwrap();
            let cli = crate::git::call(&dir, "git.summary", &json!({}), None).unwrap();
            assert_eq!(fast, cli, "{label}");
        };
        same("not a repository");
        git(&dir, &["init", "--initial-branch=main"]);
        same("empty repository");
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        same("staged and unstaged before the first commit");
        git(&dir, &["commit", "-qm", "first"]);
        fs::write(dir.join("a.txt"), "one\nchanged\n").unwrap();
        fs::write(dir.join("bin.dat"), [0u8, 1, 2, 3]).unwrap();
        fs::create_dir_all(dir.join("new/deep")).unwrap();
        fs::write(dir.join("new/deep/x.txt"), "x\n").unwrap();
        fs::write(dir.join(".gitignore"), "ignored.log\n").unwrap();
        fs::write(dir.join("ignored.log"), "noise\n").unwrap();
        same("modified, binary, nested untracked and ignored files");
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "second"]);
        git(&dir, &["mv", "a.txt", "renamed.txt"]);
        same("staged rename");
        git(&dir, &["commit", "-qm", "third"]);
        let remote = dir.with_extension("remote");
        let _ = fs::remove_dir_all(&remote);
        git(
            &dir,
            &["clone", "-q", "--bare", ".", remote.to_str().unwrap()],
        );
        git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
        git(&dir, &["fetch", "-q", "origin"]);
        git(&dir, &["branch", "-u", "origin/main"]);
        git(&dir, &["commit", "-q", "--allow-empty", "-m", "ahead"]);
        same("one commit ahead of upstream");
        git(&dir, &["checkout", "-q", "--detach"]);
        same("detached HEAD");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&remote);
    }

    /// Timing on a real repository: `PION_BENCH_REPO=/path cargo test summary_timing -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn summary_timing() {
        let Ok(repo) = std::env::var("PION_BENCH_REPO") else {
            return;
        };
        let root = Path::new(&repo);
        let time = |label: &str, work: &dyn Fn()| {
            let started = std::time::Instant::now();
            for _ in 0..10 {
                work();
            }
            eprintln!("{label}: {:?} per summary", started.elapsed() / 10);
        };
        time("git CLI", &|| {
            crate::git::call(root, "git.summary", &json!({}), None).unwrap();
        });
        time("libgit2", &|| {
            compute(root).unwrap();
        });
        let cache = SummaryCache::default();
        let started = std::time::Instant::now();
        loop {
            cache.summary(root, || Err("unused".into())).unwrap();
            let entries = cache.entries.lock().unwrap();
            let entry = &entries[0].1;
            if entry.watcher.lock().unwrap().is_some() && !entry.dirty.load(Ordering::Acquire) {
                break;
            }
            drop(entries);
            assert!(started.elapsed() < std::time::Duration::from_secs(120));
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        eprintln!(
            "watcher ready and summary cached after {:?}",
            started.elapsed()
        );
        time("cached", &|| {
            cache.summary(root, || Err("unused".into())).unwrap();
        });
    }

    #[test]
    fn cache_serves_until_files_change() {
        let dir = std::env::temp_dir().join(format!("pion-summary-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "--initial-branch=main"]);
        let cache = SummaryCache::default();
        let no_fallback = || Err("unused".to_string());
        // Wait for the watcher to start, then for one summary to be cached.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            cache.summary(&dir, no_fallback).unwrap();
            let entries = cache.entries.lock().unwrap();
            let entry = &entries[0].1;
            if entry.watcher.lock().unwrap().is_some() && !entry.dirty.load(Ordering::Acquire) {
                break;
            }
            drop(entries);
            assert!(
                std::time::Instant::now() < deadline,
                "watcher never started"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(cache.summary(&dir, no_fallback).unwrap()["files"], 0);
        fs::write(dir.join("new.txt"), "hello\n").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while cache.summary(&dir, no_fallback).unwrap()["files"] != 1 {
            assert!(std::time::Instant::now() < deadline, "change never noticed");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
