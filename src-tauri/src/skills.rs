use crate::pi_auth;
use crate::workspace::bounded_read;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

const LIMIT: u64 = 1024 * 1024;

fn agent_dir(home: &Path) -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pi/agent"))
}

fn settings(path: &Path) -> Result<(Value, bool, bool, bool), String> {
    if !path.exists() {
        return Ok((json!({}), false, false, true));
    }
    if path.is_symlink() {
        return Err("Pi settings must be a regular file".into());
    }
    let text = bounded_read(path, LIMIT)?;
    let bom = text.starts_with('\u{feff}');
    let content = text.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Invalid Pi settings".into());
    }
    if !value["skills"].is_null()
        && !value["skills"]
            .as_array()
            .is_some_and(|items| items.iter().all(Value::is_string))
    {
        return Err("Invalid Pi skill settings".into());
    }
    Ok((
        value,
        bom,
        content.contains("\r\n"),
        content.ends_with('\n'),
    ))
}

fn paths(settings: &Value) -> Vec<String> {
    settings["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

pub fn run(
    executable: &str,
    helper: &Path,
    home: &Path,
    project: Option<&Path>,
) -> Result<Value, String> {
    let cwd = project.unwrap_or(home);
    let output = pi_auth::node_command(executable, helper)?
        .arg(cwd)
        .arg(project.is_some().to_string())
        .current_dir(cwd)
        .env("PI_OFFLINE", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start Pi skill manager: {e}"))?;
    if output.stdout.len() > LIMIT as usize {
        return Err("Pi skill list is too large".into());
    }
    let mut result: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    if !output.status.success() || result["error"].is_string() {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Pi skill manager failed")
            .into());
    }
    if let Some(project) = project {
        let config = settings(&project.join(".pi/settings.json"))?.0;
        if let Some(skills) = result["skills"].as_array_mut() {
            for skill in skills {
                skill["projectOverride"] = json!(project_override(&config, skill, home, project)?);
            }
        }
    }
    Ok(result)
}

fn target(entry: &str) -> &str {
    entry.strip_prefix(['!', '+', '-']).unwrap_or(entry)
}

fn skill_pattern(skill: &Value) -> Result<String, String> {
    if let Some(pattern) = skill["pattern"].as_str() {
        if !pattern.is_empty() {
            return Ok(pattern.to_string());
        }
    }
    let path = skill["path"].as_str().ok_or("Missing Pi skill path")?;
    let base = skill["baseDir"].as_str().ok_or("Missing Pi skill base")?;
    Path::new(path)
        .strip_prefix(base)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "Invalid Pi skill resource path".into())
}

fn package_source<'a>(package: &'a Value) -> Option<&'a str> {
    package.as_str().or_else(|| package["source"].as_str())
}

fn local_source(source: &str, base: &Path, home: &Path) -> Option<PathBuf> {
    if source.contains(':') {
        return None;
    }
    let path = Path::new(source);
    let resolved = if source == "~" {
        home.to_path_buf()
    } else if let Some(rest) = source.strip_prefix("~/") {
        home.join(rest)
    } else if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    };
    Some(fs::canonicalize(&resolved).unwrap_or(resolved))
}

fn matching_package<'a>(
    config: &'a Value,
    skill: &Value,
    home: &Path,
    project: &Path,
) -> Option<&'a Value> {
    let source = skill["source"].as_str()?;
    let source_base = if skill["scope"] == "project" {
        project.join(".pi")
    } else {
        agent_dir(home)
    };
    config["packages"].as_array()?.iter().find(|package| {
        let Some(other) = package_source(package) else {
            return false;
        };
        if source == other {
            return true;
        }
        matches!(
            (
                local_source(source, &source_base, home),
                local_source(other, &project.join(".pi"), home)
            ),
            (Some(left), Some(right)) if left == right
        )
    })
}

fn project_override(
    config: &Value,
    skill: &Value,
    home: &Path,
    project: &Path,
) -> Result<&'static str, String> {
    let pattern = skill_pattern(skill)?;
    let entries = if skill["origin"] == "package" {
        let Some(package) = matching_package(config, skill, home, project) else {
            return Ok("inherit");
        };
        let Some(entries) = package["skills"].as_array() else {
            return Ok("inherit");
        };
        if entries.is_empty() && package["autoload"] != false {
            return Ok("unload");
        }
        entries
    } else {
        let Some(entries) = config["skills"].as_array() else {
            return Ok("inherit");
        };
        entries
    };
    let path = skill["path"].as_str().ok_or("Missing Pi skill path")?;
    let project_relative = Path::new(path)
        .strip_prefix(project.join(".pi"))
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let mut state = "inherit";
    for entry in entries.iter().filter_map(Value::as_str) {
        if target(entry) == pattern
            || (skill["origin"] == "top-level"
                && (target(entry) == path || target(entry) == project_relative))
        {
            state = if entry.starts_with(['!', '-']) {
                "unload"
            } else {
                "load"
            };
        }
    }
    Ok(state)
}

fn save(
    path: &Path,
    config: &Value,
    bom: bool,
    crlf: bool,
    final_newline: bool,
) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    if crlf {
        text = text.replace('\n', "\r\n");
    }
    if final_newline {
        text.push_str(if crlf { "\r\n" } else { "\n" });
    }
    if bom {
        text.insert(0, '\u{feff}');
    }
    if text.len() as u64 > LIMIT {
        return Err("Pi settings exceed 1 MB".into());
    }
    fs::create_dir_all(path.parent().ok_or("Invalid Pi settings path")?)
        .map_err(|e| e.to_string())?;
    let temp = path.with_extension("pion.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        if path.exists() {
            file.set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
                .map_err(|e| e.to_string())?;
        }
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub fn change(
    home: &Path,
    project: Option<&Path>,
    scope: &str,
    action: &str,
    source: &str,
) -> Result<(), String> {
    if source.is_empty() || source.len() > 1024 || source.chars().any(char::is_control) {
        return Err("Invalid skill path".into());
    }
    let path = match scope {
        "user" => agent_dir(home).join("settings.json"),
        "project" => project
            .ok_or("No selected project")?
            .join(".pi/settings.json"),
        _ => return Err("Unknown Pi skill scope".into()),
    };
    let (mut config, bom, crlf, final_newline) = settings(&path)?;
    let mut configured = paths(&config);
    match action {
        "add" => {
            if source.starts_with(['!', '+', '-']) {
                return Err("Use a Pi skill file or directory path".into());
            }
            let base = path.parent().ok_or("Invalid Pi settings path")?;
            let resolved =
                local_source(source, base, home).ok_or("Use a Pi skill file or directory path")?;
            if !resolved.is_file() && !resolved.is_dir() {
                return Err("Pi skill file or directory does not exist".into());
            }
            if !configured.iter().any(|entry| entry == source) {
                configured.push(source.to_string());
            }
        }
        "remove" => {
            if !configured.iter().any(|path| path == source) {
                return Err("Skill path is not configured".into());
            }
            configured.retain(|path| path != source);
        }
        _ => return Err("Unknown skill action".into()),
    }
    config["skills"] = json!(configured);
    save(&path, &config, bom, crlf, final_newline)
}

pub fn toggle(
    home: &Path,
    project: Option<&Path>,
    listing: &Value,
    skill_path: &str,
    enabled: bool,
) -> Result<(), String> {
    let skill = listing["skills"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["path"] == skill_path))
        .ok_or("Unknown Pi skill")?;
    let scope = skill["scope"].as_str().ok_or("Missing Pi skill scope")?;
    let config_path = match scope {
        "user" => agent_dir(home).join("settings.json"),
        "project" => project
            .ok_or("No selected project")?
            .join(".pi/settings.json"),
        _ => return Err("Unknown Pi skill scope".into()),
    };
    let pattern = skill_pattern(skill)?;
    let (mut config, bom, crlf, final_newline) = settings(&config_path)?;
    let origin = skill["origin"].as_str().ok_or("Missing Pi skill origin")?;
    let marker = if enabled { '+' } else { '-' };
    if origin == "top-level" {
        let mut entries = paths(&config);
        entries.retain(|entry| entry.trim_start_matches(['!', '+', '-']) != pattern);
        entries.push(format!("{marker}{pattern}"));
        config["skills"] = json!(entries);
    } else if origin == "package" {
        let source = skill["source"]
            .as_str()
            .ok_or("Missing Pi package source")?;
        let package = config["packages"]
            .as_array_mut()
            .and_then(|items| {
                items
                    .iter_mut()
                    .find(|item| item.as_str().or_else(|| item["source"].as_str()) == Some(source))
            })
            .ok_or("Pi package is no longer configured")?;
        if package.is_string() {
            *package = json!({"source":source});
        }
        let filters = package["skills"].as_array();
        if package["skills"].is_null()
            || filters.is_some_and(|items| items.iter().all(Value::is_string))
        {
            let mut entries: Vec<String> = filters
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|entry| entry.trim_start_matches(['!', '+', '-']) != pattern)
                .map(str::to_string)
                .collect();
            entries.push(format!("{marker}{pattern}"));
            package["skills"] = json!(entries);
        } else {
            return Err("Invalid Pi package skill filters".into());
        }
    } else {
        return Err("Unknown Pi skill origin".into());
    }
    save(&config_path, &config, bom, crlf, final_newline)
}

pub fn set_project_override(
    home: &Path,
    project: &Path,
    listing: &Value,
    skill_path: &str,
    state: &str,
) -> Result<(), String> {
    if !["inherit", "load", "unload"].contains(&state) {
        return Err("Unknown Pi skill override".into());
    }
    let skill = listing["skills"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["path"] == skill_path))
        .ok_or("Unknown Pi skill")?;
    let path = project.join(".pi/settings.json");
    let (mut config, bom, crlf, final_newline) = settings(&path)?;
    let pattern = if skill["scope"] == "user" && skill["origin"] == "top-level" {
        skill_path.to_string()
    } else {
        skill_pattern(skill)?
    };
    if skill["origin"] == "top-level" {
        let mut entries = paths(&config);
        let relative = skill_pattern(skill)?;
        let project_relative = Path::new(skill_path)
            .strip_prefix(project.join(".pi"))
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        entries.retain(|entry| {
            let item = target(entry);
            if entry.starts_with(['!', '+', '-']) {
                item != pattern && item != relative && item != project_relative
            } else {
                !(state == "inherit" && skill["scope"] == "user" && item == skill_path)
            }
        });
        if state != "inherit" {
            if skill["scope"] == "user" && !entries.iter().any(|entry| entry == skill_path) {
                entries.push(skill_path.to_string());
            }
            entries.push(format!(
                "{}{}",
                if state == "load" { '+' } else { '-' },
                pattern
            ));
        }
        config["skills"] = json!(entries);
    } else if skill["origin"] == "package" {
        let source = skill["source"]
            .as_str()
            .ok_or("Missing Pi package source")?;
        let is_user = skill["scope"] == "user";
        if config["packages"].is_null() {
            config["packages"] = json!([]);
        }
        let existing = matching_package(&config, skill, home, project).and_then(|package| {
            config["packages"]
                .as_array()
                .and_then(|items| items.iter().position(|item| item == package))
        });
        let packages = config["packages"]
            .as_array_mut()
            .ok_or("Invalid Pi package settings")?;
        let index = match existing {
            Some(index) => index,
            None if state == "inherit" => return Ok(()),
            None => {
                let value = if is_user {
                    local_source(source, &agent_dir(home), home)
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_else(|| source.to_string())
                } else {
                    source.to_string()
                };
                packages.push(json!({"source": value, "autoload": false}));
                packages.len() - 1
            }
        };
        if packages[index].is_string() {
            let source = packages[index].as_str().ok_or("Invalid Pi package")?;
            packages[index] = json!({"source":source});
        }
        let package = &mut packages[index];
        let entries = package["skills"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|entry| target(entry) != pattern)
            .map(str::to_string)
            .collect::<Vec<_>>();
        let mut entries = entries;
        if state != "inherit" {
            entries.push(format!(
                "{}{}",
                if state == "load" { '+' } else { '-' },
                pattern
            ));
        }
        if entries.is_empty() {
            package
                .as_object_mut()
                .ok_or("Invalid Pi package")?
                .remove("skills");
        } else {
            package["skills"] = json!(entries);
        }
        if state == "inherit"
            && package["autoload"] == false
            && ["skills", "extensions", "prompts", "themes"]
                .iter()
                .all(|key| package[*key].is_null())
        {
            packages.remove(index);
        }
    } else {
        return Err("Unknown Pi skill origin".into());
    }
    save(&path, &config, bom, crlf, final_newline)
}

pub fn set_skill_commands(
    home: &Path,
    project: Option<&Path>,
    scope: &str,
    state: &str,
) -> Result<(), String> {
    let path = match scope {
        "user" => agent_dir(home).join("settings.json"),
        "project" => project
            .ok_or("No selected project")?
            .join(".pi/settings.json"),
        _ => return Err("Unknown Pi skill scope".into()),
    };
    let (mut config, bom, crlf, final_newline) = settings(&path)?;
    match state {
        "enabled" => config["enableSkillCommands"] = json!(true),
        "disabled" => config["enableSkillCommands"] = json!(false),
        "inherit" if scope == "project" => {
            config
                .as_object_mut()
                .ok_or("Invalid Pi settings")?
                .remove("enableSkillCommands");
        }
        _ => return Err("Unknown Pi skill command state".into()),
    }
    save(&path, &config, bom, crlf, final_newline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_and_removing_skill_preserves_settings_line_endings() {
        let home = std::env::temp_dir().join(format!("pion-skills-{}", std::process::id()));
        let agent = home.join(".pi/agent");
        let skill = home.join("sample-skill");
        fs::create_dir_all(&agent).unwrap();
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: sample-skill\ndescription: Example\n---\n",
        )
        .unwrap();
        fs::write(
            agent.join("settings.json"),
            "\u{feff}{\r\n  \"theme\": \"dark\"\r\n}",
        )
        .unwrap();
        change(&home, None, "user", "add", skill.to_str().unwrap()).unwrap();
        let text = fs::read_to_string(agent.join("settings.json")).unwrap();
        assert!(text.starts_with('\u{feff}') && text.contains("\r\n") && !text.ends_with('\n'));
        assert!(text.contains("\"theme\": \"dark\""));
        let source = paths(&settings(&agent.join("settings.json")).unwrap().0)[0].clone();
        change(&home, None, "user", "remove", &source).unwrap();
        assert!(paths(&settings(&agent.join("settings.json")).unwrap().0).is_empty());
        let project = home.join("project");
        change(
            &home,
            Some(&project),
            "project",
            "add",
            skill.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            paths(&settings(&project.join(".pi/settings.json")).unwrap().0),
            vec![source]
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn package_skill_toggle_preserves_other_settings_and_format() {
        let home = std::env::temp_dir().join(format!("pion-skills-toggle-{}", std::process::id()));
        let agent = home.join(".pi/agent");
        let package = home.join("package");
        let skill = package.join("skills/example/SKILL.md");
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("settings.json"),
            format!(
                "\u{feff}{{\r\n  \"theme\": \"dark\",\r\n  \"packages\": [\"{}\"]\r\n}}",
                package.display()
            ),
        )
        .unwrap();
        let listing = json!({"skills":[{"path":skill,"baseDir":package,"origin":"package","scope":"user","source":package}]});
        toggle(&home, None, &listing, skill.to_str().unwrap(), false).unwrap();
        let text = fs::read_to_string(agent.join("settings.json")).unwrap();
        assert!(text.starts_with('\u{feff}') && text.contains("\r\n") && !text.ends_with('\n'));
        let config = settings(&agent.join("settings.json")).unwrap().0;
        assert_eq!(config["theme"], "dark");
        assert_eq!(
            config["packages"][0]["skills"],
            json!(["-skills/example/SKILL.md"])
        );
        toggle(&home, None, &listing, skill.to_str().unwrap(), true).unwrap();
        let config = settings(&agent.join("settings.json")).unwrap().0;
        assert_eq!(
            config["packages"][0]["skills"],
            json!(["+skills/example/SKILL.md"])
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn project_skill_toggle_writes_project_settings() {
        let home = std::env::temp_dir().join(format!("pion-project-skill-{}", std::process::id()));
        let project = home.join("project");
        let base = project.join(".agents");
        let skill = base.join("skills/review/SKILL.md");
        fs::create_dir_all(base.join("skills")).unwrap();
        let listing = json!({"skills":[{"path":skill,"baseDir":base,"origin":"top-level","scope":"project"}]});
        toggle(
            &home,
            Some(&project),
            &listing,
            skill.to_str().unwrap(),
            false,
        )
        .unwrap();
        let config = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert_eq!(config["skills"], json!(["-skills/review/SKILL.md"]));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn project_overrides_inherited_skills_and_restores_inheritance() {
        let home =
            std::env::temp_dir().join(format!("pion-skill-overrides-{}", std::process::id()));
        let project = home.join("project");
        let agent = home.join(".pi/agent");
        let skill = home.join("user-skill/SKILL.md");
        let package = home.join("user-package");
        let package_skill = package.join("skills/example/SKILL.md");
        fs::create_dir_all(&agent).unwrap();
        let listing = json!({"skills":[
            {"path":skill,"baseDir":agent,"pattern":"../../user-skill/SKILL.md","origin":"top-level","scope":"user"},
            {"path":package_skill,"baseDir":package,"origin":"package","scope":"user","source":"npm:example"}
        ]});
        assert!(matching_package(
            &json!({"packages":[{"source":"npm:other"}]}),
            &listing["skills"][1],
            &home,
            &project
        )
        .is_none());
        set_project_override(&home, &project, &listing, skill.to_str().unwrap(), "unload").unwrap();
        let config = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert_eq!(
            config["skills"],
            json!([skill, format!("-{}", skill.display())])
        );
        assert_eq!(
            project_override(&config, &listing["skills"][0], &home, &project).unwrap(),
            "unload"
        );
        set_project_override(
            &home,
            &project,
            &listing,
            package_skill.to_str().unwrap(),
            "load",
        )
        .unwrap();
        let config = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert_eq!(
            config["packages"][0],
            json!({"source":"npm:example","autoload":false,"skills":["+skills/example/SKILL.md"]})
        );
        assert_eq!(
            project_override(&config, &listing["skills"][1], &home, &project).unwrap(),
            "load"
        );
        set_project_override(
            &home,
            &project,
            &listing,
            package_skill.to_str().unwrap(),
            "inherit",
        )
        .unwrap();
        set_project_override(
            &home,
            &project,
            &listing,
            skill.to_str().unwrap(),
            "inherit",
        )
        .unwrap();
        let config = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert_eq!(config["skills"], json!([]));
        assert_eq!(config["packages"], json!([]));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn skill_command_setting_uses_selected_scope() {
        let home = std::env::temp_dir().join(format!("pion-skill-commands-{}", std::process::id()));
        let project = home.join("project");
        set_skill_commands(&home, None, "user", "disabled").unwrap();
        set_skill_commands(&home, Some(&project), "project", "enabled").unwrap();
        let global = settings(&home.join(".pi/agent/settings.json")).unwrap().0;
        let local = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert_eq!(global["enableSkillCommands"], false);
        assert_eq!(local["enableSkillCommands"], true);
        set_skill_commands(&home, Some(&project), "project", "inherit").unwrap();
        let local = settings(&project.join(".pi/settings.json")).unwrap().0;
        assert!(local.get("enableSkillCommands").is_none());
        fs::remove_dir_all(home).unwrap();
    }
}
