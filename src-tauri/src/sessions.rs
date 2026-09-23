use crate::tasks::{Catalog, Task};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const MAX_SESSIONS: usize = 2_000;
const MAX_ENTRIES: usize = 10_000;
const MAX_SESSION_BYTES: u64 = 128 * 1024 * 1024;
const MAX_LINE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySession {
    pub id: String,
    pub title: String,
    pub project_path: String,
    pub modified: u64,
    pub message_count: usize,
    #[serde(skip)]
    source: PathBuf,
}

fn text(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.trim().to_string();
    }
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn inspect(file: &Path, legacy_root: &Path) -> Result<Option<LegacySession>, String> {
    let file = file.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(legacy_root) || !file.is_file() {
        return Ok(None);
    }
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if metadata.len() > MAX_SESSION_BYTES {
        return Ok(None);
    }
    let reader = BufReader::new(File::open(&file).map_err(|e| e.to_string())?);
    let mut lines = reader.split(b'\n');
    let Some(header) = lines.next() else {
        return Ok(None);
    };
    let header = header.map_err(|e| e.to_string())?;
    if header.len() as u64 > MAX_LINE_BYTES {
        return Ok(None);
    }
    let header: Value = match serde_json::from_slice::<Value>(&header) {
        Ok(value) if value["type"] == "session" => value,
        _ => return Ok(None),
    };
    let cwd = match header["cwd"].as_str() {
        Some(value) => PathBuf::from(value),
        None => return Ok(None),
    };
    let cwd = match cwd.canonicalize() {
        Ok(value) if value.is_dir() => value,
        _ => return Ok(None),
    };
    let mut name = None;
    let mut first_message = None;
    let mut message_count = 0;
    for line in lines {
        let line = line.map_err(|e| e.to_string())?;
        if line.len() as u64 > MAX_LINE_BYTES {
            return Ok(None);
        }
        let Ok(entry) = serde_json::from_slice::<Value>(&line) else {
            return Ok(None);
        };
        if entry["type"] == "session_info" {
            name = entry["name"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
        if entry["type"] == "message" {
            message_count += 1;
            if first_message.is_none() && entry["message"]["role"] == "user" {
                let value = text(&entry["message"]["content"]);
                if !value.is_empty() {
                    first_message = Some(value);
                }
            }
        }
    }
    let id = format!("{:x}", Sha256::digest(file.to_string_lossy().as_bytes()));
    let fallback = file
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Imported Pi session")
        .to_string();
    let title: String = name
        .or(first_message)
        .unwrap_or(fallback)
        .chars()
        .take(80)
        .collect();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_secs());
    Ok(Some(LegacySession {
        id,
        title,
        project_path: cwd.to_string_lossy().into_owned(),
        modified,
        message_count,
        source: file,
    }))
}

fn visit(
    directory: &Path,
    root: &Path,
    depth: usize,
    seen: &mut usize,
    result: &mut Vec<LegacySession>,
) -> Result<(), String> {
    if result.len() >= MAX_SESSIONS || *seen >= MAX_ENTRIES || depth > 4 {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        if result.len() >= MAX_SESSIONS || *seen >= MAX_ENTRIES {
            break;
        }
        let entry = entry.map_err(|e| e.to_string())?;
        *seen += 1;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let _ = visit(&entry.path(), root, depth + 1, seen, result);
        } else if kind.is_file()
            && entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl")
        {
            if let Ok(Some(session)) = inspect(&entry.path(), root) {
                result.push(session);
            }
        }
    }
    Ok(())
}

pub fn list(root: &Path) -> Result<Vec<LegacySession>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut seen = 0;
    visit(&root, &root, 0, &mut seen, &mut result)?;
    result.sort_by(|left, right| right.modified.cmp(&left.modified));
    Ok(result)
}

pub fn import(
    catalog: &mut Catalog,
    app_root: &Path,
    legacy_root: &Path,
    ids: &[String],
) -> Result<Vec<Task>, String> {
    if ids.len() > MAX_SESSIONS {
        return Err("Too many sessions selected".into());
    }
    let sessions = list(legacy_root)?;
    let destination = app_root.join("sessions").join("imported");
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    let destination = destination.canonicalize().map_err(|e| e.to_string())?;
    let mut staged = catalog.clone();
    let mut created_files = Vec::new();
    let result = (|| {
        let mut imported = Vec::new();
        for id in ids {
            let session = sessions
                .iter()
                .find(|session| &session.id == id)
                .ok_or("Unknown legacy session")?;
            if let Some(task) = staged.imported_task(id) {
                imported.push(task);
                continue;
            }
            let project = staged.add_project(Path::new(&session.project_path))?;
            let file = destination.join(format!("{}.jsonl", session.id));
            if !file.exists() {
                created_files.push(file.clone());
                fs::copy(&session.source, &file).map_err(|e| e.to_string())?;
            }
            imported.push(staged.create_imported(
                &project.id,
                &session.title,
                &file,
                &session.id,
                app_root,
            )?);
        }
        staged.save(app_root)?;
        Ok(imported)
    })();
    if result.is_ok() {
        *catalog = staged;
    } else {
        for file in created_files {
            let _ = fs::remove_file(file);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_imports_documented_legacy_sessions_without_duplicates() {
        let root = std::env::temp_dir().join(format!(
            "pion-session-import-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let legacy = root.join("legacy");
        let app = root.join("app");
        let project = root.join("project");
        let second_project = root.join("second-project");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&second_project).unwrap();
        let file = legacy.join("session-one.jsonl");
        fs::write(
            &file,
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"one\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":{}}}\n{{\"type\":\"message\",\"id\":\"a\",\"parentId\":null,\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{{\"role\":\"user\",\"content\":\"Legacy task\",\"timestamp\":1}}}}\n",
                serde_json::to_string(&project.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        fs::write(
            legacy.join("session-two.jsonl"),
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"two\",\"timestamp\":\"2026-01-02T00:00:00Z\",\"cwd\":{}}}\n{{\"type\":\"session_info\",\"id\":\"b\",\"parentId\":null,\"timestamp\":\"2026-01-02T00:00:01Z\",\"name\":\"Second legacy task\"}}\n",
                serde_json::to_string(&second_project.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        fs::write(legacy.join("invalid.jsonl"), "not json\n").unwrap();
        let listed = list(&legacy).unwrap();
        assert_eq!(listed.len(), 2);
        let first_id = listed
            .iter()
            .find(|session| session.title == "Legacy task")
            .unwrap()
            .id
            .clone();
        let second_id = listed
            .iter()
            .find(|session| session.title == "Second legacy task")
            .unwrap()
            .id
            .clone();
        let mut catalog = Catalog::default();
        assert!(import(
            &mut catalog,
            &app,
            &legacy,
            &[first_id.clone(), "missing".into()],
        )
        .is_err());
        assert!(catalog.tasks.is_empty());
        assert!(Catalog::read(&app).unwrap().tasks.is_empty());
        assert!(!app
            .join("sessions/imported")
            .join(format!("{first_id}.jsonl"))
            .exists());
        let imported = import(&mut catalog, &app, &legacy, &[first_id.clone(), second_id]).unwrap();
        let again = import(&mut catalog, &app, &legacy, &[first_id]).unwrap();
        assert_eq!(imported[0].id, again[0].id);
        assert_eq!(imported.len(), 2);
        assert_eq!(catalog.tasks.len(), 2);
        assert_eq!(catalog.projects.len(), 2);
        assert_eq!(Catalog::read(&app).unwrap().tasks.len(), 2);
        assert!(catalog.resolve(&imported[0].id, &app).unwrap().2.is_some());
        assert!(catalog.resolve(&imported[1].id, &app).unwrap().2.is_some());
        assert!(serde_json::to_value(&imported[0])
            .unwrap()
            .get("importedFrom")
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
