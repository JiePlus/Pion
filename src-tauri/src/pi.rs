use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};

const MAX_FRAME: usize = 40 * 1024 * 1024;
const MAX_REQUEST: usize = 36 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// LF is the only delimiter. Unicode U+2028/U+2029 remain inside JSON strings.
async fn read_frame<B: AsyncBufRead + Unpin>(reader: &mut B) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let n = (&mut *reader)
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await
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

/// What a session's actor is asked to do. The actor is the only owner of the Pi
/// process, its stdin and its table of waiting requests.
enum Command {
    /// Write an RPC line; its response goes to `reply`.
    Request {
        id: String,
        line: String,
        reply: oneshot::Sender<Value>,
    },
    /// The caller gave up waiting; drop its reply slot.
    Forget(String),
    /// Write a line that expects no response (extension UI answers).
    Line(String),
    Stop,
}

/// Writes lines to a session's Pi through its actor.
#[derive(Clone)]
pub struct LineWriter(mpsc::UnboundedSender<Command>);

impl LineWriter {
    fn write(&self, line: String) -> Result<(), String> {
        self.0
            .send(Command::Line(line))
            .map_err(|_| "Pi is disconnected".to_string())
    }
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
    stdin: Option<LineWriter>,
    pending: HashMap<String, PendingUi>,
}

#[derive(Default)]
pub struct ExtensionUiBridge {
    sessions: HashMap<u64, ExtensionUiSession>,
}

impl ExtensionUiBridge {
    fn activate(&mut self, generation: u64, stdin: LineWriter) {
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
                stdin.write(
                    json!({"type":"extension_ui_response","id":id,"cancelled":true}).to_string(),
                )?;
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
        stdin.write(message.to_string())
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
        stdin.write(json!({"type":"extension_ui_response","id":id,"cancelled":true}).to_string())
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
        for id in ids {
            let _ = stdin.write(
                json!({"type":"extension_ui_response","id":id,"cancelled":true}).to_string(),
            );
        }
    }
}

/// Where Pi events go: the main window's own channel once it has registered one,
/// otherwise a broadcast `pi:event`. Only the visible session's events are sent.
#[derive(Default)]
pub struct EventSink(Mutex<Option<tauri::ipc::Channel<Value>>>);

impl EventSink {
    pub fn set(&self, channel: tauri::ipc::Channel<Value>) {
        if let Ok(mut current) = self.0.lock() {
            *current = Some(channel);
        }
    }
}

fn publish<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: Value) {
    if let Some(sink) = app.try_state::<EventSink>() {
        if let Ok(channel) = sink.0.lock() {
            if let Some(channel) = channel.as_ref() {
                let _ = channel.send(payload);
                return;
            }
        }
    }
    let _ = app.emit("pi:event", payload);
}

pub enum SessionTarget<'a> {
    Directory(&'a Path),
    File(&'a Path),
    /// No session yet: a warm spare that later binds to one with `switch_session`.
    Ephemeral,
}

/// Requests waiting for their response, keyed by request id. Pi may answer
/// concurrent requests in any order; each response goes to its own waiter.
#[derive(Default)]
struct Pending {
    waiters: HashMap<String, oneshot::Sender<Value>>,
    closed: Option<String>,
}

impl Pending {
    fn insert(&mut self, id: String, reply: oneshot::Sender<Value>) {
        match &self.closed {
            Some(reason) => {
                let _ = reply.send(json!({ "transportError": reason }));
            }
            None => {
                self.waiters.insert(id, reply);
            }
        }
    }

    /// Hands a response to its waiter. Late responses to abandoned requests are dropped.
    fn resolve(&mut self, frame: Value) {
        if let Some(reply) = frame["id"].as_str().and_then(|id| self.waiters.remove(id)) {
            let _ = reply.send(frame);
        }
    }

    fn forget(&mut self, id: &str) {
        self.waiters.remove(id);
    }

    /// The transport ended: fail every waiting request and refuse new ones.
    fn close(&mut self, reason: &str) {
        self.closed = Some(reason.to_string());
        for (_, reply) in self.waiters.drain() {
            let _ = reply.send(json!({ "transportError": reason }));
        }
    }
}

/// State the actor and the handle share.
struct Shared<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    alive: AtomicBool,
    working: AtomicBool,
    visible: AtomicBool,
    task_id: Mutex<Option<String>>,
    generation: u64,
}

impl<R: tauri::Runtime> Shared<R> {
    fn task_id(&self) -> Option<String> {
        self.task_id.lock().ok().and_then(|task_id| task_id.clone())
    }

    /// Everything Pi sends that is not a response: task status, extension UI and
    /// the visible session's event stream.
    fn event(&self, frame: Value) {
        let generation = self.generation;
        let task_id = self.task_id();
        if frame["type"] == "agent_start" {
            self.working.store(true, Ordering::Release);
            if let Some(task_id) = &task_id {
                let _ = self
                    .app
                    .emit("task:status", json!({"taskId":task_id,"state":"working"}));
            }
        } else if frame["type"] == "agent_settled" {
            self.working.store(false, Ordering::Release);
            if let Some(task_id) = &task_id {
                let unread = !self.visible.load(Ordering::Acquire);
                if unread {
                    let _ = self
                        .app
                        .state::<Arc<crate::tasks::UnreadState>>()
                        .set(task_id, true);
                }
                let _ = self.app.emit(
                    "task:status",
                    json!({"taskId":task_id,"state":"idle","unread":unread}),
                );
            }
        }
        let visible = self.visible.load(Ordering::Acquire);
        if frame["type"] == "extension_ui_request" {
            let tracked = self
                .app
                .state::<Mutex<ExtensionUiBridge>>()
                .lock()
                .map_err(|e| e.to_string())
                .and_then(|mut bridge| {
                    if visible {
                        bridge.track(generation, &frame)
                    } else {
                        bridge.cancel(generation, &frame)
                    }
                });
            if let Err(error) = tracked {
                publish(
                    &self.app,
                    json!({"generation":generation,"taskId":task_id,"event":{"type":"desktop_extension_ui_error", "error":error}}),
                );
            } else if visible {
                publish(
                    &self.app,
                    json!({"generation":generation,"taskId":task_id,"event":frame}),
                );
            }
        } else if visible {
            // Hidden sessions (background tasks, spares) report progress through
            // task:status; their stream is not serialized at all.
            publish(
                &self.app,
                json!({"generation":generation,"taskId":task_id,"event":frame}),
            );
        }
    }

    /// The session ended. Unless it was stopped on purpose, say so.
    fn ended(&self, reason: &str) {
        if let Ok(mut bridge) = self.app.state::<Mutex<ExtensionUiBridge>>().lock() {
            bridge.clear(self.generation);
        }
        if self.alive.swap(false, Ordering::AcqRel) {
            let task_id = self.task_id();
            if let Some(task_id) = &task_id {
                let _ = self.app.emit(
                    "task:status",
                    json!({"taskId":task_id,"state":"disconnected"}),
                );
            }
            let _ = self.app.emit(
                "pi:status",
                json!({"generation":self.generation,"taskId":task_id,"state":"disconnected", "detail":reason}),
            );
        }
    }
}

async fn write_line(stdin: &mut ChildStdin, line: &str) -> Result<(), String> {
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

/// Reads stdout into frames for the actor. A separate task, so the actor's
/// `select!` never cancels a half-read line.
async fn read_frames(
    stdout: ChildStdout,
    frames: mpsc::UnboundedSender<Result<Option<Value>, String>>,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        let frame = read_frame(&mut reader).await;
        let more = matches!(frame, Ok(Some(_)));
        if frames.send(frame).is_err() || !more {
            return;
        }
    }
}

/// Drains bytes, not unbounded lines. Diagnostics never become RPC records.
async fn drain_stderr(mut stderr: ChildStderr) {
    let mut buffer = [0; 4096];
    while let Ok(n) = stderr.read(&mut buffer).await {
        if n == 0 {
            break;
        }
        eprintln!("Pi stderr: {}", String::from_utf8_lossy(&buffer[..n]));
    }
}

/// The session's actor: owns the process and its stdin, writes requests in the
/// order they are sent, and routes each response to its waiter.
async fn run<R: tauri::Runtime>(
    mut child: Child,
    mut stdin: ChildStdin,
    mut commands: mpsc::UnboundedReceiver<Command>,
    mut frames: mpsc::UnboundedReceiver<Result<Option<Value>, String>>,
    shared: Arc<Shared<R>>,
) {
    let mut pending = Pending::default();
    let reason = loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::Request { id, line, reply }) => {
                    pending.insert(id, reply);
                    if let Err(error) = write_line(&mut stdin, &line).await {
                        break error;
                    }
                }
                Some(Command::Line(line)) => {
                    if let Err(error) = write_line(&mut stdin, &line).await {
                        break error;
                    }
                }
                Some(Command::Forget(id)) => pending.forget(&id),
                Some(Command::Stop) | None => break "Pi stopped".to_string(),
            },
            frame = frames.recv() => match frame {
                Some(Ok(Some(frame))) => {
                    if frame["type"] == "response" {
                        pending.resolve(frame);
                    } else if shared.alive.load(Ordering::Acquire) {
                        shared.event(frame);
                    }
                }
                Some(Ok(None)) | None => break "Pi process exited".to_string(),
                Some(Err(error)) => break error,
            },
        }
    };
    pending.close(&reason);
    shared.ended(&reason);
    let _ = child.kill().await;
}

/// One Pi RPC process, run by its own actor on the async runtime. All methods
/// take `&self`, so callers share it as `Arc<Pi>` and talk to it without
/// holding any application-wide lock.
pub struct Pi<R: tauri::Runtime = tauri::Wry> {
    shared: Arc<Shared<R>>,
    commands: mpsc::UnboundedSender<Command>,
    sequence: AtomicU64,
    stopped: AtomicBool,
    pid: Option<u32>,
}

impl<R: tauri::Runtime> Pi<R> {
    pub fn start(
        app: tauri::AppHandle<R>,
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
        // Node's on-disk compile cache, next to Pion's other data, so later starts
        // skip compiling modules a previous start already compiled.
        if let Some(data) = extension.parent() {
            command.env("NODE_COMPILE_CACHE", data.join("node-compile-cache"));
        }
        command
            .args(["--mode", "rpc"])
            .arg("--extension")
            .arg(extension)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A spare stays hidden until it is bound to a task.
        let spare = matches!(session, Some(SessionTarget::Ephemeral));
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
            Some(SessionTarget::Ephemeral) => {
                command.arg("--no-session");
            }
            None => {}
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut command = tokio::process::Command::from(command);
        command.kill_on_drop(true);
        // Spawning needs the async runtime's reactor; callers are plain threads.
        let mut child = tauri::async_runtime::block_on(async move { command.spawn() })
            .map_err(|e| format!("Cannot start Pi: {e}. Set its absolute executable path."))?;
        let pid = child.id();
        let stdin = child.stdin.take().ok_or("No Pi stdin")?;
        let stdout = child.stdout.take().ok_or("No Pi stdout")?;
        let stderr = child.stderr.take().ok_or("No Pi stderr")?;
        let (commands, receiver) = mpsc::unbounded_channel();
        app.state::<Mutex<ExtensionUiBridge>>()
            .lock()
            .map_err(|e| e.to_string())?
            .activate(generation, LineWriter(commands.clone()));
        let shared = Arc::new(Shared {
            app,
            alive: AtomicBool::new(true),
            working: AtomicBool::new(false),
            visible: AtomicBool::new(!spare),
            task_id: Mutex::new(task_id),
            generation,
        });
        let (frames, frame_receiver) = mpsc::unbounded_channel();
        tauri::async_runtime::spawn(drain_stderr(stderr));
        tauri::async_runtime::spawn(read_frames(stdout, frames));
        tauri::async_runtime::spawn(run(child, stdin, receiver, frame_receiver, shared.clone()));
        Ok(Self {
            shared,
            commands,
            sequence: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
            pid,
        })
    }

    /// Sends one RPC and waits for its response. Safe to call from several threads
    /// at once; the actor matches responses by id.
    pub fn request(&self, mut request: Value) -> Result<Value, String> {
        if !self.shared.alive.load(Ordering::Acquire) {
            return Err("Pi is disconnected; reconnect it".into());
        }
        let id = format!("pion-{}", self.sequence.fetch_add(1, Ordering::AcqRel) + 1);
        let command = request["type"]
            .as_str()
            .ok_or("Missing Pi command")?
            .to_string();
        request["id"] = json!(id);
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        if line.len() > MAX_REQUEST {
            return Err("Pi request too large".into());
        }
        let (reply, response) = oneshot::channel();
        self.commands
            .send(Command::Request {
                id: id.clone(),
                line,
                reply,
            })
            .map_err(|_| "Pi is disconnected; reconnect it".to_string())?;
        let response = tauri::async_runtime::block_on(self.wait(&id, response))?;
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

    /// Waits for a response. A pending extension dialog pauses the timeout: the
    /// request cannot finish before the user answers it.
    async fn wait(
        &self,
        id: &str,
        mut response: oneshot::Receiver<Value>,
    ) -> Result<Value, String> {
        let mut deadline = Instant::now() + REQUEST_TIMEOUT;
        loop {
            match tokio::time::timeout(Duration::from_millis(250), &mut response).await {
                Ok(Ok(value)) => return Ok(value),
                Ok(Err(_)) => {
                    self.stop();
                    return Err("Pi disconnected".into());
                }
                Err(_) => {
                    let waiting_for_ui = self
                        .shared
                        .app
                        .state::<Mutex<ExtensionUiBridge>>()
                        .lock()
                        .map_err(|e| e.to_string())?
                        .has_pending(self.shared.generation);
                    if waiting_for_ui {
                        deadline = Instant::now() + REQUEST_TIMEOUT;
                    } else if Instant::now() >= deadline {
                        let _ = self.commands.send(Command::Forget(id.to_string()));
                        self.stop();
                        return Err(
                            "Pi request timed out/disconnected; stopped Pi. No request was replayed."
                                .into(),
                        );
                    }
                }
            }
        }
    }

    pub fn is_working(&self) -> bool {
        self.shared.working.load(Ordering::Acquire)
    }

    pub fn is_alive(&self) -> bool {
        self.shared.alive.load(Ordering::Acquire)
    }

    pub fn set_visible(&self, visible: bool) {
        let previous = self.shared.visible.swap(visible, Ordering::AcqRel);
        if previous && !visible {
            if let Ok(mut bridge) = self.shared.app.state::<Mutex<ExtensionUiBridge>>().lock() {
                bridge.cancel_pending(self.shared.generation);
            }
        }
    }

    pub fn generation(&self) -> u64 {
        self.shared.generation
    }

    pub fn set_task_id(&self, task_id: Option<String>) {
        if let Ok(mut current) = self.shared.task_id.lock() {
            *current = task_id;
        }
    }

    /// Stops the process at once; the actor then reaps it and fails waiting requests.
    pub fn stop(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        self.shared.alive.store(false, Ordering::Release);
        if let Ok(mut bridge) = self.shared.app.state::<Mutex<ExtensionUiBridge>>().lock() {
            bridge.clear(self.shared.generation);
        }
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // Each child was started in a new process group owned by this adapter.
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        let _ = self.commands.send(Command::Stop);
    }
}

impl<R: tauri::Runtime> Drop for Pi<R> {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_handles_unicode_crlf_and_rejects_bad_records() {
        tauri::async_runtime::block_on(async {
            let input = "{\"text\":\"a\u{2028}b\u{2029}c\"}\r\n{\"type\":\"agent_start\"}\n";
            let mut reader = BufReader::new(input.as_bytes());
            assert_eq!(
                read_frame(&mut reader).await.unwrap().unwrap()["text"],
                "a\u{2028}b\u{2029}c"
            );
            assert_eq!(
                read_frame(&mut reader).await.unwrap().unwrap()["type"],
                "agent_start"
            );
            assert!(read_frame(&mut reader).await.unwrap().is_none());
            assert!(read_frame(&mut BufReader::new(b"{}".as_slice()))
                .await
                .is_err());
            assert!(read_frame(&mut BufReader::new(b"oops\n".as_slice()))
                .await
                .is_err());
            let huge = vec![b'x'; MAX_FRAME + 1];
            assert!(read_frame(&mut BufReader::new(huge.as_slice()))
                .await
                .is_err());
        });
    }

    #[test]
    fn responses_reach_their_own_waiter_in_any_order() {
        let mut pending = Pending::default();
        let (reply, mut first) = oneshot::channel();
        pending.insert("pion-1".into(), reply);
        let (reply, mut second) = oneshot::channel();
        pending.insert("pion-2".into(), reply);
        pending.resolve(json!({"type":"response","id":"pion-2","data":2}));
        pending.resolve(json!({"type":"response","id":"pion-1","data":1}));
        assert_eq!(first.try_recv().unwrap()["data"], 1);
        assert_eq!(second.try_recv().unwrap()["data"], 2);
        // A late answer to an abandoned request goes nowhere.
        let (reply, mut abandoned) = oneshot::channel();
        pending.insert("pion-3".into(), reply);
        pending.forget("pion-3");
        pending.resolve(json!({"type":"response","id":"pion-3"}));
        assert!(abandoned.try_recv().is_err());
    }

    #[test]
    fn closing_fails_waiters_and_refuses_new_requests() {
        let mut pending = Pending::default();
        let (reply, mut waiting) = oneshot::channel();
        pending.insert("pion-1".into(), reply);
        pending.close("Pi process exited");
        assert_eq!(
            waiting.try_recv().unwrap()["transportError"],
            "Pi process exited"
        );
        let (reply, mut late) = oneshot::channel();
        pending.insert("pion-2".into(), reply);
        assert_eq!(
            late.try_recv().unwrap()["transportError"],
            "Pi process exited"
        );
    }

    /// Runs the real transport against a fake Pi that answers "slow" late and
    /// everything else at once, so responses arrive out of order.
    #[cfg(unix)]
    #[test]
    fn concurrent_requests_do_not_wait_for_each_other() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pion-fake-pi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("pi");
        std::fs::write(
            &fake,
            r#"#!/usr/bin/env node
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, type } = JSON.parse(line);
  const reply = () =>
    process.stdout.write(JSON.stringify({ type: "response", id, command: type, success: true, data: { echo: type } }) + "\n");
  type === "slow" ? setTimeout(reply, 600) : reply();
});
"#,
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let app = tauri::test::mock_app();
        app.manage(Mutex::new(ExtensionUiBridge::default()));
        let pi = Arc::new(
            Pi::start(
                app.handle().clone(),
                fake.to_str().unwrap(),
                &dir,
                &dir.join("extension.js"),
                1,
                None,
                Some(SessionTarget::Ephemeral),
            )
            .unwrap(),
        );
        let slow = {
            let pi = pi.clone();
            std::thread::spawn(move || pi.request(json!({"type":"slow"})))
        };
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        assert_eq!(pi.request(json!({"type":"fast"})).unwrap()["echo"], "fast");
        assert!(started.elapsed() < Duration::from_millis(400));
        assert_eq!(slow.join().unwrap().unwrap()["echo"], "slow");
        pi.stop();
        assert!(pi.request(json!({"type":"fast"})).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A warm spare from the real Pi binds to an existing session with switch_session.
    /// Opt-in: `PI_EXECUTABLE=/path/to/pi cargo test spare_binds -- --ignored`.
    #[test]
    #[ignore]
    fn spare_binds_to_an_existing_session() {
        let Ok(executable) = std::env::var("PI_EXECUTABLE") else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("pion-spare-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("session.jsonl");
        let header = json!({"type":"session","version":3,"id":"spare-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":dir});
        let message = json!({"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hello from the file","timestamp":0}});
        std::fs::write(&file, format!("{header}\n{message}\n")).unwrap();
        let app = tauri::test::mock_app();
        app.manage(Mutex::new(ExtensionUiBridge::default()));
        // Inside the temp dir, so Node's compile cache lands there too.
        let extension = dir.join("pion-core-extension.js");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/pion-core-extension.js"),
            &extension,
        )
        .unwrap();
        let spare = Pi::start(
            app.handle().clone(),
            &executable,
            &dir,
            &extension,
            1,
            None,
            Some(SessionTarget::Ephemeral),
        )
        .unwrap();
        assert!(spare.request(json!({"type":"get_state"})).is_ok());
        let started = Instant::now();
        spare
            .request(json!({"type":"switch_session","sessionPath":file}))
            .unwrap();
        let bound = started.elapsed();
        let state = spare.request(json!({"type":"get_state"})).unwrap();
        assert_eq!(state["sessionFile"], json!(file));
        let messages = spare.request(json!({"type":"get_messages"})).unwrap();
        assert_eq!(messages["messages"][0]["content"], "hello from the file");
        eprintln!("switch_session took {bound:?}");
        assert!(
            dir.join("node-compile-cache").is_dir(),
            "compile cache in use"
        );
        let _ = std::fs::remove_dir_all(dir);
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
