//! Auto-detect local OpenAI-compatible model services on well-known loopback
//! ports. The model-services page and the "add custom endpoint" dialog use this
//! to prefill a provider the user can still correct by hand.
use serde_json::{json, Value};
use std::io::Read;
use std::time::{Duration, Instant};

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy)]
struct Candidate {
    name: &'static str,
    label: &'static str,
    base_url: &'static str,
    api: &'static str,
}

/// Common local engines and their default OpenAI-compatible base URLs. Keep in
/// sync with the presets shown in the UI.
const CANDIDATES: &[Candidate] = &[
    Candidate {
        name: "ollama-local",
        label: "Ollama",
        base_url: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
    },
    Candidate {
        name: "lmstudio-local",
        label: "LM Studio",
        base_url: "http://127.0.0.1:1234/v1",
        api: "openai-completions",
    },
    Candidate {
        name: "vllm-local",
        label: "vLLM",
        base_url: "http://127.0.0.1:8000/v1",
        api: "openai-completions",
    },
    Candidate {
        name: "localai-local",
        label: "LocalAI",
        base_url: "http://127.0.0.1:8080/v1",
        api: "openai-completions",
    },
    Candidate {
        name: "one-api-local",
        label: "One-API",
        base_url: "http://127.0.0.1:3000/v1",
        api: "openai-completions",
    },
    Candidate {
        name: "jan-local",
        label: "Jan",
        base_url: "http://127.0.0.1:1337/v1",
        api: "openai-completions",
    },
];

/// Probe every candidate in parallel and return the reachable services. Each
/// probe only asks the local `/models` endpoint, so no prompt or credential is
/// ever sent.
pub fn scan(timeout_ms: u64) -> Value {
    let handles: Vec<_> = CANDIDATES
        .iter()
        .copied()
        .map(|candidate| std::thread::spawn(move || probe(candidate, timeout_ms)))
        .collect();
    let mut services: Vec<Value> = handles
        .into_iter()
        .filter_map(|handle| handle.join().ok().flatten())
        .collect();
    services.sort_by(|left, right| left["label"].as_str().cmp(&right["label"].as_str()));
    json!({ "services": services })
}

fn probe(candidate: Candidate, timeout_ms: u64) -> Option<Value> {
    let url = format!("{}/models", candidate.base_url.trim_end_matches('/'));
    probe_url(candidate, &url, timeout_ms)
}

fn probe_url(candidate: Candidate, url: &str, timeout_ms: u64) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let started = Instant::now();
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE_BYTES)
    {
        return None;
    }
    let mut body = String::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_string(&mut body)
        .ok()?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return None;
    }
    let value: Value = serde_json::from_str(&body).ok()?;
    // A generic HTTP 200 (for example a web UI on port 3000) is not a model API.
    model_array(&value)?;
    let latency_ms = started.elapsed().as_millis() as u64;
    let models = model_ids(&body);
    Some(json!({
        "name": candidate.name,
        "label": candidate.label,
        "baseUrl": candidate.base_url,
        "api": candidate.api,
        "latencyMs": latency_ms,
        "models": models,
        "modelCount": models.len(),
    }))
}

fn model_array(value: &Value) -> Option<&Vec<Value>> {
    value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
}

/// Read model identifiers from either the OpenAI (`data[].id`) or the Ollama
/// (`models[].name`) response shape, bounded so a pathological reply stays small.
pub fn model_ids(body: &str) -> Vec<String> {
    const MAX: usize = 50;
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let Some(array) = model_array(&value) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = Vec::new();
    for item in array {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.get("name").and_then(Value::as_str));
        let Some(id) = id else { continue };
        let id = id.trim();
        if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
            continue;
        }
        if !ids.iter().any(|existing| existing == id) {
            ids.push(id.to_string());
            if ids.len() >= MAX {
                break;
            }
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_response(response: Vec<u8>, delay: Duration, timeout_ms: u64) -> Option<Value> {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 4096];
            let size = socket.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /v1/models "));
            std::thread::sleep(delay);
            // The bounded client can close the connection before a large reply finishes.
            let _ = socket.write_all(&response);
        });
        let result = probe_url(
            CANDIDATES[0],
            &format!("http://{address}/v1/models"),
            timeout_ms,
        );
        server.join().unwrap();
        result
    }

    fn http_response(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    #[test]
    fn probes_require_a_model_list_and_accept_empty_engines() {
        let result = probe_response(
            http_response(r#"{"data":[{"id":"qwen"}]}"#),
            Duration::ZERO,
            800,
        )
        .unwrap();
        assert_eq!(result["models"], json!(["qwen"]));
        assert_eq!(result["modelCount"], 1);
        let empty = probe_response(http_response(r#"{"data":[]}"#), Duration::ZERO, 800).unwrap();
        assert_eq!(empty["modelCount"], 0);
        for body in [
            "<html>local web UI</html>",
            r#"{"status":"ok"}"#,
            r#"{"data":{}}"#,
        ] {
            assert!(probe_response(http_response(body), Duration::ZERO, 800).is_none());
        }
    }

    #[test]
    fn probes_reject_redirects_and_oversized_responses() {
        let redirect = b"HTTP/1.1 302 Found\r\nLocation: http://example.invalid/models\r\nContent-Length: 0\r\n\r\n".to_vec();
        assert!(probe_response(redirect, Duration::ZERO, 800).is_none());
        let large = "x".repeat(MAX_RESPONSE_BYTES as usize + 1);
        assert!(probe_response(http_response(&large), Duration::ZERO, 800).is_none());
        // Also enforce the bound when the server omits Content-Length.
        let response = format!("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{large}").into_bytes();
        assert!(probe_response(response, Duration::ZERO, 800).is_none());
    }

    #[test]
    fn probes_time_out_on_unresponsive_services() {
        assert!(probe_response(
            http_response(r#"{"data":[]}"#),
            Duration::from_millis(250),
            50,
        )
        .is_none());
    }

    #[test]
    fn candidates_are_loopback_openai_endpoints() {
        for candidate in CANDIDATES {
            assert!(!candidate.name.is_empty());
            assert!(candidate.base_url.starts_with("http://127.0.0.1:"));
            assert!(candidate.base_url.ends_with("/v1"));
            assert_eq!(candidate.api, "openai-completions");
        }
    }

    #[test]
    fn model_ids_read_openai_and_ollama_shapes() {
        assert_eq!(
            model_ids(r#"{"data":[{"id":"gpt-4o"},{"id":"models/qwen"}]}"#),
            vec!["gpt-4o", "models/qwen"]
        );
        assert_eq!(
            model_ids(r#"{"models":[{"name":"llama3"},{"name":"llama3"}]}"#),
            vec!["llama3"]
        );
        assert!(model_ids("not json").is_empty());
        assert!(model_ids(r#"{"data":[]}"#).is_empty());
    }

    #[test]
    fn model_ids_are_bounded() {
        let items: Vec<String> = (0..80)
            .map(|index| format!(r#"{{"id":"m{index}"}}"#))
            .collect();
        let body = format!(r#"{{"data":[{}]}}"#, items.join(","));
        assert_eq!(model_ids(&body).len(), 50);
    }
}
