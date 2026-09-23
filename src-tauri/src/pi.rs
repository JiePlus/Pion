use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const MAX_FRAME: usize = 40 * 1024 * 1024;
const MAX_REQUEST: usize = 36 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// LF is the only delimiter. Unicode U+2028/U+2029 remain inside JSON strings.
fn read_frame(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let n = reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(None);
    }
    if n > MAX_FRAME {
        return Err("Pi frame exceeds 40 MB".into());
    }
    if bytes.last() != Some(&b'\n') {
        return Err("Truncated Pi JSONL frame".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("Invalid Pi JSONL: {e}"))
}

struct PendingUi {
    method: String,
    expires: Option<Instant>,
}

fn extension_ui_response(id: &str, method: &str, response: &Value) -> Result<Value, String> {
    let cancelled = response["cancelled"].as_bool() == Some(true);
    let valid = cancelled
        || if method == "confirm" {
            response["confirmed"].is_boolean()
        } else {
            response["value"].is_string()
        };
    if !valid {
        return Err("Invalid extension UI response".into());
    }
    let mut message = json!({"type":"extension_ui_response", "id":id});
    if cancelled {
        message["cancelled"] = json!(true);
    } else if method == "confirm" {
        message["confirmed"] = response["confirmed"].clone();
    } else {
        message["value"] = response["value"].clone();
    }
    Ok(message)
}

#[derive(Default)]
struct ExtensionUiSession {
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    pending: HashMap<String, PendingUi>,
}

#[derive(Default)]
pub struct ExtensionUiBridge {
    sessions: HashMap<u64, ExtensionUiSession>,
}

impl ExtensionUiBridge {
    fn activate(&mut self, generation: u64, stdin: Arc<Mutex<ChildStdin>>) {
        self.sessions.insert(
            generation,
            ExtensionUiSession {
                stdin: Some(stdin),
                pending: HashMap::new(),
            },
        );
    }

    fn track(&mut self, generation: u64, request: &Value) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(&generation)
            .ok_or("Stale Pi generation")?;
        let id = request["id"].as_str().ok_or("Missing extension UI id")?;
        let method = request["method"]
            .as_str()
            .ok_or("Missing extension UI method")?;
        let supported = [
            "select",
            "confirm",
            "input",
            "editor",
            "notify",
            "setStatus",
            "setWidget",
            "setTitle",
            "set_editor_text",
        ];
        if !supported.contains(&method) {
            if let Some(stdin) = &session.stdin {
                let mut input = stdin.lock().map_err(|e| e.to_string())?;
                writeln!(
                    input,
                    "{}",
                    json!({"type":"extension_ui_response","id":id,"cancelled":true})
                )
                .map_err(|e| e.to_string())?;
                input.flush().map_err(|e| e.to_string())?;
            }
            return Err(format!("Unsupported extension UI method: {method}"));
        }
        if !["select", "confirm", "input", "editor"].contains(&method) {
            return Ok(());
        }
        if session.pending.contains_key(id) {
            return Err("Duplicate extension UI id".into());
        }
        let expires = request["timeout"]
            .as_u64()
            .map(|milliseconds| Instant::now() + Duration::from_millis(milliseconds));
        session.pending.insert(
            id.into(),
            PendingUi {
                method: method.into(),
                expires,
            },
        );
        Ok(())
    }

    fn has_pending(&mut self, generation: u64) -> bool {
        let Some(session) = self.sessions.get_mut(&generation) else {
            return false;
        };
        let now = Instant::now();
        session
            .pending
            .retain(|_, pending| pending.expires.is_none_or(|expires| expires > now));
        !session.pending.is_empty()
    }

    pub fn respond(&mut self, generation: u64, id: &str, response: &Value) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(&generation)
            .ok_or("Stale Pi generation")?;
        let pending = session
            .pending
            .remove(id)
            .ok_or("Extension UI request is no longer pending")?;
        if pending
            .expires
            .is_some_and(|expires| expires <= Instant::now())
        {
            return Err("Extension UI request timed out".into());
        }
        let message = extension_ui_response(id, &pending.method, response)?;
        let stdin = session.stdin.as_ref().ok_or("Pi is disconnected")?;
        let mut input = stdin.lock().map_err(|e| e.to_string())?;
        writeln!(input, "{message}").map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    }

    pub fn clear(&mut self, generation: u64) {
        self.sessions.remove(&generation);
    }

    fn cancel(&mut self, generation: u64, request: &Value) -> Result<(), String> {
        let method = request["method"].as_str().unwrap_or("");
        if !["select", "confirm", "input", "editor"].contains(&method) {
            return Ok(());
        }
        let id = request["id"].as_str().ok_or("Missing extension UI id")?;
        let session = self
            .sessions
            .get(&generation)
            .ok_or("Stale Pi generation")?;
        let stdin = session.stdin.as_ref().ok_or("Pi is disconnected")?;
        let mut input = stdin.lock().map_err(|e| e.to_string())?;
        writeln!(
            input,
            "{}",
            json!({"type":"extension_ui_response","id":id,"cancelled":true})
        )
        .map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    }

    fn cancel_pending(&mut self, generation: u64) {
        let Some(session) = self.sessions.get_mut(&generation) else {
            return;
        };
        let ids = session
            .pending
            .drain()
            .map(|(id, _)| id)
            .collect::<Vec<_>>();
        let Some(stdin) = &session.stdin else {
            return;
        };
        let Ok(mut input) = stdin.lock() else {
            return;
        };
        for id in ids {
            let _ = writeln!(
                input,
                "{}",
                json!({"type":"extension_ui_response","id":id,"cancelled":true})
            );
        }
        let _ = input.flush();
    }
}

pub enum SessionTarget<'a> {
    Directory(&'a Path),
    File(&'a Path),
}

pub struct Pi {
    app: tauri::AppHandle,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    responses: mpsc::Receiver<Value>,
    alive: Arc<AtomicBool>,
    working: Arc<AtomicBool>,
    visible: Arc<AtomicBool>,
    task_id: Arc<Mutex<Option<String>>>,
    generation: u64,
    sequence: u64,
    stopped: bool,
}

impl Pi {
    pub fn start(
        app: tauri::AppHandle,
        executable: &str,
        cwd: &Path,
        extension: &Path,
        generation: u64,
        task_id: Option<String>,
        session: Option<SessionTarget<'_>>,
    ) -> Result<Self, String> {
        let mut command = crate::pi_setup::pi_command(Path::new(executable))?;
        // An npm-installed Pi uses /usr/bin/env node. Finder does not inherit nvm's PATH.
        let executable_path = Path::new(executable);
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
        command
            .args(["--mode", "rpc"])
            .arg("--extension")
            .arg(extension)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match session {
            Some(SessionTarget::Directory(directory)) => {
                std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
                command
                    .arg("--session-dir")
                    .arg(directory)
                    .arg("--continue");
            }
            Some(SessionTarget::File(file)) => {
                command.arg("--session").arg(file);
            }
            None => {}
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start Pi: {e}. Set its absolute executable path."))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("No Pi stdin")?));
        app.state::<Mutex<ExtensionUiBridge>>()
            .lock()
            .map_err(|e| e.to_string())?
            .activate(generation, stdin.clone());
        let stdout = child.stdout.take().ok_or("No Pi stdout")?;
        let stderr = child.stderr.take().ok_or("No Pi stderr")?;
        let alive = Arc::new(AtomicBool::new(true));
        let working = Arc::new(AtomicBool::new(false));
        let visible = Arc::new(AtomicBool::new(true));
        let task_id = Arc::new(Mutex::new(task_id));
        let reader_working = working.clone();
        let reader_visible = visible.clone();
        let reader_task_id = task_id.clone();
        let (sender, responses) = mpsc::channel();
        let reader_alive = alive.clone();
        let reader_app = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let reason = loop {
                match read_frame(&mut reader) {
                    Ok(Some(frame)) => {
                        if !reader_alive.load(Ordering::Acquire) {
                            return;
                        }
                        let event_task_id = reader_task_id
                            .lock()
                            .ok()
                            .and_then(|task_id| task_id.clone());
                        if frame["type"] == "agent_start" {
                            reader_working.store(true, Ordering::Release);
                            if let Some(task_id) = &event_task_id {
                                let _ = reader_app.emit(
                                    "task:status",
                                    json!({"taskId":task_id,"state":"working"}),
                                );
                            }
                        } else if frame["type"] == "agent_settled" {
                            reader_working.store(false, Ordering::Release);
                            if let Some(task_id) = &event_task_id {
                                let unread = !reader_visible.load(Ordering::Acquire);
                                if unread {
                                    let _ = reader_app
                                        .state::<Arc<crate::tasks::UnreadState>>()
                                        .set(task_id, true);
                                }
                                let _ = reader_app.emit(
                                    "task:status",
                                    json!({"taskId":task_id,"state":"idle","unread":unread}),
                                );
                            }
                        }
                        if frame["type"] == "response" {
                            let _ = sender.send(frame);
                        } else if frame["type"] == "extension_ui_request" {
                            let tracked = reader_app
                                .state::<Mutex<ExtensionUiBridge>>()
                                .lock()
                                .map_err(|e| e.to_string())
                                .and_then(|mut bridge| {
                                    if reader_visible.load(Ordering::Acquire) {
                                        bridge.track(generation, &frame)
                                    } else {
                                        bridge.cancel(generation, &frame)
                                    }
                                });
                            if let Err(error) = tracked {
                                let _ = reader_app.emit(
                                    "pi:event",
                                    json!({"generation":generation,"taskId":event_task_id,"event":{"type":"desktop_extension_ui_error", "error":error}}),
                                );
                            } else if reader_visible.load(Ordering::Acquire) {
                                let _ = reader_app.emit(
                                    "pi:event",
                                    json!({"generation":generation,"taskId":event_task_id,"event":frame}),
                                );
                            }
                        } else {
                            let _ = reader_app.emit(
                                "pi:event",
                                json!({"generation":generation,"taskId":event_task_id,"event":frame}),
                            );
                        }
                    }
                    Ok(None) => break "Pi process exited".to_string(),
                    Err(error) => break error,
                }
            };
            if let Ok(mut bridge) = reader_app.state::<Mutex<ExtensionUiBridge>>().lock() {
                bridge.clear(generation);
            }
            let _ = sender.send(json!({"transportError":reason}));
            if reader_alive.swap(false, Ordering::AcqRel) {
                let event_task_id = reader_task_id
                    .lock()
                    .ok()
                    .and_then(|task_id| task_id.clone());
                if let Some(task_id) = &event_task_id {
                    let _ = reader_app.emit(
                        "task:status",
                        json!({"taskId":task_id,"state":"disconnected"}),
                    );
                }
                let _ = reader_app.emit(
                    "pi:status",
                    json!({"generation":generation,"taskId":event_task_id,"state":"disconnected", "detail":reason}),
                );
            }
        });
        let stderr_alive = alive.clone();
        std::thread::spawn(move || {
            // Drain bytes, not unbounded lines. Diagnostics never become RPC records.
            let mut reader = stderr;
            let mut buffer = [0; 4096];
            while let Ok(n) = reader.read(&mut buffer) {
                if n == 0 || !stderr_alive.load(Ordering::Acquire) {
                    break;
                }
                eprintln!("Pi stderr: {}", String::from_utf8_lossy(&buffer[..n]));
            }
        });
        Ok(Self {
            app,
            child,
            stdin,
            responses,
            alive,
            working,
            visible,
            task_id,
            generation,
            sequence: 0,
            stopped: false,
        })
    }

    pub fn request(&mut self, mut request: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Pi is disconnected; reconnect it".into());
        }
        self.sequence += 1;
        let id = format!("pion-{}", self.sequence);
        let command = request["type"]
            .as_str()
            .ok_or("Missing Pi command")?
            .to_string();
        request["id"] = json!(id);
        let encoded = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        if encoded.len() > MAX_REQUEST {
            return Err("Pi request too large".into());
        }
        {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            writeln!(stdin, "{encoded}").map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
        }
        let mut deadline = Instant::now() + REQUEST_TIMEOUT;
        let response = loop {
            match self.responses.recv_timeout(Duration::from_millis(250)) {
                Ok(response) => break response,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.stop();
                    return Err("Pi disconnected".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let waiting_for_ui = self
                        .app
                        .state::<Mutex<ExtensionUiBridge>>()
                        .lock()
                        .map_err(|e| e.to_string())?
                        .has_pending(self.generation);
                    if waiting_for_ui {
                        deadline = Instant::now() + REQUEST_TIMEOUT;
                    } else if Instant::now() >= deadline {
                        self.stop();
                        return Err(
                            "Pi request timed out/disconnected; stopped Pi. No request was replayed."
                                .into(),
                        );
                    }
                }
            }
        };
        if let Some(error) = response["transportError"].as_str() {
            return Err(error.into());
        }
        if response["id"] != id || response["command"] != command {
            self.stop();
            return Err("Pi response correlation failed; reconnect required".into());
        }
        if response["success"] != true {
            return Err(response["error"]
                .as_str()
                .unwrap_or("Pi request failed")
                .into());
        }
        Ok(response["data"].clone())
    }

    pub fn is_working(&self) -> bool {
        self.working.load(Ordering::Acquire)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    pub fn set_visible(&self, visible: bool) {
        let previous = self.visible.swap(visible, Ordering::AcqRel);
        if previous && !visible {
            if let Ok(mut bridge) = self.app.state::<Mutex<ExtensionUiBridge>>().lock() {
                bridge.cancel_pending(self.generation);
            }
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn set_task_id(&self, task_id: Option<String>) {
        if let Ok(mut current) = self.task_id.lock() {
            *current = task_id;
        }
    }

    pub fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        self.alive.store(false, Ordering::Release);
        if let Ok(mut bridge) = self.app.state::<Mutex<ExtensionUiBridge>>().lock() {
            bridge.clear(self.generation);
        }
        #[cfg(unix)]
        // Each child was started in a new process group owned by this adapter.
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Pi {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_handles_unicode_crlf_and_rejects_bad_records() {
        let input = "{\"text\":\"a\u{2028}b\u{2029}c\"}\r\n{\"type\":\"agent_start\"}\n";
        let mut reader = BufReader::new(input.as_bytes());
        assert_eq!(
            read_frame(&mut reader).unwrap().unwrap()["text"],
            "a\u{2028}b\u{2029}c"
        );
        assert_eq!(
            read_frame(&mut reader).unwrap().unwrap()["type"],
            "agent_start"
        );
        assert!(read_frame(&mut reader).unwrap().is_none());
        assert!(read_frame(&mut BufReader::new(b"{}".as_slice())).is_err());
        assert!(read_frame(&mut BufReader::new(b"oops\n".as_slice())).is_err());
        assert!(read_frame(&mut BufReader::new(vec![b'x'; MAX_FRAME + 1].as_slice())).is_err());
    }

    #[test]
    fn extension_ui_tracks_ids_timeouts_generations_and_cleanup() {
        let mut bridge = ExtensionUiBridge::default();
        bridge.sessions.insert(2, ExtensionUiSession::default());
        bridge
            .track(2, &json!({"id":"one","method":"confirm","timeout":1000}))
            .unwrap();
        assert!(bridge.has_pending(2));
        assert!(bridge
            .track(1, &json!({"id":"old","method":"input"}))
            .is_err());
        assert!(bridge
            .track(2, &json!({"id":"one","method":"input"}))
            .is_err());
        assert!(bridge
            .track(2, &json!({"id":"custom","method":"custom"}))
            .is_err());
        assert!(bridge
            .respond(1, "one", &json!({"confirmed":true}))
            .is_err());
        bridge
            .sessions
            .get_mut(&2)
            .unwrap()
            .pending
            .get_mut("one")
            .unwrap()
            .expires = Some(Instant::now());
        assert!(!bridge.has_pending(2));
        bridge
            .track(2, &json!({"id":"two","method":"editor"}))
            .unwrap();
        bridge.sessions.insert(3, ExtensionUiSession::default());
        bridge
            .track(3, &json!({"id":"three","method":"select"}))
            .unwrap();
        bridge.clear(1);
        assert!(bridge.has_pending(2));
        bridge.clear(2);
        assert!(!bridge.has_pending(2));
        assert!(bridge.has_pending(3));
        bridge.cancel_pending(3);
        assert!(!bridge.has_pending(3));
        assert_eq!(
            extension_ui_response("cancel", "input", &json!({"cancelled":true})).unwrap(),
            json!({"type":"extension_ui_response","id":"cancel","cancelled":true})
        );
        assert_eq!(
            extension_ui_response("confirm", "confirm", &json!({"confirmed":false})).unwrap(),
            json!({"type":"extension_ui_response","id":"confirm","confirmed":false})
        );
        assert!(extension_ui_response("bad", "editor", &json!({})).is_err());
    }
}
