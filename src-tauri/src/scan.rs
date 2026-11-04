//! Auto-detect local OpenAI-compatible model services on well-known loopback
//! ports. The model-services page and the "add custom endpoint" dialog use this
//! to prefill a provider the user can still correct by hand.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

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
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let url = format!("{}/models", candidate.base_url.trim_end_matches('/'));
    let started = Instant::now();
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .ok()?;
    let latency_ms = started.elapsed().as_millis() as u64;
    if !response.status().is_success() {
        return None;
    }
    let body = response.text().ok()?;
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

/// Read model identifiers from either the OpenAI (`data[].id`) or the Ollama
/// (`models[].name`) response shape, bounded so a pathological reply stays small.
pub fn model_ids(body: &str) -> Vec<String> {
    const MAX: usize = 50;
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let array = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array));
    let Some(array) = array else {
        return Vec::new();
    };
    let mut ids: Vec<String> = Vec::new();
    for item in array {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.get("name").and_then(Value::as_str));
        let Some(id) = id else { continue };
        let id = id.trim().trim_start_matches("models/").trim();
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
            vec!["gpt-4o", "qwen"]
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
