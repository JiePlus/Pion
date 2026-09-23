use crate::plugins::atomic_write;
use crate::workspace::bounded_read;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub unread: bool,
    #[serde(default, skip_serializing)]
    session_file: Option<String>,
    #[serde(default, skip_serializing)]
    session_pending: bool,
    #[serde(default, skip_serializing)]
    imported_from: Option<String>,
}

pub struct UnreadState {
    root: PathBuf,
    ids: Mutex<HashSet<String>>,
}

impl UnreadState {
    pub fn read(root: &Path) -> Result<Self, String> {
        let path = root.join("unread-tasks.json");
        let ids = if path.exists() {
            serde_json::from_str(&bounded_read(&path, 1024 * 1024)?).map_err(|e| e.to_string())?
        } else {
            HashSet::new()
        };
        Ok(Self {
            root: root.to_path_buf(),
            ids: Mutex::new(ids),
        })
    }

    pub fn set(&self, id: &str, unread: bool) -> Result<(), String> {
        let mut ids = self.ids.lock().map_err(|e| e.to_string())?;
        if unread {
            ids.insert(id.to_string());
        } else {
            ids.remove(id);
        }
        atomic_write(
            &self.root.join("unread-tasks.json"),
            &serde_json::to_vec(&*ids).map_err(|e| e.to_string())?,
        )
    }

    pub fn apply(&self, catalog: &mut Catalog) -> Result<(), String> {
        let ids = self.ids.lock().map_err(|e| e.to_string())?;
        for task in &mut catalog.tasks {
            task.unread = ids.contains(&task.id);
        }
        Ok(())
    }
}

// Navigation metadata only. Pi owns and persists each task's actual session.
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
}

fn id() -> String {
    format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

impl Catalog {
    pub fn read(root: &Path) -> Result<Self, String> {
        let path = root.join("tasks.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        serde_json::from_str(&bounded_read(&path, 4 * 1024 * 1024)?).map_err(|e| e.to_string())
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let tasks: Vec<Value> = self
            .tasks
            .iter()
            .map(|task| {
                json!({
                    "id":task.id,
                    "projectId":task.project_id,
                    "title":task.title,
                    "sessionFile":task.session_file,
                    "sessionPending":task.session_pending,
                    "importedFrom":task.imported_from
                })
            })
            .collect();
        atomic_write(
            &root.join("tasks.json"),
            &serde_json::to_vec(&json!({"projects":self.projects,"tasks":tasks}))
                .map_err(|e| e.to_string())?,
        )
    }

    pub fn add_project(&mut self, path: &Path) -> Result<Project, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path.is_dir() {
            return Err("Project must be a directory".into());
        }
        let path_string = path.to_string_lossy().into_owned();
        if let Some(project) = self.projects.iter().find(|p| p.path == path_string) {
            return Ok(project.clone());
        }
        let project = Project {
            id: id(),
            name: path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .into_owned(),
            path: path_string,
        };
        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn create(&mut self, project_id: &str, title: &str) -> Result<Task, String> {
        if !self.projects.iter().any(|p| p.id == project_id) {
            return Err("Unknown project".into());
        }
        let task = Task {
            id: id(),
            project_id: project_id.into(),
            title: normalized_title(title),
            unread: false,
            session_file: None,
            session_pending: false,
            imported_from: None,
        };
        self.tasks.insert(0, task.clone());
        Ok(task)
    }

    pub fn project_root(&self, project_id: &str) -> Result<PathBuf, String> {
        let project = self
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or("Unknown project")?;
        let workspace = PathBuf::from(&project.path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !workspace.is_dir() {
            return Err("Project directory is unavailable".into());
        }
        Ok(workspace)
    }

    pub fn pending_session_title(&self, task_id: &str) -> Option<&str> {
        self.tasks
            .iter()
            .find(|task| task.id == task_id && task.session_pending)
            .map(|task| task.title.as_str())
    }

    pub fn resolve(
        &self,
        task_id: &str,
        root: &Path,
    ) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
        let task = self
            .tasks
            .iter()
            .find(|t| t.id == task_id)
            .ok_or("Unknown task")?;
        // Never let an IPC argument or edited metadata escape the private session root.
        if task.id.is_empty() || !task.id.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid task id".into());
        }
        let workspace = self.project_root(&task.project_id)?;
        let session_root = session_root(root)?;
        let file = match task.session_file.as_deref() {
            Some(relative) => {
                let target = session_root.join(relative);
                if task.session_pending && !target.exists() {
                    validate_pending_session_file(&target, root)?;
                    None
                } else {
                    Some(validate_session_file(&target, root)?)
                }
            }
            None => None,
        };
        Ok((workspace, session_root.join(&task.id), file))
    }

    pub fn attach_session(
        &mut self,
        task_id: &str,
        file: &Path,
        root: &Path,
    ) -> Result<(), String> {
        let (relative, pending) = relative_session_target(file, root)?;
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or("Unknown task")?;
        task.session_file = Some(relative);
        task.session_pending = pending;
        Ok(())
    }

    pub fn create_from_session(
        &mut self,
        source_task_id: &str,
        title: &str,
        session_file: &Path,
        root: &Path,
    ) -> Result<Task, String> {
        let source = self
            .tasks
            .iter()
            .find(|task| task.id == source_task_id)
            .ok_or("Unknown task")?;
        let (session_file, session_pending) = relative_session_target(session_file, root)?;
        let task = Task {
            id: id(),
            project_id: source.project_id.clone(),
            title: normalized_title(title),
            unread: false,
            session_file: Some(session_file),
            session_pending,
            imported_from: None,
        };
        self.tasks.insert(0, task.clone());
        Ok(task)
    }

    pub fn imported_task(&self, source: &str) -> Option<Task> {
        self.tasks
            .iter()
            .find(|task| task.imported_from.as_deref() == Some(source))
            .cloned()
    }

    pub fn create_imported(
        &mut self,
        project_id: &str,
        title: &str,
        session_file: &Path,
        source: &str,
        root: &Path,
    ) -> Result<Task, String> {
        if let Some(task) = self.imported_task(source) {
            return Ok(task);
        }
        if !self.projects.iter().any(|project| project.id == project_id) {
            return Err("Unknown project".into());
        }
        let (session_file, session_pending) = relative_session_target(session_file, root)?;
        let task = Task {
            id: id(),
            project_id: project_id.into(),
            title: normalized_title(title),
            unread: false,
            session_file: Some(session_file),
            session_pending,
            imported_from: Some(source.into()),
        };
        self.tasks.insert(0, task.clone());
        Ok(task)
    }

    pub fn rename(&mut self, task_id: &str, title: &str) -> Result<Task, String> {
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or("Unknown task")?;
        task.title = normalized_title(title);
        Ok(task.clone())
    }
}

fn normalized_title(title: &str) -> String {
    let title: String = title.trim().chars().take(80).collect();
    if title.is_empty() {
        "New task".into()
    } else {
        title
    }
}

fn session_root(root: &Path) -> Result<PathBuf, String> {
    let path = root.join("sessions");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.canonicalize().map_err(|e| e.to_string())
}

fn validate_session_file(file: &Path, root: &Path) -> Result<PathBuf, String> {
    let root = session_root(root)?;
    let file = file.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("Session file is outside Pion's private session root".into());
    }
    Ok(file)
}

fn relative_session_file(file: &Path, root: &Path) -> Result<String, String> {
    let session_root = session_root(root)?;
    let file = file.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&session_root) || !file.is_file() {
        return Err("Session file is outside Pion's private session root".into());
    }
    file.strip_prefix(session_root)
        .map_err(|_| "Session file is outside Pion's private session root".to_string())?
        .to_str()
        .ok_or("Session path is not valid UTF-8".to_string())
        .map(str::to_string)
}

fn validate_pending_session_file(file: &Path, root: &Path) -> Result<(), String> {
    if file.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("Pending session path must be a JSONL file".into());
    }
    let session_root = session_root(root)?;
    let parent = file
        .parent()
        .ok_or("Pending session path has no parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !parent.starts_with(session_root) {
        return Err("Session file is outside Pion's private session root".into());
    }
    Ok(())
}

fn relative_session_target(file: &Path, root: &Path) -> Result<(String, bool), String> {
    if file.exists() {
        return relative_session_file(file, root).map(|relative| (relative, false));
    }
    validate_pending_session_file(file, root)?;
    let session_root = session_root(root)?;
    let parent = file
        .parent()
        .ok_or("Pending session path has no parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let name = file
        .file_name()
        .ok_or("Pending session path has no file name")?;
    let target = parent.join(name);
    target
        .strip_prefix(session_root)
        .map_err(|_| "Session file is outside Pion's private session root".to_string())?
        .to_str()
        .ok_or("Session path is not valid UTF-8".to_string())
        .map(|relative| (relative.to_string(), true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unread_state_survives_reload_without_changing_catalog_file() {
        let root = std::env::temp_dir().join(format!("pion-unread-{}", id()));
        std::fs::create_dir_all(&root).unwrap();
        let mut catalog = Catalog::default();
        let project = catalog.add_project(&root).unwrap();
        let task = catalog.create(&project.id, "Background").unwrap();
        catalog.save(&root).unwrap();
        let unread = UnreadState::read(&root).unwrap();
        unread.set(&task.id, true).unwrap();
        let restored = UnreadState::read(&root).unwrap();
        let mut catalog = Catalog::read(&root).unwrap();
        assert!(!catalog.tasks[0].unread);
        restored.apply(&mut catalog).unwrap();
        assert!(catalog.tasks[0].unread);
        restored.set(&task.id, false).unwrap();
        UnreadState::read(&root)
            .unwrap()
            .apply(&mut catalog)
            .unwrap();
        assert!(!catalog.tasks[0].unread);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tasks_keep_distinct_sessions_and_persist_navigation() {
        let root = std::env::temp_dir().join(format!("pion-tasks-{}", id()));
        std::fs::create_dir_all(&root).unwrap();
        let mut catalog = Catalog::default();
        let project = catalog.add_project(&root).unwrap();
        assert_eq!(catalog.add_project(&root).unwrap().id, project.id);
        assert!(catalog.create("missing", "No").is_err());
        let first = catalog.create(&project.id, "First").unwrap();
        let second = catalog.create(&project.id, "Second").unwrap();
        assert_ne!(
            catalog.resolve(&first.id, &root).unwrap().1,
            catalog.resolve(&second.id, &root).unwrap().1
        );
        catalog.save(&root).unwrap();
        let restored = Catalog::read(&root).unwrap();
        assert_eq!(restored.tasks[1].title, "First");
        assert_eq!(
            restored.project_root(&project.id).unwrap(),
            root.canonicalize().unwrap()
        );
        assert!(restored.resolve("../escape", &root).is_err());
        let session_dir = root.join("sessions").join(&first.id);
        std::fs::create_dir_all(&session_dir).unwrap();
        let session_file = session_dir.join("session.jsonl");
        std::fs::write(&session_file, "{}\n").unwrap();
        catalog
            .attach_session(&first.id, &session_file, &root)
            .unwrap();
        let fork = catalog
            .create_from_session(&first.id, "Fork", &session_file, &root)
            .unwrap();
        let clone = catalog
            .create_from_session(&first.id, "Clone", &session_file, &root)
            .unwrap();
        assert_ne!(fork.id, clone.id);
        assert_eq!(fork.project_id, first.project_id);
        assert_eq!(clone.project_id, first.project_id);
        assert_eq!(
            catalog.resolve(&fork.id, &root).unwrap().2.unwrap(),
            session_file.canonicalize().unwrap()
        );
        assert_eq!(
            catalog.resolve(&clone.id, &root).unwrap().2.unwrap(),
            session_file.canonicalize().unwrap()
        );
        assert!(serde_json::to_value(&catalog).unwrap()["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|task| task.get("sessionFile").is_none()
                && task.get("sessionPending").is_none()
                && task.get("importedFrom").is_none()));
        let pending_file = session_dir.join("pending.jsonl");
        let pending = catalog
            .create_from_session(&first.id, "Pending fork", &pending_file, &root)
            .unwrap();
        assert!(catalog.resolve(&pending.id, &root).unwrap().2.is_none());
        catalog.save(&root).unwrap();
        let restored = Catalog::read(&root).unwrap();
        assert!(restored.resolve(&pending.id, &root).unwrap().2.is_none());
        std::fs::write(&pending_file, "{}\n").unwrap();
        assert_eq!(
            restored.resolve(&pending.id, &root).unwrap().2.unwrap(),
            pending_file.canonicalize().unwrap()
        );
        let outside = std::env::temp_dir().join(format!("outside-{}.jsonl", id()));
        std::fs::write(&outside, "{}\n").unwrap();
        let task_count = catalog.tasks.len();
        assert!(catalog
            .create_from_session(&first.id, "Escape", &outside, &root)
            .is_err());
        assert_eq!(catalog.tasks.len(), task_count);
        std::fs::remove_file(outside).unwrap();
        let outside_pending = std::env::temp_dir().join(format!("outside-{}.jsonl", id()));
        assert!(catalog
            .create_from_session(&first.id, "Pending escape", &outside_pending, &root)
            .is_err());
        assert_eq!(catalog.tasks.len(), task_count);
        std::fs::remove_dir_all(root).unwrap();
    }
}
