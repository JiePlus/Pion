use semver::Version;
use serde_json::{json, Value};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

const PACKAGE: &str = "@earendil-works/pi-coding-agent";
const MAX_OUTPUT: usize = 64 * 1024;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct Output {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg(target_os = "windows")]
    let mut command = Command::new(program);
    #[cfg(not(target_os = "windows"))]
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn drain(mut reader: impl Read + Send + 'static) -> Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
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
        let _ = sender.send(kept);
    });
    receiver
}

fn stop_command(child: &mut Child) {
    // npm and executable shims can leave descendants holding the output pipes.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn run(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let deadline = Instant::now() + timeout;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = drain(child.stdout.take().ok_or("No command stdout")?);
    let stderr = drain(child.stderr.take().ok_or("No command stderr")?);
    let result = (|| {
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                break status;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Command timed out".into());
            }
            thread::sleep(remaining.min(Duration::from_millis(25)));
        };
        let read_output = |receiver: Receiver<Vec<u8>>| {
            receiver
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "Command timed out reading output".to_string())
        };
        let stdout = read_output(stdout)?;
        let stderr = read_output(stderr)?;
        Ok(Output {
            status,
            stdout: String::from_utf8_lossy(&stdout).trim().into(),
            stderr: String::from_utf8_lossy(&stderr).trim().into(),
        })
    })();
    if result.is_err() {
        stop_command(&mut child);
    }
    result
}

fn search_dirs(home: &Path) -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> =
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    #[cfg(target_os = "macos")]
    {
        directories.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
    }
    #[cfg(unix)]
    {
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
}

pub(crate) fn command_path(name: &str, home: &Path) -> Option<PathBuf> {
    search_dirs(home)
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
    let mut command = hidden_command(node);
    command.arg(script);
    Ok(command)
}

#[cfg(not(target_os = "windows"))]
fn npm_command(npm: &Path) -> Result<Command, String> {
    Ok(hidden_command(npm))
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
            .join("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
        if !script.is_file() {
            return Err("Cannot locate Pi CLI".into());
        }
        let node = node_path(executable).ok_or("Node.js 22.19+ is required")?;
        let mut command = hidden_command(node);
        command.arg(script);
        return Ok(command);
    }
    Ok(hidden_command(executable))
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
    version_with_timeout(executable, Duration::from_secs(15))
}

fn version_with_timeout(executable: &Path, timeout: Duration) -> Result<String, String> {
    let mut command = pi_command(executable)?;
    with_path(&mut command, executable);
    let output = run(command.arg("--version"), timeout)?;
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
    npm_prefix_with_timeout(npm, Duration::from_secs(20))
}

fn npm_prefix_with_timeout(npm: &Path, timeout: Duration) -> Result<PathBuf, String> {
    let mut command = npm_command(npm)?;
    with_path(&mut command, npm);
    let output = run(command.args(["prefix", "-g"]), timeout)?;
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
        let path = PathBuf::from(executable);
        #[cfg(target_os = "windows")]
        let path = if path.extension().is_none() && path.with_extension("cmd").is_file() {
            path.with_extension("cmd")
        } else {
            path
        };
        Some(path)
    } else {
        #[cfg(target_os = "windows")]
        let executable = if executable == "pi" {
            PI_NAME
        } else {
            executable
        };
        command_path(executable, home).or_else(|| {
            npm.as_ref()
                .and_then(|npm| npm_prefix(npm).ok())
                .map(|prefix| global_pi(&prefix))
        })
    };
    let Some(path) = resolved else {
        return json!({"installation":"missing","canInstall":npm.is_some()});
    };
    let installed = match version(&path) {
        Ok(version) => version,
        Err(error) => {
            return json!({"installation":"broken","detail":error,"executable":path,"canInstall":npm.is_some()});
        }
    };
    json!({
        "installation":"ready",
        "executable":path,
        "installedVersion":installed,
        "canInstall":npm.is_some()
    })
}

/// `inspect` plus whether npm's global prefix manages this Pi. Asking npm takes a
/// while, so only update checks and updates pay for it, not every startup.
pub fn inspect_with_npm(executable: &str, home: &Path) -> Value {
    let mut status = inspect(executable, home);
    if status["installation"] == "ready" {
        let path = status["executable"].as_str().map(PathBuf::from);
        let managed = npm_path(executable, home)
            .and_then(|npm| npm_prefix(&npm).ok())
            .zip(path)
            .is_some_and(|(prefix, path)| same_file(&path, &global_pi(&prefix)));
        status["npmManaged"] = json!(managed);
    }
    status
}

const MAX_SCAN_CANDIDATES: usize = 10;
const SCAN_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

fn add_candidate(paths: &mut Vec<PathBuf>, path: PathBuf) {
    #[cfg(target_os = "windows")]
    let path = if path.extension().is_none() && path.with_extension("cmd").is_file() {
        path.with_extension("cmd")
    } else {
        path
    };
    // A discovered path must keep working after Pi changes its working directory.
    if paths.len() >= MAX_SCAN_CANDIDATES || !path.is_absolute() || !path.is_file() {
        return;
    }
    if paths.iter().any(|existing| same_file(existing, &path)) {
        return;
    }
    paths.push(path);
}

fn probe_candidates(paths: Vec<PathBuf>, timeout: Duration) -> Value {
    let handles: Vec<_> = paths
        .into_iter()
        .map(|path| {
            thread::spawn(move || {
                version_with_timeout(&path, timeout).ok().map(
                    |installed| json!({"executable": path, "version": installed}),
                )
            })
        })
        .collect();
    let candidates: Vec<Value> = handles
        .into_iter()
        .filter_map(|handle| handle.join().ok().flatten())
        .collect();
    json!({"candidates": candidates})
}

/// List Pi executables without changing configuration. Probe at most ten paths
/// in parallel, with three seconds for npm discovery and three for each version probe.
pub fn scan(executable: &str, home: &Path) -> Value {
    let mut paths: Vec<PathBuf> = Vec::new();
    if Path::new(executable).is_absolute() {
        add_candidate(&mut paths, PathBuf::from(executable));
    } else if let Some(path) = command_path(executable, home) {
        add_candidate(&mut paths, path);
    }
    for directory in search_dirs(home) {
        add_candidate(&mut paths, directory.join(PI_NAME));
        if paths.len() >= MAX_SCAN_CANDIDATES {
            break;
        }
    }
    if paths.len() < MAX_SCAN_CANDIDATES {
        if let Some(npm) = npm_path(executable, home) {
            if let Ok(prefix) = npm_prefix_with_timeout(&npm, SCAN_PROBE_TIMEOUT) {
                add_candidate(&mut paths, global_pi(&prefix));
            }
        }
    }
    probe_candidates(paths, SCAN_PROBE_TIMEOUT)
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

/// One-click update is offered for global npm installations older than the
/// official latest release.
pub fn can_update(status: &Value, latest: &str) -> bool {
    if status["installation"] != "ready" || status["npmManaged"] != true {
        return false;
    }
    let (Some(installed), Ok(latest)) = (
        status["installedVersion"]
            .as_str()
            .and_then(|value| Version::parse(value).ok()),
        Version::parse(latest),
    ) else {
        return false;
    };
    installed < latest
}

/// Installs Pi globally with npm: `target` when the latest release is known,
/// otherwise npm's `latest` tag.
fn install_with_npm(npm: &Path, home: &Path, target: Option<&str>) -> Result<PathBuf, String> {
    let node = npm.parent().ok_or("Cannot locate npm")?.join(NODE_NAME);
    let node = if node.is_file() {
        node
    } else {
        command_path(NODE_NAME, home).ok_or("Node.js 22.19+ is required")?
    };
    let mut node_command = hidden_command(&node);
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
            &format!("{PACKAGE}@{}", target.unwrap_or("latest")),
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
    let installed = version(&path)?;
    if target.is_some_and(|target| target != installed) {
        return Err("Pi installation returned an unexpected version".into());
    }
    Ok(path)
}

pub fn install(executable: &str, home: &Path) -> Result<PathBuf, String> {
    let npm =
        npm_path(executable, home).ok_or("npm was not found; install Node.js 22.19+ first")?;
    install_with_npm(&npm, home, latest_version().ok().as_deref())
}

pub fn update(executable: &str, home: &Path, latest: &str) -> Result<PathBuf, String> {
    if !can_update(&inspect_with_npm(executable, home), latest) {
        return Err("Pi is already up to date".into());
    }
    let npm = npm_path(executable, home).ok_or("npm was not found")?;
    install_with_npm(&npm, home, Some(latest))
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
        let ready = |installed: &str, npm: bool| {
            json!({"installation":"ready","installedVersion":installed,"npmManaged":npm})
        };
        assert!(can_update(&ready("0.87.0", true), "0.88.0"));
        assert!(!can_update(&ready("0.88.0", true), "0.88.0"));
        assert!(!can_update(&ready("0.87.0", false), "0.88.0"));
        assert!(!can_update(&json!({"installation":"missing"}), "0.88.0"));
    }

    #[test]
    fn scan_candidates_dedupe_real_files() {
        let root = env::temp_dir().join(format!("pion-pi-scan-{}", std::process::id()));
        let first = root.join("a/bin");
        let second = root.join("b/bin");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let one = first.join(PI_NAME);
        let two = second.join(PI_NAME);
        fs::write(&one, b"").unwrap();
        fs::write(&two, b"").unwrap();
        let mut paths = Vec::new();
        add_candidate(&mut paths, one.clone());
        add_candidate(&mut paths, one);
        assert_eq!(paths.len(), 1);
        add_candidate(&mut paths, two);
        assert_eq!(paths.len(), 2);
        add_candidate(&mut paths, root.join("missing/pi"));
        assert_eq!(paths.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn scan_verifies_versions_in_parallel_and_keeps_selected_path() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = env::temp_dir().join(format!("pion-pi-scan-probes-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let valid = root.join("valid-pi");
        let selected = root.join("selected-pi");
        fs::write(
            &valid,
            "#!/bin/sh\n[ \"$1\" = --version ] || exit 1\necho 0.87.1\n",
        )
        .unwrap();
        fs::set_permissions(&valid, fs::Permissions::from_mode(0o755)).unwrap();
        symlink(&valid, &selected).unwrap();
        let invalid = root.join("invalid-pi");
        fs::write(&invalid, "#!/bin/sh\necho not-a-version\n").unwrap();
        fs::set_permissions(&invalid, fs::Permissions::from_mode(0o755)).unwrap();
        let mut paths = Vec::new();
        add_candidate(&mut paths, selected.clone());
        add_candidate(&mut paths, valid);
        add_candidate(&mut paths, invalid);
        for index in 0..6 {
            let slow = root.join(format!("slow-{index}"));
            fs::write(&slow, "#!/bin/sh\nexec sleep 5\n").unwrap();
            fs::set_permissions(&slow, fs::Permissions::from_mode(0o755)).unwrap();
            add_candidate(&mut paths, slow);
        }
        assert_eq!(paths.len(), 8);
        let started = Instant::now();
        let result = probe_candidates(paths, Duration::from_secs(1));
        assert!(started.elapsed() < Duration::from_secs(4));
        assert_eq!(result["candidates"].as_array().unwrap().len(), 1);
        assert_eq!(result["candidates"][0]["executable"], json!(selected));
        assert_eq!(result["candidates"][0]["version"], "0.87.1");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn command_timeout_includes_inherited_output_pipes() {
        let started = Instant::now();
        let error = run(
            Command::new("/bin/sh").args(["-c", "sleep 5 & exit 0"]),
            Duration::from_millis(150),
        )
        .err()
        .unwrap();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn scan_candidate_count_is_bounded_and_paths_are_absolute() {
        let root = env::temp_dir().join(format!("pion-pi-scan-limit-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let mut paths = Vec::new();
        add_candidate(&mut paths, PathBuf::from("Cargo.toml"));
        for index in 0..20 {
            let path = root.join(format!("pi-{index}"));
            fs::write(&path, b"").unwrap();
            add_candidate(&mut paths, path);
        }
        assert_eq!(paths.len(), MAX_SCAN_CANDIDATES);
        assert!(paths.iter().all(|path| path.is_absolute()));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn fake_npm_updates_to_the_latest_release() {
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
                "0.88.0",
                version_file.display()
            ),
        )
        .unwrap();
        for path in [&node, &npm, &pi] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        assert!(inspect(pi.to_str().unwrap(), &root)
            .get("npmManaged")
            .is_none());
        let status = inspect_with_npm(pi.to_str().unwrap(), &root);
        assert!(status["npmManaged"] == true);
        assert!(status.get("verifiedVersion").is_none());
        assert!(can_update(&status, "0.88.0"));
        assert_eq!(update(pi.to_str().unwrap(), &root, "0.88.0").unwrap(), pi);
        assert_eq!(version(&pi).unwrap(), "0.88.0");
        assert!(fs::read_to_string(&args_file)
            .unwrap()
            .contains(&format!("{PACKAGE}@0.88.0")));
        assert!(update(pi.to_str().unwrap(), &root, "0.88.0").is_err());
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
        assert!(install_with_npm(&npm, &root, None)
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
