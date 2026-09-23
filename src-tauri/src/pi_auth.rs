use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

pub struct Login {
    child: Child,
    stdin: ChildStdin,
    finished: Arc<AtomicBool>,
    pub id: u64,
}

pub fn node_command(executable: &str, helper: &Path) -> Result<Command, String> {
    let executable_path = Path::new(executable);
    let node = executable_path
        .parent()
        .map(|parent| parent.join("node"))
        .filter(|path| path.is_file())
        .unwrap_or_else(|| "node".into());
    let mut command = Command::new(node);
    if executable_path.is_absolute() {
        if let Some(parent) = executable_path.parent() {
            let mut paths = vec![parent.to_path_buf()];
            paths.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            command.env(
                "PATH",
                std::env::join_paths(paths).map_err(|e| e.to_string())?,
            );
        }
    }
    command.arg(helper).arg(executable);
    Ok(command)
}

pub fn open_url(url: &str) -> Result<(), String> {
    if url.len() > 8192
        || !(url.starts_with("https://") || url.starts_with("http://"))
        || url.chars().any(char::is_control)
    {
        return Err("Invalid Pi authorization URL".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    command
        .arg(url)
        .spawn()
        .map_err(|e| format!("Cannot open Pi authorization page: {e}"))?;
    Ok(())
}

pub fn providers(executable: &str, helper: &Path) -> Result<Value, String> {
    let output = node_command(executable, helper)?
        .arg("list")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start Pi SDK: {e}"))?;
    if output.stdout.len() > 64 * 1024 {
        return Err("Pi provider list is too large".into());
    }
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    if !output.status.success() || result["type"] == "error" {
        return Err(result["message"]
            .as_str()
            .unwrap_or("Pi provider listing failed")
            .into());
    }
    Ok(result)
}

pub fn discover_models(
    executable: &str,
    helper: &Path,
    provider: &str,
    api: &str,
) -> Result<Value, String> {
    let output = node_command(executable, helper)?
        .arg("discover")
        .arg(provider)
        .arg(api)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start Pi model discovery: {e}"))?;
    if output.stdout.len() > 512 * 1024 {
        return Err("Pi model list is too large".into());
    }
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    if !output.status.success() || result["type"] == "error" {
        return Err(result["message"]
            .as_str()
            .unwrap_or("Pi model discovery failed")
            .into());
    }
    Ok(result)
}

impl Login {
    pub fn start(
        app: tauri::AppHandle,
        executable: &str,
        helper: &Path,
        provider: &str,
        id: u64,
    ) -> Result<Self, String> {
        let mut child = node_command(executable, helper)?
            .arg("login")
            .arg(provider)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Cannot start Pi login: {e}"))?;
        let stdin = child.stdin.take().ok_or("No Pi login input")?;
        let stdout = child.stdout.take().ok_or("No Pi login output")?;
        let finished = Arc::new(AtomicBool::new(false));
        let done = finished.clone();
        std::thread::spawn(move || {
            let mut terminal = false;
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.len() > 16 * 1024 {
                    continue;
                }
                let Ok(event) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let kind = event["type"].as_str().unwrap_or("");
                terminal |= ["success", "error", "cancelled"].contains(&kind);
                let _ = app.emit("model-auth:event", json!({"loginId":id,"event":event}));
            }
            if !terminal {
                let _ = app.emit(
                    "model-auth:event",
                    json!({"loginId":id,"event":{"type":"error","message":"Pi login stopped"}}),
                );
            }
            done.store(true, Ordering::Release);
        });
        Ok(Self {
            child,
            stdin,
            finished,
            id,
        })
    }

    pub fn finished(&self) -> bool {
        self.finished.load(Ordering::Acquire)
    }

    pub fn respond(&mut self, value: Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, &value).map_err(|e| e.to_string())?;
        self.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())
    }
}

impl Drop for Login {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
