use crate::workspace::{bounded_read, relative, within};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const LIMIT: u64 = 1024 * 1024;
const PERMISSIONS: &[&str] = &[
    "workspace.read",
    "workspace.write",
    "workspace.git",
    "pi.read",
    "pi.sendMessage",
    "storage",
    "notifications",
    "network.fetch",
];
const LOCATIONS: &[&str] = &[
    "sidebar",
    "secondarySidebar",
    "mainPanel",
    "bottomPanel",
    "toolbar",
    "statusBar",
    "commandPalette",
    "contextMenu",
    "settings",
];

#[derive(Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub manifest: Value,
    pub source: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Installed {
    pub bundle: Bundle,
    pub digest: String,
    pub enabled: bool,
    /// Development link: the folder Pion re-reads when its files change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev: Option<String>,
}

pub struct Plugins {
    root: PathBuf,
    pub installed: BTreeMap<String, Installed>,
    pending: Option<Installed>,
}

fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing {key}"))
}

pub fn valid_id(id: &str) -> bool {
    id != "core"
        && !id.is_empty()
        && id.len() <= 64
        && id.as_bytes()[0].is_ascii_lowercase()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn version(value: &str) -> Result<Vec<u64>, String> {
    let parts: Result<Vec<_>, _> = value
        .split('.')
        .map(|v| {
            if v.is_empty()
                || (v.len() > 1 && v.starts_with('0'))
                || !v.bytes().all(|c| c.is_ascii_digit())
            {
                return Err("Expected numeric version".to_string());
            }
            v.parse::<u64>().map_err(|e| e.to_string())
        })
        .collect();
    let parts = parts?;
    if parts.len() != 3 {
        return Err("Expected major.minor.patch".into());
    }
    Ok(parts)
}

fn validate_translations(value: Option<&Value>) -> Result<(), String> {
    if let Some(value) = value {
        let translations = value.as_object().ok_or("Invalid translations")?;
        for (locale, label) in translations {
            let label = label.as_str().ok_or("Invalid translated label")?;
            if !["en", "zh-CN"].contains(&locale.as_str())
                || label.is_empty()
                || label.chars().count() > 100
            {
                return Err("Unsupported locale or invalid translated label".into());
            }
        }
    }
    Ok(())
}

fn valid_write_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && value.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'*'))
        })
}

fn valid_host(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 || value != value.to_ascii_lowercase() {
        return false;
    }
    let host = value.strip_prefix("*.").unwrap_or(value);
    !host.is_empty()
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .next()
                    .is_some_and(|b| b.is_ascii_alphanumeric())
                && label
                    .bytes()
                    .last()
                    .is_some_and(|b| b.is_ascii_alphanumeric())
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

fn validate_access(value: Option<&Value>, permissions: &[String]) -> Result<(), String> {
    let granted = |permission: &str| permissions.iter().any(|value| value == permission);
    let value = match value {
        Some(value) => value,
        None => {
            if granted("workspace.write") {
                return Err("workspace.write requires an access.workspaceWrite allowlist".into());
            }
            if granted("network.fetch") {
                return Err("network.fetch requires an access.network allowlist".into());
            }
            return Ok(());
        }
    };
    let access = value.as_object().ok_or("Invalid access")?;
    for key in access.keys() {
        if key != "workspaceWrite" && key != "network" {
            return Err("Unknown access key".into());
        }
    }
    match access.get("workspaceWrite") {
        Some(list) => {
            let list = list.as_array().ok_or("Invalid workspace write allowlist")?;
            if !granted("workspace.write") || list.is_empty() || list.len() > 32 {
                return Err("Invalid workspace write allowlist".into());
            }
            for entry in list {
                if !valid_write_path(entry.as_str().ok_or("Invalid workspace write allowlist")?) {
                    return Err("Invalid workspace write allowlist".into());
                }
            }
        }
        None if granted("workspace.write") => {
            return Err("workspace.write requires an access.workspaceWrite allowlist".into());
        }
        None => {}
    }
    match access.get("network") {
        Some(list) => {
            let list = list.as_array().ok_or("Invalid network allowlist")?;
            if !granted("network.fetch") || list.is_empty() || list.len() > 32 {
                return Err("Invalid network allowlist".into());
            }
            for entry in list {
                if !valid_host(entry.as_str().ok_or("Invalid network allowlist")?) {
                    return Err("Invalid network allowlist".into());
                }
            }
        }
        None if granted("network.fetch") => {
            return Err("network.fetch requires an access.network allowlist".into());
        }
        None => {}
    }
    Ok(())
}

pub fn validate(bundle: &Bundle) -> Result<String, String> {
    let m = &bundle.manifest;
    let id = string(m, "id")?;
    validate_translations(m.get("nameI18n"))?;
    if !valid_id(id) || string(m, "name")?.len() > 100 || string(m, "apiVersion")? != "1" {
        return Err("Invalid plugin identity/API version".into());
    }
    version(string(m, "version")?)?;
    if version(string(m, "minDesktopVersion")?)? > version(env!("CARGO_PKG_VERSION"))? {
        return Err("Plugin requires a newer Desktop".into());
    }
    let main = string(m, "main")?;
    relative(main)?;
    if main.len() > 240
        || !main.ends_with(".js")
        || !main
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_./-".contains(&b))
        || main
            .split('/')
            .any(|v| v.is_empty() || v == "." || v == "..")
    {
        return Err("Invalid JavaScript entrypoint".into());
    }
    let permissions = m["permissions"].as_array().ok_or("Missing permissions")?;
    let mut seen = HashSet::new();
    let mut granted = Vec::new();
    for permission in permissions {
        let permission = permission.as_str().ok_or("Invalid permission")?;
        if !PERMISSIONS.contains(&permission) || !seen.insert(permission) {
            return Err("Unknown/duplicate permission".into());
        }
        granted.push(permission.to_string());
    }
    validate_access(m.get("access"), &granted)?;
    seen.clear();
    for kind in ["commands", "panels"] {
        let contributions = m["contributes"][kind]
            .as_array()
            .ok_or("Missing contributions")?;
        if contributions.len() > 32 {
            return Err("Too many contributions".into());
        }
        for c in contributions {
            let name = string(c, "id")?;
            validate_translations(c.get("titleI18n"))?;
            if name.len() > 120
                || !name.starts_with(&format!("{id}."))
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-".contains(&b))
                || !seen.insert(name)
                || string(c, "title")?.len() > 100
            {
                return Err("Invalid/duplicate contribution".into());
            }
            if kind == "panels" && !LOCATIONS.contains(&string(c, "location")?) {
                return Err("Unknown panel location".into());
            }
        }
    }
    if bundle.source.len() as u64 > LIMIT || bundle.source.trim().is_empty() {
        return Err("Plugin source must be 1 byte to 1 MB".into());
    }
    Ok(id.into())
}

fn read_folder(root: &Path) -> Result<Bundle, String> {
    let manifest: Value =
        serde_json::from_str(&bounded_read(&within(root, "plugin.json")?, 64 * 1024)?)
            .map_err(|e| e.to_string())?;
    let source = bounded_read(&within(root, string(&manifest, "main")?)?, LIMIT)?;
    Ok(Bundle { manifest, source })
}

/// Reads and validates a linked development folder.
pub fn read_dev(root: &Path) -> Result<Bundle, String> {
    let bundle = read_folder(root)?;
    validate(&bundle)?;
    Ok(bundle)
}

fn digest(bundle: &Bundle) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(bundle).expect("Serializable bundle"))
    )
}

pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

impl Plugins {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("plugins")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("storage")).map_err(|e| e.to_string())?;
        let mut installed = BTreeMap::new();
        for entry in fs::read_dir(root.join("plugins")).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let record = bounded_read(&path, LIMIT * 4).and_then(|text| {
                serde_json::from_str::<Installed>(&text).map_err(|e| e.to_string())
            });
            match record {
                Ok(record)
                    if validate(&record.bundle).is_ok()
                        && record.digest == digest(&record.bundle) =>
                {
                    installed.insert(
                        record.bundle.manifest["id"].as_str().unwrap().into(),
                        record,
                    );
                }
                _ => eprintln!("Ignored invalid plugin record: {}", path.display()),
            }
        }
        Ok(Self {
            root,
            installed,
            pending: None,
        })
    }

    /// Reviews a folder or ZIP. With `dev`, the folder stays linked so later edits
    /// reload without a new review, as long as permissions and access stay the same.
    pub fn review(&mut self, path: &str, dev: bool) -> Result<Installed, String> {
        let root = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
        if dev && !root.is_dir() {
            return Err("Development mode needs a plugin folder, not a ZIP".into());
        }
        let bundle = if root.is_dir() {
            read_folder(&root)?
        } else {
            let file = fs::File::open(&root).map_err(|e| e.to_string())?;
            if file.metadata().map_err(|e| e.to_string())?.len() > 4 * LIMIT {
                return Err("ZIP exceeds 4 MB".into());
            }
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            if zip.len() > 128 {
                return Err("Too many ZIP entries".into());
            }
            // Read two exact entries; never extract archive paths or execute install scripts.
            let mut manifest_text = String::new();
            zip.by_name("plugin.json")
                .map_err(|e| e.to_string())?
                .take(64 * 1024 + 1)
                .read_to_string(&mut manifest_text)
                .map_err(|e| e.to_string())?;
            if manifest_text.len() > 64 * 1024 {
                return Err("Manifest too large".into());
            }
            let manifest: Value =
                serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;
            relative(string(&manifest, "main")?)?;
            let mut source = String::new();
            zip.by_name(string(&manifest, "main")?)
                .map_err(|e| e.to_string())?
                .take(LIMIT + 1)
                .read_to_string(&mut source)
                .map_err(|e| e.to_string())?;
            Bundle { manifest, source }
        };
        validate(&bundle)?;
        let record = Installed {
            digest: digest(&bundle),
            bundle,
            enabled: true,
            dev: dev.then(|| root.to_string_lossy().into_owned()),
        };
        self.pending = Some(record.clone());
        Ok(record)
    }

    pub fn approve(&mut self, expected: &str) -> Result<Value, String> {
        let record = self.pending.as_ref().ok_or("Review a plugin first")?;
        if record.digest != expected {
            return Err("Review changed; review again".into());
        }
        let id = validate(&record.bundle)?;
        atomic_write(
            &self.root.join("plugins").join(format!("{id}.json")),
            &serde_json::to_vec(record).map_err(|e| e.to_string())?,
        )?;
        self.installed.insert(id, record.clone());
        self.pending = None;
        Ok(Value::Null)
    }

    pub fn enable(&mut self, id: &str, enabled: bool) -> Result<Value, String> {
        let mut record = self.installed.get(id).ok_or("Unknown plugin")?.clone();
        record.enabled = enabled;
        atomic_write(
            &self.root.join("plugins").join(format!("{id}.json")),
            &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )?;
        self.installed.insert(id.into(), record);
        Ok(Value::Null)
    }

    pub fn remove(&mut self, id: &str) -> Result<Value, String> {
        if !self.installed.contains_key(id) {
            return Err("Unknown plugin".into());
        }
        fs::remove_file(self.root.join("plugins").join(format!("{id}.json")))
            .map_err(|e| e.to_string())?;
        self.installed.remove(id);
        Ok(Value::Null)
    }

    pub fn dev_path(&self, id: &str) -> Result<PathBuf, String> {
        let record = self.installed.get(id).ok_or("Unknown plugin")?;
        record
            .dev
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| "Not a development plugin".into())
    }

    /// Applies a fresh read of a linked folder. Returns the new record when the code
    /// changed, `None` when it did not. A change to the plugin id, permissions or
    /// access is refused: those need a new review.
    pub fn dev_update(
        &mut self,
        id: &str,
        path: &Path,
        bundle: Bundle,
    ) -> Result<Option<Installed>, String> {
        let record = self.installed.get(id).ok_or("Unknown plugin")?;
        if record.dev.as_deref().map(Path::new) != Some(path) {
            return Err("Development link changed".into());
        }
        if bundle.manifest["id"] != record.bundle.manifest["id"] {
            return Err("Plugin id changed; link the folder again".into());
        }
        for key in ["permissions", "access"] {
            if bundle.manifest.get(key) != record.bundle.manifest.get(key) {
                return Err("Permissions changed; link the folder again to review them".into());
            }
        }
        let digest = digest(&bundle);
        if digest == record.digest {
            return Ok(None);
        }
        let mut next = record.clone();
        next.bundle = bundle;
        next.digest = digest;
        atomic_write(
            &self.root.join("plugins").join(format!("{id}.json")),
            &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
        )?;
        self.installed.insert(id.into(), next.clone());
        Ok(Some(next))
    }

    pub fn require(&self, id: &str, permission: &str) -> Result<(), String> {
        let record = self.installed.get(id).ok_or("Plugin not installed")?;
        if !record.enabled
            || !record.bundle.manifest["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == permission)
        {
            return Err(format!("Permission denied: {permission}"));
        }
        Ok(())
    }

    /// Returns the plugin's declared write-path and network allowlists.
    pub fn allowlists(&self, id: &str) -> (Vec<String>, Vec<String>) {
        let access = self
            .installed
            .get(id)
            .and_then(|record| record.bundle.manifest.get("access"));
        let list = |key: &str| -> Vec<String> {
            access
                .and_then(|access| access.get(key))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        (list("workspaceWrite"), list("network"))
    }

    pub fn storage(&self, id: &str, key: &str, value: Option<Value>) -> Result<Value, String> {
        self.require(id, "storage")?;
        if key.is_empty()
            || key.len() > 100
            || !key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            return Err("Invalid storage key".into());
        }
        let path = self.root.join("storage").join(format!("{id}.json"));
        let mut data: BTreeMap<String, Value> = if path.exists() {
            serde_json::from_str(&bounded_read(&path, LIMIT)?).map_err(|e| e.to_string())?
        } else {
            BTreeMap::new()
        };
        if let Some(value) = value {
            data.insert(key.into(), value);
            let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
            if bytes.len() as u64 > LIMIT {
                return Err("Plugin storage exceeds 1 MB".into());
            }
            atomic_write(&path, &bytes)?;
            Ok(Value::Null)
        } else {
            Ok(data.get(key).cloned().unwrap_or(Value::Null))
        }
    }

    pub fn list(&self) -> Value {
        json!(self.installed.values().collect::<Vec<_>>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_permission_boundary() {
        let mut bundle = Bundle {
            manifest: serde_json::from_str(include_str!("../../plugins/agent-chat/plugin.json"))
                .unwrap(),
            source: "function activate() {}".into(),
        };
        assert!(validate(&bundle).is_ok());
        bundle.manifest["permissions"] = json!(["process.spawn"]);
        assert!(validate(&bundle).is_err());
        bundle.manifest["permissions"] = json!([]);
        bundle.manifest["main"] = json!("../escape.js");
        assert!(validate(&bundle).is_err());
    }
    #[test]
    fn min_desktop_version_follows_the_running_app() {
        let mut bundle = Bundle {
            manifest: serde_json::from_str(include_str!("../../plugins/agent-chat/plugin.json"))
                .unwrap(),
            source: "function activate() {}".into(),
        };
        let current = env!("CARGO_PKG_VERSION");
        bundle.manifest["minDesktopVersion"] = json!(current);
        assert!(validate(&bundle).is_ok());
        let mut next = version(current).unwrap();
        next[2] += 1;
        bundle.manifest["minDesktopVersion"] =
            json!(format!("{}.{}.{}", next[0], next[1], next[2]));
        assert!(validate(&bundle).is_err());
    }
    #[test]
    fn manifest_translation_boundary() {
        let mut bundle = Bundle {
            manifest: serde_json::from_str(include_str!("../../plugins/agent-chat/plugin.json"))
                .unwrap(),
            source: "function activate() {}".into(),
        };
        assert!(validate(&bundle).is_ok());
        bundle.manifest["nameI18n"] = json!({"fr": "Chat"});
        assert!(validate(&bundle).is_err());
        bundle.manifest["nameI18n"] = json!({"zh-CN": 123});
        assert!(validate(&bundle).is_err());
        bundle.manifest.as_object_mut().unwrap().remove("nameI18n");
        assert!(validate(&bundle).is_ok());
        bundle.manifest["contributes"]["commands"][0]["titleI18n"] = json!({"en": ""});
        assert!(validate(&bundle).is_err());
        bundle.manifest["contributes"]["commands"][0]["titleI18n"] = json!({});
        bundle.manifest["contributes"]["panels"][0]["titleI18n"] = json!({"en": "x".repeat(101)});
        assert!(validate(&bundle).is_err());
    }
    #[test]
    fn manifest_requires_and_validates_allowlists() {
        let mut bundle = Bundle {
            manifest: serde_json::from_str(include_str!("../../examples/hello-plugin/plugin.json"))
                .unwrap(),
            source: "function activate() {}".into(),
        };
        bundle.manifest["permissions"] = json!(["workspace.write"]);
        assert!(validate(&bundle).is_err());
        bundle.manifest["access"] = json!({ "workspaceWrite": ["notes/**"] });
        assert!(validate(&bundle).is_ok());
        bundle.manifest["access"] = json!({ "workspaceWrite": ["../escape"] });
        assert!(validate(&bundle).is_err());
        bundle.manifest["permissions"] = json!(["network.fetch"]);
        bundle.manifest["access"] = json!({ "network": ["api.example.com", "*.trusted.dev"] });
        assert!(validate(&bundle).is_ok());
        bundle.manifest["access"] = json!({ "network": ["https://evil.com"] });
        assert!(validate(&bundle).is_err());
        bundle.manifest["access"] = json!({ "network": ["evil.com"], "workspaceWrite": ["a/*"] });
        assert!(validate(&bundle).is_err());
    }
    #[test]
    fn example_plugin_api_demo_validates() {
        let bundle = Bundle {
            manifest: serde_json::from_str(include_str!(
                "../../examples/plugin-api-demo/plugin.json"
            ))
            .unwrap(),
            source: include_str!("../../examples/plugin-api-demo/index.js").into(),
        };
        assert_eq!(validate(&bundle).unwrap(), "plugin-api-demo");
    }

    #[test]
    fn git_diff_plugin_manifest_passes_review_validation() {
        let mut bundle = Bundle {
            manifest: serde_json::from_str(include_str!(
                "../../plugins/git-diff-plugin/plugin.json"
            ))
            .unwrap(),
            source: include_str!("../../plugins/git-diff-plugin/index.js").into(),
        };
        assert_eq!(validate(&bundle).unwrap(), "git-diff");
        // Read-only Git access only; write/exec permissions are rejected.
        bundle.manifest["permissions"] = json!(["workspace.git", "process.spawn"]);
        assert!(validate(&bundle).is_err());
    }
    #[test]
    fn dev_link_reloads_code_but_not_permissions() {
        let root = std::env::temp_dir().join(format!("pion-dev-test-{}", std::process::id()));
        let folder = root.join("source");
        fs::create_dir_all(&folder).unwrap();
        let manifest = include_str!("../../examples/hello-plugin/plugin.json");
        fs::write(folder.join("plugin.json"), manifest).unwrap();
        fs::write(folder.join("index.js"), "function activate() {}").unwrap();
        let mut plugins = Plugins::open(root.join("app")).unwrap();
        let zip = root.join("hello.zip");
        fs::write(&zip, "not a folder").unwrap();
        assert!(plugins.review(zip.to_str().unwrap(), true).is_err());
        let review = plugins.review(folder.to_str().unwrap(), true).unwrap();
        plugins.approve(&review.digest).unwrap();
        let path = plugins.dev_path("hello-plugin").unwrap();
        let unchanged = read_dev(&path).unwrap();
        assert!(plugins
            .dev_update("hello-plugin", &path, unchanged)
            .unwrap()
            .is_none());
        fs::write(folder.join("index.js"), "function activate() { /* v2 */ }").unwrap();
        let changed = read_dev(&path).unwrap();
        let next = plugins
            .dev_update("hello-plugin", &path, changed)
            .unwrap()
            .unwrap();
        assert!(next.bundle.source.contains("v2"));
        let reopened = Plugins::open(root.join("app")).unwrap();
        assert!(reopened.installed["hello-plugin"]
            .bundle
            .source
            .contains("v2"));
        let mut widened: Value = serde_json::from_str(manifest).unwrap();
        widened["permissions"] = json!(["storage", "pi.sendMessage"]);
        fs::write(folder.join("plugin.json"), widened.to_string()).unwrap();
        let widened = read_dev(&path).unwrap();
        assert!(plugins.dev_update("hello-plugin", &path, widened).is_err());
        assert!(plugins.installed["hello-plugin"]
            .bundle
            .source
            .contains("v2"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn install_snapshot_authorization_storage_and_zip() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("pion-plugins-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let folder = root.join("source");
        fs::create_dir_all(&folder).unwrap();
        let manifest = include_str!("../../examples/hello-plugin/plugin.json");
        let source = include_str!("../../examples/hello-plugin/index.js");
        fs::write(folder.join("plugin.json"), manifest).unwrap();
        fs::write(folder.join("index.js"), source).unwrap();
        let data = root.join("app");
        let mut plugins = Plugins::open(data.clone()).unwrap();
        let review = plugins.review(folder.to_str().unwrap(), false).unwrap();
        assert!(plugins.require("hello-plugin", "storage").is_err());
        assert!(plugins.approve("wrong-digest").is_err());
        fs::write(folder.join("index.js"), "modified after review").unwrap();
        plugins.approve(&review.digest).unwrap();
        assert_eq!(plugins.installed["hello-plugin"].bundle.source, source);
        plugins
            .storage("hello-plugin", "count", Some(json!(7)))
            .unwrap();
        assert_eq!(
            plugins.storage("hello-plugin", "count", None).unwrap(),
            json!(7)
        );
        assert!(plugins.require("hello-plugin", "pi.sendMessage").is_err());
        plugins.enable("hello-plugin", false).unwrap();
        assert!(plugins.storage("hello-plugin", "count", None).is_err());
        let mut reopened = Plugins::open(data).unwrap();
        assert!(!reopened.installed["hello-plugin"].enabled);
        reopened.remove("hello-plugin").unwrap();
        assert!(reopened.installed.is_empty());
        let zip_path = root.join("hello.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("plugin.json", options).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.start_file("index.js", options).unwrap();
        zip.write_all(source.as_bytes()).unwrap();
        zip.finish().unwrap();
        let zip_review = reopened.review(zip_path.to_str().unwrap(), false).unwrap();
        assert_eq!(zip_review.digest, review.digest);
        reopened.approve(&zip_review.digest).unwrap();
        assert_eq!(
            reopened.storage("hello-plugin", "count", None).unwrap(),
            json!(7)
        );
        fs::remove_dir_all(root).unwrap();
    }
}
