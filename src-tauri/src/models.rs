use crate::workspace::bounded_read;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const LIMIT: u64 = 1024 * 1024;
const APIS: &[&str] = &[
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
];

struct Document {
    config: Value,
    bom: bool,
    crlf: bool,
    final_newline: bool,
}

pub fn path(home: &Path) -> PathBuf {
    agent_dir(home).join("models.json")
}

pub fn auth_path(home: &Path) -> PathBuf {
    agent_dir(home).join("auth.json")
}

fn agent_dir(home: &Path) -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pi/agent"))
}

fn read_json(path: &Path, default: Value) -> Result<Document, String> {
    if path.is_symlink() {
        return Err("Pi configuration must be a regular file".into());
    }
    if !path.exists() {
        return Ok(Document {
            config: default,
            bom: false,
            crlf: false,
            final_newline: true,
        });
    }
    if !path.is_file() {
        return Err("Pi configuration must be a regular file".into());
    }
    let text = bounded_read(path, LIMIT)?;
    let bom = text.starts_with('\u{feff}');
    let content = text.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    Ok(Document {
        config: value,
        bom,
        crlf: content.contains("\r\n"),
        final_newline: content.ends_with('\n'),
    })
}

fn read(path: &Path) -> Result<Document, String> {
    let mut document = read_json(path, json!({"providers":{}}))?;
    let fields = document
        .config
        .as_object_mut()
        .ok_or("Invalid Pi models.json")?;
    if fields
        .get("providers")
        .is_some_and(|value| !value.is_object())
    {
        return Err("Invalid Pi models.json: expected providers object".into());
    }
    fields.entry("providers").or_insert_with(|| json!({}));
    Ok(document)
}

fn providers(config: &mut Value) -> Result<&mut Map<String, Value>, String> {
    config["providers"]
        .as_object_mut()
        .ok_or_else(|| "Invalid Pi models.json: expected providers object".into())
}

pub fn list(path: &Path) -> Result<Value, String> {
    let config = read(path)?.config;
    let items: Vec<Value> = config["providers"]
        .as_object()
        .ok_or("Invalid Pi providers")?
        .iter()
        .map(|(name, provider)| {
            let models: Vec<Value> = provider["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|model| {
                    let id = model["id"].as_str()?;
                    Some(json!({
                        "id":id,
                        "name":model["name"],
                        "reasoning":model["reasoning"],
                        "input":model["input"],
                        "contextWindow":model["contextWindow"],
                        "maxTokens":model["maxTokens"]
                    }))
                })
                .collect();
            json!({
                "name":name,
                "baseUrl":provider["baseUrl"],
                "api":provider["api"],
                "models":models,
                "hasAdvancedSettings":provider.as_object().is_some_and(|fields| fields.keys().any(|key| !["baseUrl", "api", "models"].contains(&key.as_str())))
            })
        })
        .collect();
    Ok(json!({"path":path.to_string_lossy(),"providers":items}))
}

fn required<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    let text = value[key]
        .as_str()
        .ok_or_else(|| format!("Missing {key}"))?
        .trim();
    if text.is_empty() || text.len() > max || text.chars().any(char::is_control) {
        return Err(format!("Invalid {key}"));
    }
    Ok(text)
}

fn optional(value: &Value, key: &str, max: usize) -> Result<Option<String>, String> {
    let text = value[key]
        .as_str()
        .ok_or_else(|| format!("Missing {key}"))?
        .trim();
    if text.len() > max || text.chars().any(char::is_control) {
        return Err(format!("Invalid {key}"));
    }
    Ok((!text.is_empty()).then(|| text.to_string()))
}

fn save(path: &Path, document: &Document, private: bool) -> Result<(), String> {
    let mut data = serde_json::to_string_pretty(&document.config).map_err(|e| e.to_string())?;
    if document.crlf {
        data = data.replace('\n', "\r\n");
    }
    if document.final_newline {
        data.push_str(if document.crlf { "\r\n" } else { "\n" });
    }
    if document.bom {
        data.insert(0, '\u{feff}');
    }
    let data = data.into_bytes();
    if data.len() as u64 > LIMIT {
        return Err("Pi models.json exceeds 1 MB".into());
    }
    let parent = path.parent().ok_or("Invalid Pi models path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension("pion.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        if path.exists() && !private {
            file.set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
                .map_err(|e| e.to_string())?;
        }
        use std::io::Write;
        file.write_all(&data).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub fn change(path: &Path, action: &str, args: &Value) -> Result<Value, String> {
    let mut document = read(path)?;
    let name = required(args, "provider", 100)?;
    let entries = providers(&mut document.config)?;
    let mut imported = 0;
    match action {
        "provider.save" => {
            if name.contains('/') || name.chars().any(char::is_whitespace) {
                return Err("Invalid provider name".into());
            }
            let base_url = required(args, "baseUrl", 2048)?;
            if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
                return Err("Provider URL must start with http:// or https://".into());
            }
            let api = required(args, "api", 100)?;
            if !APIS.contains(&api) {
                return Err("Unsupported Pi API".into());
            }
            let provider = entries.entry(name).or_insert_with(|| json!({"models":[]}));
            let fields = provider.as_object_mut().ok_or("Invalid Pi provider")?;
            fields.insert("baseUrl".into(), json!(base_url));
            fields.insert("api".into(), json!(api));
            if !fields.contains_key("apiKey")
                && ["http://localhost:", "http://127.0.0.1:", "http://[::1]:"]
                    .iter()
                    .any(|prefix| base_url.starts_with(prefix))
            {
                fields.insert("apiKey".into(), json!("local"));
            }
            if !fields.contains_key("models") {
                fields.insert("models".into(), json!([]));
            }
        }
        "provider.remove" => {
            if entries.remove(name).is_none() {
                return Err("Unknown Pi provider".into());
            }
        }
        "model.save" => {
            let id = required(args, "id", 200)?;
            let label = optional(args, "name", 200)?;
            let context = args["contextWindow"].as_u64().filter(|value| *value > 0);
            let maximum = args["maxTokens"].as_u64().filter(|value| *value > 0);
            if args["contextWindow"] != Value::Null && context.is_none()
                || args["maxTokens"] != Value::Null && maximum.is_none()
            {
                return Err("Token limits must be positive integers".into());
            }
            let provider = entries.get_mut(name).ok_or("Unknown Pi provider")?;
            let models = provider["models"]
                .as_array_mut()
                .ok_or("Invalid Pi model list")?;
            let model = if let Some(existing) = models.iter_mut().find(|item| item["id"] == id) {
                existing
            } else {
                models.push(json!({"id":id}));
                models.last_mut().ok_or("Cannot create Pi model")?
            };
            let fields = model.as_object_mut().ok_or("Invalid Pi model")?;
            fields.insert("id".into(), json!(id));
            if let Some(label) = label {
                fields.insert("name".into(), json!(label));
            } else {
                fields.remove("name");
            }
            fields.insert(
                "reasoning".into(),
                json!(args["reasoning"].as_bool().ok_or("Invalid reasoning")?),
            );
            fields.insert(
                "input".into(),
                if args["image"].as_bool().ok_or("Invalid image support")? {
                    json!(["text", "image"])
                } else {
                    json!(["text"])
                },
            );
            if let Some(context) = context {
                fields.insert("contextWindow".into(), json!(context));
            } else {
                fields.remove("contextWindow");
            }
            if let Some(maximum) = maximum {
                fields.insert("maxTokens".into(), json!(maximum));
            } else {
                fields.remove("maxTokens");
            }
        }
        "model.import" => {
            let incoming = args["models"].as_array().ok_or("Missing Pi models")?;
            if incoming.is_empty() || incoming.len() > 1000 {
                return Err("Select 1 to 1000 models".into());
            }
            let provider = entries.get_mut(name).ok_or("Unknown Pi provider")?;
            let models = provider["models"]
                .as_array_mut()
                .ok_or("Invalid Pi model list")?;
            for item in incoming {
                let id = required(item, "id", 200)?;
                if models.iter().any(|existing| existing["id"] == id) {
                    continue;
                }
                let mut model = json!({"id":id});
                if item.get("name").is_some() {
                    if let Some(label) = optional(item, "name", 200)? {
                        model["name"] = json!(label);
                    }
                }
                for field in ["contextWindow", "maxTokens"] {
                    if let Some(value) = item[field].as_u64().filter(|value| *value > 0) {
                        model[field] = json!(value);
                    }
                }
                models.push(model);
                imported += 1;
            }
        }
        "model.remove" => {
            let id = required(args, "id", 200)?;
            let provider = entries.get_mut(name).ok_or("Unknown Pi provider")?;
            let models = provider["models"]
                .as_array_mut()
                .ok_or("Invalid Pi model list")?;
            let before = models.len();
            models.retain(|item| item["id"] != id);
            if models.len() == before {
                return Err("Unknown Pi model".into());
            }
        }
        _ => return Err("Unknown Pi model action".into()),
    }
    save(path, &document, false)?;
    let mut result = list(path)?;
    if action == "model.import" {
        result["imported"] = json!(imported);
    }
    Ok(result)
}

pub fn auth_list(path: &Path) -> Result<Value, String> {
    let document = read_json(path, json!({}))?;
    let entries = document.config.as_object().ok_or("Invalid Pi auth.json")?;
    let providers: Vec<Value> = entries
        .iter()
        .filter_map(|(name, value)| {
            let kind = value["type"].as_str()?;
            Some(json!({"provider":name,"type":kind}))
        })
        .collect();
    Ok(json!({"path":path.to_string_lossy(),"providers":providers}))
}

pub fn auth_change(path: &Path, action: &str, args: &Value) -> Result<Value, String> {
    let mut document = read_json(path, json!({}))?;
    let entries = document
        .config
        .as_object_mut()
        .ok_or("Invalid Pi auth.json")?;
    let name = required(args, "provider", 100)?;
    if name.contains('/') || name.chars().any(char::is_whitespace) {
        return Err("Invalid provider name".into());
    }
    match action {
        "save_key" => {
            let key = required(args, "key", 8192)?;
            if key.starts_with('!') {
                return Err("Enter an API key, not a command".into());
            }
            if entries
                .get(name)
                .is_some_and(|value| value["type"] != "api_key")
            {
                return Err(
                    "This provider uses Pi login; log out in Pi before replacing it".into(),
                );
            }
            let credential = entries
                .entry(name)
                .or_insert_with(|| json!({"type":"api_key"}));
            credential["key"] = json!(key);
        }
        "remove_key" => {
            if entries
                .get(name)
                .is_none_or(|value| value["type"] != "api_key")
            {
                return Err("No saved API key for this provider".into());
            }
            entries.remove(name);
        }
        _ => return Err("Unknown Pi auth action".into()),
    }
    save(path, &document, true)?;
    auth_list(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_keep_advanced_fields_and_hide_credentials() {
        let root = std::env::temp_dir().join(format!("pion-models-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("models.json");
        fs::write(&path, r#"{"providers":{"local":{"apiKey":"secret","headers":{"X-Test":"keep"},"baseUrl":"http://localhost:11434/v1","api":"openai-completions","models":[{"id":"old","compat":{"keep":true}}]}}}"#).unwrap();
        let value = change(&path, "model.save", &json!({"provider":"local","id":"old","name":"New name","reasoning":true,"image":false,"contextWindow":128000,"maxTokens":32000})).unwrap();
        assert!(!value.to_string().contains("secret"));
        let written = read(&path).unwrap().config;
        assert_eq!(written["providers"]["local"]["apiKey"], "secret");
        assert_eq!(
            written["providers"]["local"]["models"][0]["compat"]["keep"],
            true
        );
        assert_eq!(
            written["providers"]["local"]["models"][0]["name"],
            "New name"
        );
        assert!(!fs::read_to_string(&path).unwrap().ends_with('\n'));
        change(&path, "provider.save", &json!({"provider":"ollama","baseUrl":"http://localhost:11434/v1","api":"openai-completions"})).unwrap();
        assert_eq!(
            read(&path).unwrap().config["providers"]["ollama"]["apiKey"],
            "local"
        );
        fs::write(&path, "{}\n").unwrap();
        change(&path, "provider.save", &json!({"provider":"empty","baseUrl":"https://example.com/v1","api":"openai-completions"})).unwrap();
        assert!(read(&path).unwrap().config["providers"]["empty"].is_object());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn api_keys_stay_private_and_oauth_entries_survive() {
        let root = std::env::temp_dir().join(format!("pion-auth-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("auth.json");
        fs::write(
            &path,
            "{\r\n  \"openai-codex\": {\"type\": \"oauth\", \"refresh\": \"keep\"}\r\n}",
        )
        .unwrap();
        let response = auth_change(
            &path,
            "save_key",
            &json!({"provider":"openai","key":"sk-secret"}),
        )
        .unwrap();
        assert!(!response.to_string().contains("sk-secret"));
        assert!(auth_change(
            &path,
            "save_key",
            &json!({"provider":"openai-codex","key":"bad"})
        )
        .is_err());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("\r\n"));
        assert!(!text.ends_with('\n'));
        let document = read_json(&path, json!({})).unwrap();
        assert_eq!(document.config["openai-codex"]["refresh"], "keep");
        assert_eq!(document.config["openai"]["key"], "sk-secret");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn importing_models_skips_existing_definitions() {
        let root = std::env::temp_dir().join(format!("pion-model-import-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("models.json");
        fs::write(&path, r#"{"providers":{"proxy":{"baseUrl":"http://localhost:9000/v1","api":"openai-completions","models":[{"id":"existing","compat":{"keep":true}}]}}}"#).unwrap();
        let result = change(&path, "model.import", &json!({"provider":"proxy","models":[{"id":"existing","name":"Do not replace"},{"id":"new","name":"New model","contextWindow":128000,"maxTokens":8192}]})).unwrap();
        assert_eq!(result["imported"], 1);
        let models = &read(&path).unwrap().config["providers"]["proxy"]["models"];
        assert_eq!(models[0]["compat"]["keep"], true);
        assert_eq!(models[0]["name"], Value::Null);
        assert_eq!(models[1]["id"], "new");
        assert_eq!(models[1]["contextWindow"], 128000);
        assert!(!fs::read_to_string(&path).unwrap().ends_with('\n'));
        fs::remove_dir_all(root).unwrap();
    }
}
