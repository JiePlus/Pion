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
}
