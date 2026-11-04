use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub fn relative(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Expected a relative path without traversal".into());
    }
    Ok(path)
}

pub fn bounded_read(path: &Path, limit: u64) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Expected a regular file".into());
    }
    let mut value = String::new();
    file.take(limit + 1)
        .read_to_string(&mut value)
        .map_err(|e| e.to_string())?;
    if value.len() as u64 > limit {
        return Err("File exceeds size limit".into());
    }
    Ok(value)
}

pub fn within(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = root.join(relative(name)?);
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("Path escapes workspace/plugin directory".into());
    }
    Ok(canonical)
}

pub fn describe(root: &Path) -> Value {
    json!({ "id": root.to_string_lossy(), "path": root.to_string_lossy(),
        "name": root.file_name().unwrap_or_default().to_string_lossy() })
}

fn segment_matches(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let mut dp = vec![vec![false; t.len() + 1]; p.len() + 1];
    dp[0][0] = true;
    for i in 1..=p.len() {
        if p[i - 1] == '*' {
            dp[i][0] = dp[i - 1][0];
        }
    }
    for i in 1..=p.len() {
        for j in 1..=t.len() {
            dp[i][j] = if p[i - 1] == '*' {
                dp[i - 1][j] || dp[i][j - 1]
            } else {
                dp[i - 1][j - 1] && p[i - 1] == t[j - 1]
            };
        }
    }
    dp[p.len()][t.len()]
}

/// Glob matcher for workspace write allowlists. `*` matches within a path
/// segment and a `**` segment matches zero or more segments.
pub fn pattern_matches(pattern: &str, path: &str) -> bool {
    fn walk(pattern: &[&str], path: &[&str]) -> bool {
        match pattern.first() {
            None => path.is_empty(),
            Some(&"**") => {
                if walk(&pattern[1..], path) {
                    return true;
                }
                match path.first() {
                    Some(_) => walk(pattern, &path[1..]),
                    None => false,
                }
            }
            Some(segment) => match path.first() {
                Some(current) if segment_matches(segment, current) => {
                    walk(&pattern[1..], &path[1..])
                }
                _ => false,
            },
        }
    }
    let pattern: Vec<&str> = pattern.split('/').collect();
    let path: Vec<&str> = path.split('/').collect();
    walk(&pattern, &path)
}

fn writable_target(root: &Path, rel: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let name = rel.file_name().ok_or("Expected a file path")?;
    let parent = rel.parent().unwrap_or_else(|| Path::new(""));
    let canonical_parent = root
        .join(parent)
        .canonicalize()
        .map_err(|_| "Parent directory does not exist".to_string())?;
    if !canonical_parent.starts_with(&root) {
        return Err("Path escapes workspace".into());
    }
    let target = canonical_parent.join(name);
    if target.exists() {
        let canonical = target.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(&root) {
            return Err("Path escapes workspace".into());
        }
        return Ok(canonical);
    }
    Ok(target)
}

/// Writes text to a workspace-relative path that matches a plugin allowlist
/// pattern. The parent directory must already exist and stay inside the root.
pub fn write_file(
    root: &Path,
    allowed: &[String],
    name: &str,
    content: &str,
    limit: u64,
) -> Result<(), String> {
    let rel = relative(name)?;
    let normalized = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if !allowed
        .iter()
        .any(|pattern| pattern_matches(pattern, &normalized))
    {
        return Err("Path is not in the plugin's write allowlist".into());
    }
    if content.len() as u64 > limit {
        return Err("Write exceeds size limit".into());
    }
    let target = writable_target(root, rel)?;
    let tmp = target.with_extension("pion-tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        assert!(relative("../secret").is_err());
        assert!(relative("/etc/passwd").is_err());
        assert!(relative("src/main.rs").is_ok());
        #[cfg(unix)]
        {
            let root = std::env::temp_dir().join(format!("pion-path-test-{}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            std::os::unix::fs::symlink("/etc", root.join("outside")).unwrap();
            assert!(within(&root.canonicalize().unwrap(), "outside/passwd").is_err());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn glob_patterns_bound_write_paths() {
        assert!(pattern_matches("notes/**", "notes/a.md"));
        assert!(pattern_matches("notes/**", "notes/a/b/c.txt"));
        assert!(pattern_matches("out/*.md", "out/report.md"));
        assert!(!pattern_matches("out/*.md", "out/nested/report.md"));
        assert!(!pattern_matches("out/*.md", "other/report.md"));
        assert!(pattern_matches("**/*.txt", "deep/nested/file.txt"));
        assert!(!pattern_matches("drafts/*", "drafts/x/y.txt"));
    }

    #[test]
    fn write_file_honors_allowlist_size_and_symlinks() {
        let root = std::env::temp_dir().join(format!("pion-write-test-{}", std::process::id()));
        fs::create_dir_all(root.join("notes")).unwrap();
        let allow = vec!["notes/**".to_string()];
        write_file(&root, &allow, "notes/hello.txt", "hi", 1024).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("notes/hello.txt")).unwrap(),
            "hi"
        );
        assert!(write_file(&root, &allow, "outside.txt", "x", 1024).is_err());
        assert!(write_file(&root, &allow, "../escape.txt", "x", 1024).is_err());
        assert!(write_file(&root, &allow, "notes/big.txt", "xxxxxxxxxx", 4).is_err());
        assert!(write_file(&root, &allow, "missing/hello.txt", "x", 1024).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", root.join("notes/escape")).unwrap();
            assert!(write_file(&root, &allow, "notes/escape/passwd", "x", 1024).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
