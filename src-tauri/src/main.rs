#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod images;
mod models;
mod net;
mod packages;
mod pi;
mod pi_auth;
mod pi_setup;
mod plugins;
mod scan;
mod sessions;
mod skills;
mod tasks;
mod workspace;

use plugins::{atomic_write, Plugins};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_TASK_PROCESSES: usize = 4;

struct State {
    plugins: Plugins,
    workspace: Option<PathBuf>,
    prepared: Option<pi::Pi>,
    tasks: HashMap<String, pi::Pi>,
    stale_tasks: HashSet<String>,
    root: PathBuf,
    pi_extension: PathBuf,
    pi_auth_helper: PathBuf,
    pi_skills_helper: PathBuf,
    auth_login: Option<pi_auth::Login>,
    auth_sequence: u64,
    generation: u64,
    active_task: Option<String>,
    /// Worktree tree captured when each task's latest prompt was sent ("Last turn" review).
    turn_snapshots: HashMap<String, String>,
}

fn active_process(state: &State) -> Option<&pi::Pi> {
    match state.active_task.as_deref() {
        Some(id) => state.tasks.get(id),
        None => state.prepared.as_ref(),
    }
}

fn active_process_mut(state: &mut State) -> Option<&mut pi::Pi> {
    match state.active_task.as_deref() {
        Some(id) => state.tasks.get_mut(id),
        None => state.prepared.as_mut(),
    }
}

fn hide_active(state: &State) {
    if let Some(process) = active_process(state) {
        process.set_visible(false);
    }
}

fn skill_project(state: &State, request: &Value) -> Result<Option<PathBuf>, String> {
    if let Some(project_id) = request["projectId"].as_str().filter(|id| !id.is_empty()) {
        return Ok(Some(
            tasks::Catalog::read(&state.root)?.project_root(project_id)?,
        ));
    }
    Ok(state.workspace.clone())
}

fn reclaimable_task<'a>(
    active_task: Option<&str>,
    tasks: impl Iterator<Item = (&'a str, bool)>,
) -> Option<String> {
    let mut idle = None;
    for (id, working) in tasks {
        if working {
            continue;
        }
        if Some(id) == active_task {
            return Some(id.into());
        }
        if idle.is_none() {
            idle = Some(id.into());
        }
    }
    idle
}

fn reactivate(app: &tauri::AppHandle, state: &State) -> bool {
    if let Some(process) = active_process(state) {
        process.set_visible(true);
        let _ = app.emit(
            "pi:status",
            json!({"generation":process.generation(),"taskId":state.active_task,"active":true,"state":"connected","detail":"Pi RPC connected","working":process.is_working()}),
        );
        true
    } else {
        false
    }
}

fn catalog_with_unread(
    app: &tauri::AppHandle,
    root: &std::path::Path,
) -> Result<tasks::Catalog, String> {
    let mut catalog = tasks::Catalog::read(root)?;
    app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
    Ok(catalog)
}

fn mark_task_read(
    app: &tauri::AppHandle,
    root: &std::path::Path,
    id: &str,
) -> Result<Value, String> {
    app.state::<Arc<tasks::UnreadState>>().set(id, false)?;
    Ok(json!({"catalog":catalog_with_unread(app, root)?}))
}

fn tool_preset_rpc(args: &Value) -> Result<Value, String> {
    let preset = field(args, "preset")?;
    if !["full", "read-only", "chat"].contains(&preset) {
        return Err("Unknown tool preset".into());
    }
    Ok(json!({"type":"prompt", "message":format!("/pion-core-tools {preset}")}))
}

fn queue_mode_rpc(command: &str, args: &Value) -> Result<Value, String> {
    let mode = field(args, "mode")?;
    if !["all", "one-at-a-time"].contains(&mode) {
        return Err("Unknown queue mode".into());
    }
    Ok(json!({"type":command, "mode":mode}))
}

fn toggle_rpc(command: &str, args: &Value) -> Result<Value, String> {
    let enabled = args["enabled"].as_bool().ok_or("Missing enabled")?;
    Ok(json!({"type":command,"enabled":enabled}))
}

fn compact_rpc(args: &Value) -> Result<Value, String> {
    let Some(value) = args.get("customInstructions") else {
        return Ok(json!({"type":"compact"}));
    };
    let instructions = value.as_str().ok_or("Invalid custom instructions")?.trim();
    if instructions.len() > 4_096 {
        return Err("Custom instructions are too long".into());
    }
    if instructions.is_empty() {
        Ok(json!({"type":"compact"}))
    } else {
        Ok(json!({"type":"compact","customInstructions":instructions}))
    }
}

fn history_summary(entries: &Value) -> Result<Value, String> {
    let values = entries["entries"].as_array().ok_or("Invalid Pi entries")?;
    let mut labels = HashMap::new();
    for entry in values.iter().take(5_000) {
        if entry["type"] == "label" {
            if let (Some(target), Some(label)) =
                (entry["targetId"].as_str(), entry["label"].as_str())
            {
                labels.insert(target, label);
            }
        }
    }
    let items: Vec<Value> = values
        .iter()
        .take(5_000)
        .filter_map(|entry| {
            let id = entry["id"].as_str()?;
            let kind = entry["type"].as_str()?;
            let message = &entry["message"];
            let content = message["content"]
                .as_str()
                .map(str::to_string)
                .or_else(|| {
                    message["content"].as_array().map(|parts| {
                        parts
                            .iter()
                            .filter_map(|part| part["text"].as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                })
                .unwrap_or_default();
            let label: String = labels
                .get(id)
                .copied()
                .filter(|value| !value.is_empty())
                .unwrap_or(if content.is_empty() { kind } else { &content })
                .chars()
                .take(100)
                .collect();
            Some(json!({"id":id,"parentId":entry["parentId"],"type":kind,"label":label}))
        })
        .collect();
    Ok(json!({"items":items,"leafId":entries["leafId"]}))
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("Missing string {key}"))
}

/// Built-in Pion features that ship inside the app and can be switched off in
/// Settings → Plugins. Enabled unless `builtins.json` says otherwise.
const BUILTINS: &[&str] = &["git-review"];

fn builtin_states(root: &std::path::Path) -> Value {
    let saved = workspace::bounded_read(&root.join("builtins.json"), 64 * 1024)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_default();
    let states: serde_json::Map<String, Value> = BUILTINS
        .iter()
        .map(|id| (id.to_string(), json!(saved[*id].as_bool().unwrap_or(true))))
        .collect();
    Value::Object(states)
}

fn builtin_enabled(root: &std::path::Path, id: &str) -> bool {
    builtin_states(root)[id].as_bool().unwrap_or(false)
}

fn configured_executable(root: &std::path::Path) -> String {
    workspace::bounded_read(&root.join("settings.json"), 64 * 1024)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|settings| settings["executable"].as_str().map(str::to_string))
        .unwrap_or_else(|| "pi".into())
}

fn rollback_pi_change(
    app: &tauri::AppHandle,
    generation: u64,
    task_id: &str,
    process: &mut pi::Pi,
    rollback: Value,
    error: String,
) -> String {
    let restored = process
        .request(rollback)
        .is_ok_and(|result| result["cancelled"].as_bool() != Some(true));
    if restored {
        return error;
    }
    process.stop();
    let _ = app.emit(
        "pi:status",
        json!({"generation":generation,"taskId":task_id,"state":"disconnected","detail":"Pi rollback failed; reopen the task"}),
    );
    format!("{error}; Pi rollback failed, so the task was disconnected")
}

fn handle(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    if field(&request, "op")? == "extension_ui.response" {
        app.state::<Mutex<pi::ExtensionUiBridge>>()
            .lock()
            .map_err(|e| e.to_string())?
            .respond(
                request["generation"].as_u64().ok_or("Missing generation")?,
                field(&request, "id")?,
                &request["response"],
            )?;
        return Ok(Value::Null);
    }
    let managed = app.state::<Mutex<State>>();
    let mut state = managed.lock().map_err(|e| e.to_string())?;
    match field(&request, "op")? {
        "boot" => {
            let path = state.root.join("settings.json");
            let settings: Value = if path.exists() {
                serde_json::from_str(&workspace::bounded_read(&path, 64 * 1024)?)
                    .map_err(|e| e.to_string())?
            } else {
                json!({"executable":"pi", "workspace":""})
            };
            let mut catalog = catalog_with_unread(app, &state.root)?;
            if catalog.projects.is_empty() {
                if let Some(path) = settings["workspace"].as_str().filter(|p| !p.is_empty()) {
                    if catalog.add_project(std::path::Path::new(path)).is_ok() {
                        catalog.save(&state.root)?;
                    }
                }
            }
            Ok(json!({
                "plugins": state.plugins.list(),
                "settings": settings,
                "catalog": catalog,
                "builtins": builtin_states(&state.root),
            }))
        }
        "builtin.set" => {
            let id = field(&request, "id")?;
            if !BUILTINS.contains(&id) {
                return Err("Unknown built-in".into());
            }
            let mut states = builtin_states(&state.root);
            states[id] = json!(request["enabled"].as_bool().ok_or("Missing enabled")?);
            atomic_write(
                &state.root.join("builtins.json"),
                &serde_json::to_vec(&states).map_err(|e| e.to_string())?,
            )?;
            if id == "git-review" && states[id] == json!(false) {
                state.turn_snapshots.clear();
            }
            Ok(states)
        }
        "review" => Ok(json!(state.plugins.review(field(&request, "path")?)?)),
        "approve" => state.plugins.approve(field(&request, "digest")?),
        "enable" => state.plugins.enable(
            field(&request, "id")?,
            request["enabled"].as_bool().ok_or("Missing enabled")?,
        ),
        "remove" => state.plugins.remove(field(&request, "id")?),
        "project.add" => {
            let Some(path) = app.dialog().file().blocking_pick_folder() else {
                return Ok(Value::Null);
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            let mut catalog = tasks::Catalog::read(&state.root)?;
            let project = catalog.add_project(&path)?;
            catalog.save(&state.root)?;
            app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
            Ok(json!({"catalog":catalog, "project":project}))
        }
        "image.pick" => {
            let Some(files) = app
                .dialog()
                .file()
                .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
                .blocking_pick_files()
            else {
                return Ok(json!({"images":[]}));
            };
            let paths: Result<Vec<PathBuf>, String> = files
                .into_iter()
                .map(|file| file.into_path().map_err(|e| e.to_string()))
                .collect();
            let paths = paths?;
            images::read(&paths.iter().map(PathBuf::as_path).collect::<Vec<_>>())
        }
        "image.import" => images::import(&request["images"]),
        "sessions.legacy.list" => {
            let root = app
                .path()
                .home_dir()
                .map_err(|e| e.to_string())?
                .join(".pi/agent/sessions");
            Ok(json!({"sessions":sessions::list(&root)?}))
        }
        "sessions.legacy.import" => {
            let ids = request["ids"]
                .as_array()
                .ok_or("Missing session ids")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .ok_or("Invalid session id")
                })
                .collect::<Result<Vec<_>, _>>()?;
            let legacy_root = app
                .path()
                .home_dir()
                .map_err(|e| e.to_string())?
                .join(".pi/agent/sessions");
            let mut catalog = tasks::Catalog::read(&state.root)?;
            let imported = sessions::import(&mut catalog, &state.root, &legacy_root, &ids)?;
            app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
            Ok(json!({"catalog":catalog,"tasks":imported}))
        }
        "package.list" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            packages::list(&home, project.as_deref())
        }
        "package.install" | "package.update" | "package.remove" => {
            let action = field(&request, "op")?.trim_start_matches("package.");
            let executable = configured_executable(&state.root);
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            packages::run(
                &executable,
                &home,
                project.as_deref(),
                field(&request, "scope")?,
                action,
                field(&request, "source")?,
            )
        }
        "skill.list" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            let executable = configured_executable(&state.root);
            skills::run(
                &executable,
                &state.pi_skills_helper,
                &home,
                project.as_deref(),
            )
        }
        "skill.add" | "skill.remove" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            skills::change(
                &home,
                project.as_deref(),
                field(&request, "scope")?,
                field(&request, "op")?.trim_start_matches("skill."),
                field(&request, "path")?,
            )?;
            let executable = configured_executable(&state.root);
            skills::run(
                &executable,
                &state.pi_skills_helper,
                &home,
                project.as_deref(),
            )
        }
        "skill.toggle" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            let executable = configured_executable(&state.root);
            let listing = skills::run(
                &executable,
                &state.pi_skills_helper,
                &home,
                project.as_deref(),
            )?;
            skills::toggle(
                &home,
                project.as_deref(),
                &listing,
                field(&request, "path")?,
                request["enabled"].as_bool().ok_or("Missing enabled")?,
            )?;
            skills::run(
                &executable,
                &state.pi_skills_helper,
                &home,
                project.as_deref(),
            )
        }
        "skill.override" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?.ok_or("No selected project")?;
            let executable = configured_executable(&state.root);
            let listing = skills::run(&executable, &state.pi_skills_helper, &home, Some(&project))?;
            skills::set_project_override(
                &home,
                &project,
                &listing,
                field(&request, "path")?,
                field(&request, "state")?,
            )?;
            skills::run(&executable, &state.pi_skills_helper, &home, Some(&project))
        }
        "skill.commands" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let project = skill_project(&state, &request)?;
            skills::set_skill_commands(
                &home,
                project.as_deref(),
                field(&request, "scope")?,
                field(&request, "state")?,
            )?;
            let executable = configured_executable(&state.root);
            skills::run(
                &executable,
                &state.pi_skills_helper,
                &home,
                project.as_deref(),
            )
        }
        "model_config.list" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            models::list(&models::path(&home))
        }
        "model_config.scan" => {
            drop(state);
            Ok(scan::scan(800))
        }
        "model_config.discover" => {
            let provider = field(&request, "provider")?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let config = models::list(&models::path(&home))?;
            let entry = config["providers"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["name"] == provider))
                .ok_or("Unknown custom Pi provider")?;
            let api = entry["api"].as_str().ok_or("Missing Pi API type")?;
            pi_auth::discover_models(
                &configured_executable(&state.root),
                &state.pi_auth_helper,
                provider,
                api,
            )
        }
        "model_config.probe" => pi_auth::probe_endpoint(
            &configured_executable(&state.root),
            &state.pi_auth_helper,
            &request,
        ),
        "model_config.change" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let result =
                models::change(&models::path(&home), field(&request, "action")?, &request)?;
            state.prepared = None;
            let tasks: Vec<String> = state.tasks.keys().cloned().collect();
            state.stale_tasks.extend(tasks);
            Ok(result)
        }
        "model_auth.list" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            models::auth_list(&models::auth_path(&home))
        }
        "model_auth.providers" => {
            pi_auth::providers(&configured_executable(&state.root), &state.pi_auth_helper)
        }
        "model_auth.open_url" => {
            pi_auth::open_url(field(&request, "url")?)?;
            Ok(Value::Null)
        }
        "model_auth.login" => {
            if state
                .auth_login
                .as_ref()
                .is_some_and(|login| !login.finished())
            {
                return Err("Pi login is already running".into());
            }
            let provider = field(&request, "provider")?;
            if provider.is_empty() || provider.len() > 100 || provider.chars().any(char::is_control)
            {
                return Err("Invalid Pi provider".into());
            }
            let executable = configured_executable(&state.root);
            state.auth_login = None;
            state.auth_sequence += 1;
            let id = state.auth_sequence;
            state.auth_login = Some(pi_auth::Login::start(
                app.clone(),
                &executable,
                &state.pi_auth_helper,
                provider,
                id,
            )?);
            Ok(json!({"loginId":id}))
        }
        "model_auth.respond" => {
            let id = request["loginId"].as_u64().ok_or("Missing login id")?;
            let prompt_id = field(&request, "promptId")?;
            let value = field(&request, "value")?;
            if value.len() > 8192 {
                return Err("Pi login response is too long".into());
            }
            let login = state
                .auth_login
                .as_mut()
                .filter(|login| login.id == id)
                .ok_or("Pi login is no longer active")?;
            login.respond(json!({"type":"response","id":prompt_id,"value":value}))?;
            Ok(Value::Null)
        }
        "model_auth.cancel" => {
            let id = request["loginId"].as_u64().ok_or("Missing login id")?;
            if state
                .auth_login
                .as_ref()
                .is_some_and(|login| login.id == id)
            {
                state.auth_login = None;
            }
            Ok(Value::Null)
        }
        "model_auth.sync" => {
            state.prepared = None;
            let tasks: Vec<String> = state.tasks.keys().cloned().collect();
            state.stale_tasks.extend(tasks);
            Ok(Value::Null)
        }
        "model_auth.change" => {
            state.auth_login = None;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let result = models::auth_change(
                &models::auth_path(&home),
                field(&request, "action")?,
                &request,
            )?;
            state.prepared = None;
            let tasks: Vec<String> = state.tasks.keys().cloned().collect();
            state.stale_tasks.extend(tasks);
            Ok(result)
        }
        "pi_setup.scan" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let executable = request["executable"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| configured_executable(&state.root));
            drop(state);
            Ok(pi_setup::scan(&executable, &home))
        }
        "pi_setup.status" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let executable = field(&request, "executable")?;
            let mut result = pi_setup::inspect(executable, &home);
            if result["installation"] != "ready" {
                return Ok(result);
            }
            let path = result["executable"]
                .as_str()
                .ok_or("Missing Pi executable")?
                .to_string();
            state.generation += 1;
            let probe = pi::Pi::start(
                app.clone(),
                &path,
                &state.root,
                &state.pi_extension,
                state.generation,
                None,
                None,
            );
            match probe {
                Ok(mut process) => {
                    process.set_visible(false);
                    let pi_state = process.request(json!({"type":"get_state"}));
                    let models = process.request(json!({"type":"get_available_models"}));
                    match (pi_state, models) {
                        (Ok(pi_state), Ok(models)) => {
                            let preferred = request["model"].as_object();
                            let selected = preferred
                                .filter(|model| model["provider"].is_string() && model["id"].is_string())
                                .map(|model| json!({"provider":model["provider"],"id":model["id"]}))
                                .or_else(|| pi_state["model"].as_object().map(|model| json!({"provider":model["provider"],"id":model["id"]})));
                            result["models"] = models["models"].clone();
                            result["modelReady"] = json!(selected.as_ref().is_some_and(|model| {
                                let Some(provider) = model["provider"].as_str() else {
                                    return false;
                                };
                                let Some(id) = model["id"].as_str() else {
                                    return false;
                                };
                                if !models["models"].as_array().is_some_and(|items| {
                                    items.iter().any(|item| {
                                        item["provider"] == provider && item["id"] == id
                                    })
                                }) {
                                    return false;
                                }
                                pi_setup::check_model(std::path::Path::new(&path), provider, id)
                                    .unwrap_or(false)
                            }));
                            result["selectedModel"] = json!(selected);
                        }
                        (Err(error), _) | (_, Err(error)) => {
                            result["detail"] = json!(error);
                            result["models"] = json!([]);
                            result["modelReady"] = json!(false);
                        }
                    }
                }
                Err(error) => {
                    result["detail"] = json!(error);
                    result["models"] = json!([]);
                    result["modelReady"] = json!(false);
                }
            }
            Ok(result)
        }
        "pi_setup.check_update" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let mut result = pi_setup::inspect(field(&request, "executable")?, &home);
            let latest = pi_setup::latest_version()?;
            result["canUpdate"] = json!(pi_setup::can_update(&result, &latest));
            result["latestVersion"] = json!(latest);
            Ok(result)
        }
        "pi_setup.install" | "pi_setup.update" => {
            let action = field(&request, "op")?;
            let executable = field(&request, "executable")?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            if action == "pi_setup.update" {
                if !pi_setup::update_available(executable, &home) {
                    return Err("No newer Pion-verified npm Pi version is available".into());
                }
                if state.tasks.values_mut().any(pi_process_busy)
                    || state.prepared.as_mut().is_some_and(pi_process_busy)
                {
                    return Err("Wait for running Pi tasks to finish before updating".into());
                }
                state.prepared = None;
                state.tasks.clear();
                state.active_task = None;
                let _ = app.emit("pi:status", json!({"generation":state.generation,"taskId":Value::Null,"active":true,"state":"disconnected","detail":"Pi update"}));
            }
            let path = if action == "pi_setup.install" {
                pi_setup::install(executable, &home)?
            } else {
                pi_setup::update(executable, &home)?
            };
            let settings_path = state.root.join("settings.json");
            let mut settings: Value = if settings_path.exists() {
                serde_json::from_str(&workspace::bounded_read(&settings_path, 64 * 1024)?)
                    .map_err(|e| e.to_string())?
            } else {
                json!({"workspace":""})
            };
            settings["executable"] = json!(path.to_string_lossy());
            atomic_write(
                &settings_path,
                &serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
            )?;
            Ok(pi_setup::inspect(path.to_string_lossy().as_ref(), &home))
        }
        "settings.save" => {
            let executable = field(&request, "executable")?.trim();
            if executable.is_empty() {
                return Err("Pi executable is required".into());
            }
            atomic_write(&state.root.join("settings.json"), &serde_json::to_vec(
                &json!({"workspace":state.workspace.as_ref().map(|p| p.to_string_lossy()).unwrap_or_default(),"executable":executable})
            ).map_err(|e| e.to_string())?)?;
            Ok(Value::Null)
        }
        "task.create" => {
            let mut catalog = tasks::Catalog::read(&state.root)?;
            let task = catalog.create(field(&request, "projectId")?, field(&request, "title")?)?;
            catalog.save(&state.root)?;
            app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
            Ok(json!({"catalog":catalog, "task":task}))
        }
        "task.prepare" => {
            let catalog = tasks::Catalog::read(&state.root)?;
            let root = catalog.project_root(field(&request, "projectId")?)?;
            if state.active_task.is_none()
                && state
                    .prepared
                    .as_ref()
                    .is_some_and(|process| process.is_alive())
                && state.workspace.as_ref() == Some(&root)
            {
                return Ok(Value::Null);
            }
            let executable = field(&request, "executable")?;
            if executable.trim().is_empty() {
                return Err("Pi executable is required".into());
            }
            hide_active(&state);
            state.prepared = None;
            state.active_task = None;
            state.generation += 1;
            let _ = app.emit("pi:status", json!({"generation":state.generation,"taskId":Value::Null,"active":true,"state":"disconnected", "detail":"Connecting"}));
            let result = pi::Pi::start(
                app.clone(),
                executable,
                &root,
                &state.pi_extension,
                state.generation,
                None,
                None,
            )
            .and_then(|mut process| {
                process.request(json!({"type":"get_state"}))?;
                Ok(process)
            });
            let process = match result {
                Ok(process) => process,
                Err(error) => {
                    let _ = app.emit("pi:status", json!({"generation":state.generation,"taskId":Value::Null,"active":true,"state":"disconnected", "detail":"Pi connection failed"}));
                    return Err(error);
                }
            };
            state.workspace = Some(root.clone());
            state.prepared = Some(process);
            let _ = app.emit("workspace:opened", workspace::describe(&root));
            let _ = app.emit("pi:status", json!({"generation":state.generation,"taskId":Value::Null,"active":true,"state":"connected", "detail":"Pi RPC connected"}));
            Ok(Value::Null)
        }
        "task.open" => {
            let id = field(&request, "id")?;
            if state.stale_tasks.contains(id)
                && state
                    .tasks
                    .get(id)
                    .is_some_and(|process| !process.is_working())
            {
                state.tasks.remove(id);
                state.stale_tasks.remove(id);
            }
            if state.active_task.as_deref() == Some(id)
                && state
                    .tasks
                    .get(id)
                    .is_some_and(|process| process.is_alive())
            {
                let mut result = mark_task_read(app, &state.root, id)?;
                result["reused"] = json!(true);
                return Ok(result);
            }
            let catalog = tasks::Catalog::read(&state.root)?;
            let (root, session_dir, session_file) = catalog.resolve(id, &state.root)?;
            if state
                .tasks
                .get(id)
                .is_some_and(|process| process.is_alive())
            {
                hide_active(&state);
                state.prepared = None;
                let process = state.tasks.get(id).ok_or("Task process disappeared")?;
                process.set_visible(true);
                let generation = process.generation();
                let working = process.is_working();
                state.workspace = Some(root.clone());
                state.active_task = Some(id.into());
                let _ = app.emit("workspace:opened", workspace::describe(&root));
                let _ = app.emit(
                    "pi:status",
                    json!({"generation":generation,"taskId":id,"active":true,"state":"connected", "detail":"Pi RPC connected","working":working}),
                );
                let mut result = mark_task_read(app, &state.root, id)?;
                result["reused"] = json!(true);
                return Ok(result);
            }
            state.tasks.remove(id);
            state.tasks.retain(|_, process| process.is_alive());
            if state.tasks.len() >= MAX_TASK_PROCESSES {
                let reclaimable = reclaimable_task(
                    state.active_task.as_deref(),
                    state
                        .tasks
                        .iter()
                        .map(|(id, process)| (id.as_str(), process.is_working())),
                );
                if let Some(id) = reclaimable {
                    state.tasks.remove(&id);
                    let _ = app.emit("task:status", json!({"taskId":id,"state":"disconnected"}));
                } else {
                    return Err("Maximum 4 running tasks; stop one before opening another".into());
                }
            }
            let pending_title = if session_file.is_none() {
                catalog.pending_session_title(id).map(str::to_string)
            } else {
                None
            };
            let executable = field(&request, "executable")?;
            if executable.trim().is_empty() {
                return Err("Pi executable is required".into());
            }
            hide_active(&state);
            state.generation += 1;
            let generation = state.generation;
            let _ = app.emit("pi:status", json!({"generation":generation,"taskId":id,"active":true,"state":"disconnected", "detail":"Connecting"}));
            let target = session_file
                .as_deref()
                .map(pi::SessionTarget::File)
                .unwrap_or(pi::SessionTarget::Directory(&session_dir));
            let result = pi::Pi::start(
                app.clone(),
                executable,
                &root,
                &state.pi_extension,
                generation,
                Some(id.to_string()),
                Some(target),
            )
            .and_then(|mut process| {
                let pi_state = process.request(json!({"type":"get_state"}))?;
                if let Some(title) = pending_title {
                    process.request(json!({"type":"set_session_name", "name":title}))?;
                }
                if request["model"].is_object() {
                    process.request(json!({
                        "type":"set_model",
                        "provider":field(&request["model"], "provider")?,
                        "modelId":field(&request["model"], "modelId")?
                    }))?;
                }
                if let Some(level) = request["thinkingLevel"].as_str() {
                    process.request(json!({"type":"set_thinking_level", "level":level}))?;
                }
                Ok((process, pi_state))
            });
            let (process, pi_state) = match result {
                Ok(result) => result,
                Err(error) => {
                    if !reactivate(app, &state) {
                        let _ = app.emit("pi:status", json!({"generation":generation,"taskId":id,"active":true,"state":"disconnected", "detail":"Pi connection failed"}));
                    }
                    return Err(error);
                }
            };
            let attached = if let Some(file) = pi_state["sessionFile"].as_str() {
                tasks::Catalog::read(&state.root).and_then(|mut catalog| {
                    catalog
                        .attach_session(id, std::path::Path::new(file), &state.root)
                        .and_then(|()| catalog.save(&state.root))
                })
            } else {
                Ok(())
            };
            if let Err(error) = attached {
                drop(process);
                if !reactivate(app, &state) {
                    let _ = app.emit("pi:status", json!({"generation":generation,"taskId":id,"active":true,"state":"disconnected", "detail":"Pi connection failed"}));
                }
                return Err(error);
            }
            state.prepared = None;
            state.workspace = Some(root.clone());
            state.tasks.insert(id.into(), process);
            state.stale_tasks.remove(id);
            state.active_task = Some(id.into());
            let _ = app.emit("workspace:opened", workspace::describe(&root));
            let _ = app.emit("pi:status", json!({"generation":generation,"taskId":id,"active":true,"state":"connected", "detail":"Pi RPC connected","working":false}));
            let mut result = mark_task_read(app, &state.root, id)?;
            result["reused"] = json!(false);
            Ok(result)
        }
        "disconnect" => {
            let generation = active_process(&state)
                .map(pi::Pi::generation)
                .unwrap_or(state.generation);
            let task_id = state.active_task.take();
            if let Some(id) = task_id.as_deref() {
                state.tasks.remove(id);
            } else {
                state.prepared = None;
            }
            if let Some(id) = &task_id {
                let _ = app.emit("task:status", json!({"taskId":id,"state":"disconnected"}));
            }
            let _ = app.emit("pi:status", json!({"generation":generation,"taskId":task_id,"active":true,"state":"disconnected", "detail":"Stopped by user"}));
            Ok(Value::Null)
        }
        "session.branch" => {
            ensure_idle(&mut state)?;
            let source_task = state.active_task.clone().ok_or("No task is open")?;
            let kind = field(&request, "kind")?;
            if !["fork", "clone"].contains(&kind) {
                return Err("Unknown branch operation".into());
            }
            let app_root = state.root.clone();
            let title = field(&request, "title")?;
            let mut catalog = tasks::Catalog::read(&app_root)?;
            let generation = active_process(&state)
                .map(pi::Pi::generation)
                .ok_or("No task is open")?;
            let process = active_process_mut(&mut state).ok_or("No task is open")?;
            let before = process.request(json!({"type":"get_state"}))?;
            let old_file = field(&before, "sessionFile")?.to_string();
            let result = if kind == "fork" {
                process.request(json!({"type":"fork", "entryId":field(&request,"entryId")?}))?
            } else {
                process.request(json!({"type":"clone"}))?
            };
            if result["cancelled"].as_bool() == Some(true) {
                return Ok(json!({"cancelled":true}));
            }
            if let Err(error) = process.request(json!({"type":"set_session_name", "name":title})) {
                return Err(rollback_pi_change(
                    app,
                    generation,
                    &source_task,
                    process,
                    json!({"type":"switch_session", "sessionPath":old_file}),
                    error,
                ));
            }
            let after = match process.request(json!({"type":"get_state"})) {
                Ok(after) => after,
                Err(error) => {
                    return Err(rollback_pi_change(
                        app,
                        generation,
                        &source_task,
                        process,
                        json!({"type":"switch_session", "sessionPath":old_file}),
                        error,
                    ));
                }
            };
            let new_file = match field(&after, "sessionFile") {
                Ok(file) => file,
                Err(error) => {
                    return Err(rollback_pi_change(
                        app,
                        generation,
                        &source_task,
                        process,
                        json!({"type":"switch_session", "sessionPath":old_file}),
                        error,
                    ));
                }
            };
            let task = match catalog.create_from_session(
                &source_task,
                title,
                std::path::Path::new(new_file),
                &app_root,
            ) {
                Ok(task) => task,
                Err(error) => {
                    return Err(rollback_pi_change(
                        app,
                        generation,
                        &source_task,
                        process,
                        json!({"type":"switch_session", "sessionPath":old_file}),
                        error,
                    ));
                }
            };
            if let Err(error) = catalog.save(&app_root) {
                return Err(rollback_pi_change(
                    app,
                    generation,
                    &source_task,
                    process,
                    json!({"type":"switch_session", "sessionPath":old_file}),
                    error,
                ));
            }
            let process = state
                .tasks
                .remove(&source_task)
                .ok_or("Task process disappeared")?;
            process.set_task_id(Some(task.id.clone()));
            state.tasks.insert(task.id.clone(), process);
            state.active_task = Some(task.id.clone());
            let _ = app.emit(
                "pi:status",
                json!({"generation":generation,"taskId":task.id,"active":true,"state":"connected","detail":"Pi RPC connected","working":false}),
            );
            app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
            Ok(json!({"cancelled":false,"catalog":catalog,"task":task,"text":result["text"]}))
        }
        "task.rename" => {
            ensure_idle(&mut state)?;
            let id = field(&request, "id")?;
            if state.active_task.as_deref() != Some(id) {
                return Err("Only the open task can be renamed".into());
            }
            let name = field(&request, "name")?;
            let app_root = state.root.clone();
            let mut catalog = tasks::Catalog::read(&app_root)?;
            let task = catalog.rename(id, name)?;
            let generation = active_process(&state)
                .map(pi::Pi::generation)
                .ok_or("No task is open")?;
            let process = active_process_mut(&mut state).ok_or("No task is open")?;
            let previous = process.request(json!({"type":"get_state"}))?["sessionName"]
                .as_str()
                .unwrap_or("")
                .to_string();
            process.request(json!({"type":"set_session_name", "name":name}))?;
            if let Err(error) = catalog.save(&app_root) {
                return Err(rollback_pi_change(
                    app,
                    generation,
                    id,
                    process,
                    json!({"type":"set_session_name", "name":previous}),
                    error,
                ));
            }
            app.state::<Arc<tasks::UnreadState>>().apply(&mut catalog)?;
            Ok(json!({"catalog":catalog,"task":task}))
        }
        "session.export" => {
            ensure_idle(&mut state)?;
            let Some(path) = app
                .dialog()
                .file()
                .add_filter("HTML", &["html"])
                .set_file_name("pion-session.html")
                .blocking_save_file()
            else {
                return Ok(Value::Null);
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            let process = active_process_mut(&mut state).ok_or("No task is open")?;
            process.request(json!({"type":"export_html", "outputPath":path}))
        }
        "session.history" => {
            let process = active_process_mut(&mut state).ok_or("No task is open")?;
            let entries = process.request(json!({"type":"get_entries"}))?;
            let summary = history_summary(&entries)?;
            let forks = process.request(json!({"type":"get_fork_messages"}))?;
            let fork_items: Vec<Value> = forks["messages"]
                .as_array()
                .ok_or("Invalid Pi fork messages")?
                .iter()
                .take(5_000)
                .filter_map(|message| {
                    let id = message["entryId"].as_str()?;
                    let text: String = message["text"].as_str()?.chars().take(1_000).collect();
                    Some(json!({"entryId":id,"text":text}))
                })
                .collect();
            Ok(json!({"items":summary["items"],"leafId":summary["leafId"],"forks":fork_items}))
        }
        "pi" => {
            let command = field(&request, "command")?;
            let args = &request["args"];
            let rpc = match command {
                "prompt" | "steer" | "follow_up" => {
                    let mut value = json!({"type":command, "message":field(args,"message")?});
                    if args["images"].is_array() {
                        value["images"] = images::pi_content(&args["images"])?;
                    }
                    value
                }
                "abort" => json!({"type":"abort"}),
                "abort_retry" => json!({"type":"abort_retry"}),
                "clear_queue" => json!({"type":"clear_queue"}),
                "get_state" => json!({"type":"get_state"}),
                "get_messages" => json!({"type":"get_messages"}),
                "get_models" => json!({"type":"get_available_models"}),
                "get_thinking_levels" => json!({"type":"get_available_thinking_levels"}),
                "get_session_stats" => json!({"type":"get_session_stats"}),
                "get_commands" => json!({"type":"get_commands"}),
                "get_tree" => json!({"type":"get_tree"}),
                "get_entries" => {
                    let mut value = json!({"type":"get_entries"});
                    if let Some(since) = args["since"].as_str() {
                        value["since"] = json!(since);
                    }
                    value
                }
                "get_fork_messages" => json!({"type":"get_fork_messages"}),
                "get_last_assistant_text" => json!({"type":"get_last_assistant_text"}),
                "set_model" => json!({
                    "type":"set_model",
                    "provider":field(args,"provider")?,
                    "modelId":field(args,"modelId")?
                }),
                "set_thinking_level" => {
                    json!({"type":"set_thinking_level", "level":field(args,"level")?})
                }
                "set_tool_preset" => tool_preset_rpc(args)?,
                "compact" => compact_rpc(args)?,
                "set_auto_compaction" | "set_auto_retry" => toggle_rpc(command, args)?,
                "set_steering_mode" | "set_follow_up_mode" => queue_mode_rpc(command, args)?,
                _ => return Err("Unknown core Pi command".into()),
            };
            let generation = active_process(&state)
                .map(pi::Pi::generation)
                .ok_or("No task is open")?;
            let task_id = state.active_task.clone();
            if command == "prompt" && builtin_enabled(&state.root, "git-review") {
                // Remember the worktree before Pi starts so the review pane can show this turn.
                if let (Some(id), Some(root)) = (task_id.clone(), state.workspace.clone()) {
                    match git::snapshot(&root) {
                        Ok(tree) => {
                            state.turn_snapshots.insert(id, tree);
                        }
                        Err(_) => {
                            state.turn_snapshots.remove(&id);
                        }
                    }
                }
            }
            let process = active_process_mut(&mut state).ok_or("No task is open")?;
            if command == "abort" {
                process.request(json!({"type":"clear_queue"}))?;
            }
            let result = process.request(rpc);
            if !active_process(&state).is_some_and(pi::Pi::is_alive) {
                let _ = app.emit("pi:status", json!({"generation":generation,"taskId":task_id,"state":"disconnected","detail":"Pi transport stopped; reopen the task"}));
            }
            result
        }
        "plugin" => {
            let id = field(&request, "id")?;
            let method = field(&request, "method")?;
            let args = &request["args"];
            match method {
                "storage.get" => state.plugins.storage(id, field(args, "key")?, None),
                "storage.set" => {
                    state
                        .plugins
                        .storage(id, field(args, "key")?, Some(args["value"].clone()))
                }
                "workspace.get" | "workspace.readFile" => {
                    state.plugins.require(id, "workspace.read")?;
                    let root = state.workspace.as_ref().ok_or("No workspace is open")?;
                    if method == "workspace.get" {
                        Ok(workspace::describe(root))
                    } else {
                        Ok(json!(workspace::bounded_read(
                            &workspace::within(root, field(args, "path")?)?,
                            1024 * 1024
                        )?))
                    }
                }
                "workspace.writeFile" => {
                    state.plugins.require(id, "workspace.write")?;
                    let root = state
                        .workspace
                        .as_ref()
                        .ok_or("No workspace is open")?
                        .clone();
                    let (allow, _) = state.plugins.allowlists(id);
                    workspace::write_file(
                        &root,
                        &allow,
                        field(args, "path")?,
                        field(args, "content")?,
                        1024 * 1024,
                    )?;
                    Ok(Value::Null)
                }
                "workspace.gitStatus" => {
                    state.plugins.require(id, "workspace.git")?;
                    let root = state.workspace.as_ref().ok_or("No workspace is open")?;
                    git::status(root)
                }
                "workspace.gitDiff" => {
                    state.plugins.require(id, "workspace.git")?;
                    let root = state.workspace.as_ref().ok_or("No workspace is open")?;
                    git::diff(
                        root,
                        field(args, "path")?,
                        args["staged"].as_bool().unwrap_or(false),
                    )
                }
                "network.fetch" => {
                    state.plugins.require(id, "network.fetch")?;
                    let (_, allow) = state.plugins.allowlists(id);
                    net::fetch(&allow, field(args, "url")?, &args["options"])
                }
                _ => {
                    let (permission, command) = match method {
                        "pi.prompt" => (
                            "pi.sendMessage",
                            json!({"type":"prompt", "message":field(args,"message")?}),
                        ),
                        "pi.abort" => ("pi.sendMessage", json!({"type":"abort"})),
                        "pi.getState" => ("pi.read", json!({"type":"get_state"})),
                        "pi.getMessages" => ("pi.read", json!({"type":"get_messages"})),
                        "pi.getModels" => ("pi.read", json!({"type":"get_available_models"})),
                        "pi.getCommands" => ("pi.read", json!({"type":"get_commands"})),
                        "pi.setModel" => (
                            "pi.sendMessage",
                            json!({"type":"set_model", "provider":field(args,"provider")?, "modelId":field(args,"modelId")?}),
                        ),
                        _ => return Err("Unknown/unsupported plugin method".into()),
                    };
                    state.plugins.require(id, permission)?;
                    let generation = active_process(&state)
                        .map(pi::Pi::generation)
                        .ok_or("Pi is disconnected; connect a workspace first")?;
                    let task_id = state.active_task.clone();
                    let process = active_process_mut(&mut state)
                        .ok_or("Pi is disconnected; connect a workspace first")?;
                    // Clear queued follow-ups before abort so "Stop" cannot resume queued work.
                    if method == "pi.abort" {
                        process.request(json!({"type":"clear_queue"}))?;
                    }
                    let result = process.request(command);
                    if !active_process(&state).is_some_and(pi::Pi::is_alive) {
                        let _ = app.emit("pi:status", json!({"generation":generation,"taskId":task_id,"state":"disconnected","detail":"Pi transport stopped; reconnect required"}));
                    }
                    result
                }
            }
        }
        op if op.starts_with("git.") => {
            if !builtin_enabled(&state.root, "git-review") {
                return Err("Git review is disabled in Settings → Plugins".into());
            }
            let root = state
                .workspace
                .clone()
                .ok_or("Open a task in a project to use Git")?;
            let turn = state
                .active_task
                .as_ref()
                .and_then(|id| state.turn_snapshots.get(id))
                .cloned();
            // Hooks and remotes can take a while; do not hold the shared state meanwhile.
            drop(state);
            git::call(&root, op, &request, turn.as_deref())
        }
        _ => Err("Unknown host operation".into()),
    }
}

fn ensure_idle(state: &mut State) -> Result<(), String> {
    if let Some(process) = active_process_mut(state).filter(|process| process.is_alive()) {
        let status = process.request(json!({"type":"get_state"}))?;
        if process.is_working()
            || status["isStreaming"].as_bool().unwrap_or(false)
            || status["isCompacting"].as_bool().unwrap_or(false)
            || status["pendingMessageCount"].as_u64().unwrap_or(0) > 0
        {
            return Err("Wait for the current task to finish before changing its session".into());
        }
    }
    Ok(())
}

fn pi_process_busy(process: &mut pi::Pi) -> bool {
    if !process.is_alive() {
        return false;
    }
    if process.is_working() {
        return true;
    }
    match process.request(json!({"type":"get_state"})) {
        Ok(status) => {
            status["isStreaming"].as_bool().unwrap_or(false)
                || status["isCompacting"].as_bool().unwrap_or(false)
                || status["pendingMessageCount"].as_u64().unwrap_or(0) > 0
        }
        Err(_) => true,
    }
}

#[tauri::command]
async fn desktop(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(move || handle(&app, request))
        .await
        .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let plugins = Plugins::open(root.clone()).map_err(std::io::Error::other)?;
            let unread = tasks::UnreadState::read(&root).map_err(std::io::Error::other)?;
            let pi_extension = root.join("pion-core-extension.js");
            atomic_write(&pi_extension, include_bytes!("pion-core-extension.js"))
                .map_err(std::io::Error::other)?;
            let pi_auth_helper = root.join("pi-auth-bridge.mjs");
            atomic_write(&pi_auth_helper, include_bytes!("pi-auth-bridge.mjs"))
                .map_err(std::io::Error::other)?;
            let pi_skills_helper = root.join("pi-skills-bridge.mjs");
            atomic_write(&pi_skills_helper, include_bytes!("pi-skills-bridge.mjs"))
                .map_err(std::io::Error::other)?;
            app.manage(Mutex::new(pi::ExtensionUiBridge::default()));
            app.manage(Arc::new(unread));
            app.manage(Mutex::new(State {
                plugins,
                workspace: None,
                prepared: None,
                tasks: HashMap::new(),
                stale_tasks: HashSet::new(),
                root,
                pi_extension,
                pi_auth_helper,
                pi_skills_helper,
                auth_login: None,
                auth_sequence: 0,
                generation: 0,
                active_task: None,
                turn_snapshots: HashMap::new(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![desktop])
        .build(tauri::generate_context!())
        .expect("Failed to build Pion")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Ok(mut state) = app.state::<Mutex<State>>().lock() {
                    state.prepared = None;
                    state.tasks.clear();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_history_summary_handles_deep_sessions() {
        let entries: Vec<Value> = (0..200).map(|index| json!({
            "id":format!("entry-{index}"),
            "parentId":if index == 0 { Value::Null } else { json!(format!("entry-{}", index - 1)) },
            "type":"message",
            "message":{"content":[{"type":"text","text":format!("Entry {index}")}]}
        })).collect();
        let summary = history_summary(&json!({"entries":entries,"leafId":"entry-199"})).unwrap();
        assert_eq!(summary["items"].as_array().unwrap().len(), 200);
        assert_eq!(summary["items"][199]["parentId"], "entry-198");
    }

    #[test]
    fn tool_presets_are_strictly_allowlisted() {
        assert_eq!(
            tool_preset_rpc(&json!({"preset":"read-only"})).unwrap(),
            json!({"type":"prompt", "message":"/pion-core-tools read-only"})
        );
        assert!(tool_preset_rpc(&json!({"preset":"custom"})).is_err());
        assert!(tool_preset_rpc(&json!({})).is_err());
        assert_eq!(
            queue_mode_rpc("set_steering_mode", &json!({"mode":"all"})).unwrap(),
            json!({"type":"set_steering_mode", "mode":"all"})
        );
        assert!(queue_mode_rpc("set_follow_up_mode", &json!({"mode":"invalid"})).is_err());
        assert_eq!(
            toggle_rpc("set_auto_compaction", &json!({"enabled":true})).unwrap(),
            json!({"type":"set_auto_compaction","enabled":true})
        );
        assert!(toggle_rpc("set_auto_retry", &json!({"enabled":"yes"})).is_err());
        assert_eq!(compact_rpc(&json!({})).unwrap(), json!({"type":"compact"}));
        assert_eq!(
            compact_rpc(&json!({"customInstructions":" Focus on code "})).unwrap(),
            json!({"type":"compact","customInstructions":"Focus on code"})
        );
        assert!(compact_rpc(&json!({"customInstructions":false})).is_err());
        assert!(compact_rpc(&json!({"customInstructions":"x".repeat(4_097)})).is_err());
    }

    #[test]
    fn connected_task_limit_reclaims_idle_tasks_but_not_running_tasks() {
        assert_eq!(
            reclaimable_task(
                Some("active"),
                [("other", false), ("active", false)].into_iter()
            ),
            Some("active".into())
        );
        assert_eq!(
            reclaimable_task(
                Some("active"),
                [("active", true), ("other", false)].into_iter()
            ),
            Some("other".into())
        );
        assert_eq!(
            reclaimable_task(
                Some("active"),
                [("active", true), ("other", true)].into_iter()
            ),
            None
        );
    }
}
