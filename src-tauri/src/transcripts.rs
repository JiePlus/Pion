//! The last transcript Pi returned for each task, kept on disk so a task shows its
//! conversation the moment it opens, before its Pi process is ready. Pi stays the
//! source of truth: the view is replaced by Pi's own answer as soon as it arrives.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Transcripts larger than this are not cached; the task then waits for Pi as before.
const MAX_BYTES: usize = 16 * 1024 * 1024;

fn path(root: &Path, task_id: &str) -> PathBuf {
    // Hash the id so it can never name a path outside the cache directory.
    let name = format!("{:x}", Sha256::digest(task_id.as_bytes()));
    root.join("transcripts").join(format!("{name}.json"))
}

/// Saves `messages` (Pi's get_messages data) in the background, so the caller does
/// not wait on disk. A later save of the same task replaces the file atomically.
pub fn save(root: &Path, task_id: &str, messages: &Value) {
    let Ok(bytes) = serde_json::to_vec(messages) else {
        return;
    };
    if bytes.len() > MAX_BYTES {
        return;
    }
    let target = path(root, task_id);
    std::thread::spawn(move || {
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = crate::plugins::atomic_write(&target, &bytes);
    });
}

/// The cached transcript, or `None` when there is none or it cannot be read.
pub fn load(root: &Path, task_id: &str) -> Option<Value> {
    let bytes = fs::read(path(root, task_id)).ok()?;
    if bytes.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saves_loads_and_removes_by_task() {
        let root = std::env::temp_dir().join(format!("pion-transcripts-{}", std::process::id()));
        let messages = json!({"messages":[{"role":"user","content":"hi"}]});
        save(&root, "task-1", &messages);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while load(&root, "task-1").is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(load(&root, "task-1"), Some(messages));
        assert_eq!(load(&root, "task-2"), None);
        // Ids are hashed, so a hostile id stays inside the cache directory.
        assert!(path(&root, "../../etc/passwd").starts_with(root.join("transcripts")));
        fs::remove_file(path(&root, "task-1")).unwrap();
        assert_eq!(load(&root, "task-1"), None);
        let _ = fs::remove_dir_all(root);
    }
}
