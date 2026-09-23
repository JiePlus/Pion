use crate::workspace::bounded_read;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Component, Path};
use std::process::Stdio;

const MAX_SOURCE: usize = 512;
const MAX_OUTPUT: u64 = 64 * 1024;

pub fn validate_source(source: &str) -> Result<&str, String> {
    let source = source.trim();
    if source.is_empty() || source.len() > MAX_SOURCE || source.chars().any(char::is_control) {
        return Err("Invalid Pi package source".into());
    }
    let path = Path::new(source);
    let relative_path = matches!(
        path.components().next(),
        Some(Component::CurDir) | Some(Component::ParentDir)
    );
    if source.starts_with("npm:") && source.len() > 4
        || source.starts_with("git:") && source.len() > 4
        || ["https://", "http://", "ssh://", "git://"]
            .iter()
            .any(|prefix| source.starts_with(prefix) && source.len() > prefix.len())
        || path.is_absolute()
        || relative_path
    {
        Ok(source)
    } else {
        Err("Use an npm:, git:, URL, or local path source".into())
    }
}

pub fn configured(settings: &Value) -> Vec<String> {
    settings["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["autoload"] != false)
        .filter_map(|item| item.as_str().or_else(|| item["source"].as_str()))
        .filter_map(|source| validate_source(source).ok().map(str::to_string))
        .collect()
}

fn configured_at(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = bounded_read(path, 1024 * 1024)?;
    let settings: Value =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    Ok(configured(&settings))
}

pub fn list(home: &Path, project: Option<&Path>) -> Result<Value, String> {
    let agent = std::env::var_os("PI_CODING_AGENT_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(".pi/agent"));
    let mut sources: Vec<Value> = configured_at(&agent.join("settings.json"))?
        .into_iter()
        .map(|source| json!({"source":source,"scope":"user"}))
        .collect();
    if let Some(project) = project {
        sources.extend(
            configured_at(&project.join(".pi/settings.json"))?
                .into_iter()
                .map(|source| json!({"source":source,"scope":"project"})),
        );
    }
    Ok(json!({"sources":sources}))
}

fn command_args<'a>(action: &str, source: &'a str, local: bool) -> Result<Vec<&'a str>, String> {
    let approval = if local { "--approve" } else { "--no-approve" };
    match action {
        "install" if local => Ok(vec!["install", source, "--local", approval]),
        "remove" if local => Ok(vec!["remove", source, "--local", approval]),
        "install" => Ok(vec!["install", source, approval]),
        "remove" => Ok(vec!["remove", source, approval]),
        "update" => Ok(vec!["update", "--extension", source, approval]),
        _ => Err("Unknown Pi package action".into()),
    }
}

pub fn run(
    executable: &str,
    home: &Path,
    project: Option<&Path>,
    scope: &str,
    action: &str,
    source: &str,
) -> Result<Value, String> {
    let source = validate_source(source)?;
    let cwd = match scope {
        "user" => home,
        "project" => project.ok_or("No selected project")?,
        _ => return Err("Unknown Pi package scope".into()),
    };
    let existing = list(home, project)?;
    if action != "install"
        && !existing["sources"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|item| item["source"] == source && item["scope"] == scope)
    {
        return Err("Pi package is not installed in this scope".into());
    }
    let args = command_args(action, source, scope == "project")?;
    let mut command = crate::pi_setup::pi_command(Path::new(executable))?;
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
    let mut child = command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start Pi: {e}"))?;
    let mut stderr = Vec::new();
    child
        .stderr
        .take()
        .ok_or("No Pi stderr")?
        .take(MAX_OUTPUT + 1)
        .read_to_end(&mut stderr)
        .map_err(|e| e.to_string())?;
    if stderr.len() as u64 > MAX_OUTPUT {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Pi package command output exceeded 64 KB".into());
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!(
            "Pi package command failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    list(home, project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn global_sources_are_bounded_and_structured() {
        assert_eq!(
            configured(
                &json!({"packages":["npm:a",{"source":"git:host/repo","skills":[]},"./relative"]})
            ),
            vec!["npm:a", "git:host/repo", "./relative"]
        );
        assert_eq!(
            configured(
                &json!({"packages":[{"source":"npm:inherited","autoload":false,"skills":["-skills/a/SKILL.md"]}]})
            ),
            Vec::<String>::new()
        );
        assert!(validate_source("").is_err());
        assert_eq!(validate_source("./relative").unwrap(), "./relative");
        assert_eq!(validate_source("../relative").unwrap(), "../relative");
        assert!(validate_source("npm:").is_err());
        assert!(validate_source("npm:bad\nsource").is_err());
        assert!(validate_source(&"a".repeat(513)).is_err());
        assert_eq!(
            validate_source("https://example.com/package").unwrap(),
            "https://example.com/package"
        );
        assert_eq!(
            validate_source("/absolute/local").unwrap(),
            "/absolute/local"
        );
        assert_eq!(
            command_args("install", "npm:a", false).unwrap(),
            ["install", "npm:a", "--no-approve"]
        );
        assert_eq!(
            command_args("update", "npm:a", false).unwrap(),
            ["update", "--extension", "npm:a", "--no-approve"]
        );
        assert_eq!(
            command_args("remove", "npm:a", false).unwrap(),
            ["remove", "npm:a", "--no-approve"]
        );
        assert_eq!(
            command_args("install", "npm:a", true).unwrap(),
            ["install", "npm:a", "--local", "--approve"]
        );
        assert!(command_args("unknown", "npm:a", false).is_err());
    }
}
