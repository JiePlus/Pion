//! Restricted HTTP proxy for Desktop plugins. Requests are made by the trusted
//! host, never by the sandboxed worker, and only to allowlisted hosts. Redirects
//! are not followed so a response cannot leave the allowlist.
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;

const MAX_BODY: u64 = 1024 * 1024;

pub fn host_allowed(patterns: &[String], host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    patterns.iter().any(|pattern| {
        if let Some(suffix) = pattern.strip_prefix("*.") {
            host.ends_with(&format!(".{suffix}"))
        } else {
            host == *pattern
        }
    })
}

pub fn fetch(allowed: &[String], url: &str, options: &Value) -> Result<Value, String> {
    let parsed = Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if !["http", "https"].contains(&parsed.scheme()) {
        return Err("Only http or https URLs are allowed".into());
    }
    let host = parsed.host_str().ok_or("URL has no host")?;
    if !host_allowed(allowed, host) {
        return Err(format!(
            "Host is not in the plugin's network allowlist: {host}"
        ));
    }
    let raw_method = options
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    let method =
        Method::from_bytes(raw_method.as_bytes()).map_err(|_| "Invalid HTTP method".to_string())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PUT | Method::PATCH | Method::DELETE | Method::HEAD
    ) {
        return Err("HTTP method is not allowed".into());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.request(method, parsed);
    if let Some(headers) = options.get("headers") {
        let headers = headers.as_object().ok_or("Invalid request headers")?;
        if headers.len() > 32 {
            return Err("Too many request headers".into());
        }
        for (key, value) in headers {
            let value = value.as_str().ok_or("Invalid request header value")?;
            if key.is_empty()
                || key.len() > 100
                || value.len() > 4000
                || value.contains('\r')
                || value.contains('\n')
                || key.eq_ignore_ascii_case("host")
            {
                return Err("Invalid request header".into());
            }
            request = request.header(key, value);
        }
    }
    if let Some(body) = options.get("body").filter(|value| !value.is_null()) {
        let body = body.as_str().ok_or("Invalid request body")?;
        if body.len() as u64 > MAX_BODY {
            return Err("Request body exceeds size limit".into());
        }
        request = request.body(body.to_string());
    }
    let response = request.send().map_err(|e| e.to_string())?;
    let status = response.status();
    let mut headers = serde_json::Map::new();
    for (name, value) in response.headers() {
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_string(), Value::String(text.to_string()));
        }
    }
    let mut body = String::new();
    response
        .take(MAX_BODY + 1)
        .read_to_string(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 > MAX_BODY {
        return Err("Response body exceeds size limit".into());
    }
    Ok(json!({
        "status": status.as_u16(),
        "ok": status.is_success(),
        "headers": headers,
        "body": body,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_allowlist_matches_exact_and_wildcard() {
        let allowed = vec!["api.example.com".to_string(), "*.trusted.dev".to_string()];
        assert!(host_allowed(&allowed, "api.example.com"));
        assert!(host_allowed(&allowed, "API.EXAMPLE.COM"));
        assert!(host_allowed(&allowed, "a.trusted.dev"));
        assert!(host_allowed(&allowed, "a.b.trusted.dev"));
        assert!(!host_allowed(&allowed, "trusted.dev"));
        assert!(!host_allowed(&allowed, "evil.com"));
        assert!(!host_allowed(&allowed, "example.com.evil.com"));
    }

    #[test]
    fn fetch_rejects_disallowed_host_before_network() {
        let allowed = vec!["api.example.com".to_string()];
        assert!(fetch(&allowed, "https://evil.com/x", &json!({})).is_err());
        assert!(fetch(&allowed, "file:///etc/passwd", &json!({})).is_err());
        assert!(fetch(
            &allowed,
            "https://api.example.com/x",
            &json!({"method": "TRACE"})
        )
        .is_err());
    }
}
