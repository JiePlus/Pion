use semver::Version;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
pub const VERIFIED_VERSION: &str = "0.87.1";
#[cfg(not(target_os = "macos"))]
pub const VERIFIED_VERSION: &str = "0.87.0";
const PACKAGE: &str = "@earendil-works/pi-coding-agent";
const MAX_OUTPUT: usize = 64 * 1024;

struct Output {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

fn drain(mut reader: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buffer = [0; 4096];
        while let Ok(size) = reader.read(&mut buffer) {
            if size == 0 {
                break;
            }
            let remaining = MAX_OUTPUT.saturating_sub(kept.len());
            kept.extend_from_slice(&buffer[..size.min(remaining)]);
        }
        kept
    })
}

fn run(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = drain(child.stdout.take().ok_or("No command stdout")?);
    let stderr = drain(child.stderr.take().ok_or("No command stderr")?);
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Command timed out".into());
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stdout = stdout.join().map_err(|_| "Cannot read command stdout")?;
    let stderr = stderr.join().map_err(|_| "Cannot read command stderr")?;
    Ok(Output {
        status,
        stdout: String::from_utf8_lossy(&stdout).trim().into(),
        stderr: String::from_utf8_lossy(&stderr).trim().into(),
    })
}

fn command_path(name: &str, home: &Path) -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> =
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    #[cfg(target_os = "macos")]
    {
        directories.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Ok(entries) = fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin"))
                .collect();
            versions.sort();
            versions.reverse();
            directories.extend(versions);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(path).join("nodejs"));
        }
        if let Some(path) = env::var_os("APPDATA") {
            directories.push(PathBuf::from(path).join("npm"));
        }
    }
    let _ = home;
    directories
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
const NPM_NAME: &str = "npm.cmd";
#[cfg(not(target_os = "windows"))]
const NPM_NAME: &str = "npm";
#[cfg(target_os = "windows")]
const NODE_NAME: &str = "node.exe";
#[cfg(not(target_os = "windows"))]
const NODE_NAME: &str = "node";
#[cfg(target_os = "windows")]
const PI_NAME: &str = "pi.cmd";
#[cfg(not(target_os = "windows"))]
const PI_NAME: &str = "pi";

#[cfg(target_os = "windows")]
fn node_path(sibling: &Path) -> Option<PathBuf> {
    sibling
        .parent()
        .map(|parent| parent.join(NODE_NAME))
        .filter(|path| path.is_file())
        .or_else(|| command_path(NODE_NAME, Path::new("")))
}

#[cfg(target_os = "windows")]
fn npm_command(npm: &Path) -> Result<Command, String> {
    let node = node_path(npm).ok_or("Node.js 22.19+ is required")?;
    let script = node
        .parent()
        .ok_or("Cannot locate Node.js")?
        .join("node_modules/npm/bin/npm-cli.js");
    if !script.is_file() {
        return Err("Cannot locate npm CLI".into());
    }
    let mut command = Command::new(node);
    command.arg(script);
    Ok(command)
}

#[cfg(not(target_os = "windows"))]
fn npm_command(npm: &Path) -> Result<Command, String> {
    Ok(Command::new(npm))
}

pub fn pi_command(executable: &Path) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    if executable
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("cmd"))
    {
        let script = executable
            .parent()
            .ok_or("Cannot locate Pi")?
            .join("node_modules/@earendil-works/pi-coding-agent/dist/index.js");
        if !script.is_file() {
            return Err("Cannot locate Pi CLI".into());
        }
        let node = node_path(executable).ok_or("Node.js 22.19+ is required")?;
        let mut command = Command::new(node);
        command.arg(script);
        return Ok(command);
    }
    Ok(Command::new(executable))
}

fn npm_path(executable: &str, home: &Path) -> Option<PathBuf> {
    let sibling = Path::new(executable).parent()?.join(NPM_NAME);
    if Path::new(executable).is_absolute() && sibling.is_file() {
        Some(sibling)
    } else {
        command_path(NPM_NAME, home)
    }
}

fn with_path(command: &mut Command, executable: &Path) {
    if let Some(parent) = executable.parent() {
        let mut paths = vec![parent.to_path_buf()];
        paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
        if let Ok(value) = env::join_paths(paths) {
            command.env("PATH", value);
        }
    }
}

fn version(executable: &Path) -> Result<String, String> {
    let mut command = pi_command(executable)?;
    with_path(&mut command, executable);
    let output = run(command.arg("--version"), Duration::from_secs(15))?;
    if !output.status.success() {
        return Err(if output.stderr.is_empty() {
            output.stdout
        } else {
            output.stderr
        });
    }
    Version::parse(&output.stdout).map_err(|_| "Pi returned an invalid version".to_string())?;
    Ok(output.stdout)
}

fn npm_prefix(npm: &Path) -> Result<PathBuf, String> {
    let mut command = npm_command(npm)?;
    with_path(&mut command, npm);
    let output = run(command.args(["prefix", "-g"]), Duration::from_secs(20))?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err(format!(
            "Cannot locate global npm prefix: {}",
            output.stderr
        ));
    }
    Ok(PathBuf::from(output.stdout))
}

fn global_pi(prefix: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        prefix.join(PI_NAME)
    }
    #[cfg(not(target_os = "windows"))]
    {
        prefix.join("bin").join(PI_NAME)
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => {
            #[cfg(target_os = "windows")]
            {
                left.to_string_lossy()
                    .eq_ignore_ascii_case(&right.to_string_lossy())
            }
            #[cfg(not(target_os = "windows"))]
            {
                left == right
            }
        }
        _ => false,
    }
}

pub fn inspect(executable: &str, home: &Path) -> Value {
    let npm = npm_path(executable, home);
    let resolved = if Path::new(executable).is_absolute() {
        Some(PathBuf::from(executable))
    } else {
        command_path(executable, home).or_else(|| {
            npm.as_ref()
                .and_then(|npm| npm_prefix(npm).ok())
                .map(|prefix| global_pi(&prefix))
        })
    };
    let Some(path) = resolved else {
        return json!({"installation":"missing","verifiedVersion":VERIFIED_VERSION,"canInstall":npm.is_some()});
    };
    let installed = match version(&path) {
        Ok(version) => version,
        Err(error) => {
            return json!({"installation":"broken","detail":error,"executable":path,"verifiedVersion":VERIFIED_VERSION,"canInstall":npm.is_some()});
        }
    };
    let npm_managed = npm
        .as_ref()
        .and_then(|npm| npm_prefix(npm).ok())
        .is_some_and(|prefix| same_file(&path, &global_pi(&prefix)));
    json!({
        "installation":"ready",
        "executable":path,
        "installedVersion":installed,
        "verifiedVersion":VERIFIED_VERSION,
        "npmManaged":npm_managed,
        "canInstall":npm.is_some()
    })
}

pub fn check_model(executable: &Path, provider: &str, model_id: &str) -> Result<bool, String> {
    let safe = |value: &str| {
        value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "/._-:@".contains(character))
    };
    if provider.is_empty()
        || model_id.is_empty()
        || provider.contains('/')
        || !safe(provider)
        || !safe(model_id)
        || provider.len() > 100
        || model_id.len() > 256
    {
        return Err("Invalid Pi model".into());
    }
    let mut command = pi_command(executable)?;
    with_path(&mut command, executable);
    let output = run(
        command.args([
            "auth",
            "check",
            "--provider",
            provider,
            "--json",
            "--no-refresh",
        ]),
        Duration::from_secs(30),
    )?;
    let response: Value = serde_json::from_str(&output.stdout)
        .map_err(|_| format!("Pi authentication check failed: {}", output.stderr))?;
    // Extension providers are registered only inside the RPC process. The caller has
    // already confirmed this model appears in RPC's authenticated model list.
    Ok((output.status.success() && response["status"] == "ready")
        || (response["status"] == "not_ready" && response["reason"] == "provider_not_found"))
}

pub fn latest_version() -> Result<String, String> {
    let response: Value = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())?
        .get("https://pi.dev/api/latest-version")
        .header("accept", "application/json")
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json())
        .map_err(|error| format!("Cannot check Pi updates: {error}"))?;
    let latest = response["version"]
        .as_str()
        .ok_or("Invalid Pi version response")?;
    Version::parse(latest).map_err(|_| "Invalid Pi version response".to_string())?;
    Ok(latest.into())
}

pub fn can_update(status: &Value, latest: &str) -> bool {
    if status["installation"] != "ready" || status["npmManaged"] != true {
        return false;
    }
    let (Some(installed), Ok(verified), Ok(latest)) = (
        status["installedVersion"]
            .as_str()
            .and_then(|value| Version::parse(value).ok()),
        Version::parse(VERIFIED_VERSION),
        Version::parse(latest),
    ) else {
        return false;
    };
    installed < verified && verified <= latest
}

pub fn update_available(executable: &str, home: &Path) -> bool {
    let status = inspect(executable, home);
    let Some(installed) = status["installedVersion"]
        .as_str()
        .and_then(|value| Version::parse(value).ok())
    else {
        return false;
    };
    status["npmManaged"] == true
        && Version::parse(VERIFIED_VERSION).is_ok_and(|verified| installed < verified)
}

fn install_with_npm(npm: &Path, home: &Path) -> Result<PathBuf, String> {
    let node = npm.parent().ok_or("Cannot locate npm")?.join(NODE_NAME);
    let node = if node.is_file() {
        node
    } else {
        command_path(NODE_NAME, home).ok_or("Node.js 22.19+ is required")?
    };
    let mut node_command = Command::new(&node);
    let node_output = run(node_command.arg("--version"), Duration::from_secs(15))?;
    let installed = Version::parse(node_output.stdout.trim_start_matches('v'))
        .map_err(|_| "Cannot read Node.js version".to_string())?;
    if installed < Version::new(22, 19, 0) {
        return Err("Node.js 22.19+ is required".into());
    }
    let mut command = npm_command(npm)?;
    with_path(&mut command, npm);
    command.current_dir(home);
    let output = run(
        command.args([
            "install",
            "-g",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            &format!("{PACKAGE}@{VERIFIED_VERSION}"),
        ]),
        Duration::from_secs(300),
    )?;
    if !output.status.success() {
        return Err(format!(
            "Pi installation failed: {}",
            if output.stderr.is_empty() {
                output.stdout
            } else {
                output.stderr
            }
        ));
    }
    let path = global_pi(&npm_prefix(npm)?);
    if version(&path)? != VERIFIED_VERSION {
        return Err("Pi installation returned an unexpected version".into());
    }
    Ok(path)
}

pub fn install(executable: &str, home: &Path) -> Result<PathBuf, String> {
    let npm =
        npm_path(executable, home).ok_or("npm was not found; install Node.js 22.19+ first")?;
    install_with_npm(&npm, home)
}

pub fn update(executable: &str, home: &Path) -> Result<PathBuf, String> {
    if !update_available(executable, home) {
        return Err("No newer Pion-verified Pi version is available".into());
    }
    let npm = npm_path(executable, home).ok_or("npm was not found")?;
    install_with_npm(&npm, home)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_path_and_version_policy() {
        assert!(
            global_pi(Path::new("/tmp/npm")).ends_with(if cfg!(windows) {
                "pi.cmd"
            } else {
                "bin/pi"
            })
        );
        assert!(Version::parse(VERIFIED_VERSION).unwrap() <= Version::parse("0.87.1").unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn fake_npm_updates_only_the_pinned_version() {
        use std::os::unix::fs::PermissionsExt;

        let root = env::temp_dir().join(format!("pion-pi-setup-{}", std::process::id()));
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let node = bin.join("node");
        let npm = bin.join("npm");
        let pi = bin.join("pi");
        let version_file = root.join("version");
        let args_file = root.join("args");
        fs::write(&node, "#!/bin/sh\necho v24.0.0\n").unwrap();
        fs::write(
            &pi,
            format!("#!/bin/sh\ncat '{}'\n", version_file.display()),
        )
        .unwrap();
        fs::write(&version_file, "0.86.0\n").unwrap();
        fs::write(
            &npm,
            format!(
                "#!/bin/sh\nif [ \"$1\" = prefix ]; then echo '{}'; exit 0; fi\nprintf '%s\\n' \"$@\" > '{}'\necho '{}' > '{}'\n",
                root.display(),
                args_file.display(),
                VERIFIED_VERSION,
                version_file.display()
            ),
        )
        .unwrap();
        for path in [&node, &npm, &pi] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        assert!(inspect(pi.to_str().unwrap(), &root)["npmManaged"] == true);
        assert!(update_available(pi.to_str().unwrap(), &root));
        assert_eq!(update(pi.to_str().unwrap(), &root).unwrap(), pi);
        assert_eq!(version(&pi).unwrap(), VERIFIED_VERSION);
        assert!(fs::read_to_string(&args_file)
            .unwrap()
            .contains(&format!("{PACKAGE}@{VERIFIED_VERSION}")));
        assert!(!update_available(pi.to_str().unwrap(), &root));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn fake_npm_install_failure_reports_the_error() {
        use std::os::unix::fs::PermissionsExt;

        let root = env::temp_dir().join(format!("pion-pi-install-failure-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let node = root.join("node");
        let npm = root.join("npm");
        fs::write(&node, "#!/bin/sh\necho v24.0.0\n").unwrap();
        fs::write(&npm, "#!/bin/sh\necho 'network unavailable' >&2\nexit 42\n").unwrap();
        for path in [&node, &npm] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(install_with_npm(&npm, &root)
            .unwrap_err()
            .contains("network unavailable"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn fake_pi_authentication_can_be_unready() {
        use std::os::unix::fs::PermissionsExt;

        let root = env::temp_dir().join(format!("pion-pi-auth-check-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let pi = root.join("pi");
        fs::write(
            &pi,
            "#!/bin/sh\ncase \"$*\" in\n  'auth check --provider ready --json --no-refresh') echo '{\"status\":\"ready\"}' ;;\n  'auth check --provider extension --json --no-refresh') echo '{\"status\":\"not_ready\",\"reason\":\"provider_not_found\"}' ;;\n  *) echo '{\"status\":\"not_ready\",\"reason\":\"credentials_not_configured\"}' ;;\nesac\n",
        )
        .unwrap();
        fs::set_permissions(&pi, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!check_model(&pi, "openai", "gpt-test").unwrap());
        assert!(check_model(&pi, "ready", "gpt-test").unwrap());
        assert!(check_model(&pi, "extension", "gpt-test").unwrap());
        assert!(check_model(&pi, "openai", "gpt-test&unsafe").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
