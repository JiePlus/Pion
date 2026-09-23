use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAX_IMAGES: usize = 5;
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 25 * 1024 * 1024;
static IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingImage {
    name: String,
    mime_type: String,
    data: String,
}

fn detected_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn image(name: &str, claimed_mime: Option<&str>, bytes: Vec<u8>) -> Result<Value, String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Each image must be 10 MB or smaller".into());
    }
    let mime = detected_mime(&bytes).ok_or("Unsupported or invalid image")?;
    if claimed_mime.is_some_and(|claimed| claimed != mime) {
        return Err("Image MIME type does not match its content".into());
    }
    let name: String = name.chars().take(200).collect();
    Ok(json!({
        "id": format!("image-{}-{}-{}", std::process::id(), random_suffix(&bytes), IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed)),
        "name": if name.is_empty() { "image" } else { &name },
        "mimeType": mime,
        "size": bytes.len(),
        "data": STANDARD.encode(bytes)
    }))
}

fn random_suffix(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate_batch(values: Vec<Value>) -> Result<Value, String> {
    if values.len() > MAX_IMAGES {
        return Err("Maximum 5 images".into());
    }
    let total = values
        .iter()
        .filter_map(|value| value["size"].as_u64())
        .sum::<u64>();
    if total > MAX_TOTAL_BYTES as u64 {
        return Err("Images must be 25 MB or smaller in total".into());
    }
    Ok(json!({"images":values}))
}

pub fn import(values: &Value) -> Result<Value, String> {
    let incoming: Vec<IncomingImage> =
        serde_json::from_value(values.clone()).map_err(|_| "Invalid image payload")?;
    if incoming.len() > MAX_IMAGES {
        return Err("Maximum 5 images".into());
    }
    let mut result = Vec::with_capacity(incoming.len());
    for item in incoming {
        if item.data.len() > (MAX_IMAGE_BYTES * 4 / 3) + 16 {
            return Err("Each image must be 10 MB or smaller".into());
        }
        let bytes = STANDARD
            .decode(item.data)
            .map_err(|_| "Invalid base64 image data")?;
        result.push(image(&item.name, Some(&item.mime_type), bytes)?);
    }
    validate_batch(result)
}

pub fn read(paths: &[&Path]) -> Result<Value, String> {
    if paths.len() > MAX_IMAGES {
        return Err("Maximum 5 images".into());
    }
    let mut expected_total = 0u64;
    for path in paths {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        if size > MAX_IMAGE_BYTES as u64 {
            return Err("Each image must be 10 MB or smaller".into());
        }
        expected_total += size;
    }
    if expected_total > MAX_TOTAL_BYTES as u64 {
        return Err("Images must be 25 MB or smaller in total".into());
    }
    let mut result = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image");
        result.push(image(name, None, bytes)?);
    }
    validate_batch(result)
}

pub fn pi_content(values: &Value) -> Result<Value, String> {
    let images = values.as_array().ok_or("Invalid images")?;
    if images.len() > MAX_IMAGES {
        return Err("Maximum 5 images".into());
    }
    let mut total = 0usize;
    let mut result = Vec::with_capacity(images.len());
    for value in images {
        let incoming: IncomingImage =
            serde_json::from_value(value.clone()).map_err(|_| "Invalid image")?;
        let bytes = STANDARD
            .decode(&incoming.data)
            .map_err(|_| "Invalid base64 image data")?;
        let validated = image(&incoming.name, Some(&incoming.mime_type), bytes)?;
        total += validated["size"].as_u64().unwrap_or(0) as usize;
        result.push(json!({
            "type":"image",
            "data":validated["data"],
            "mimeType":validated["mimeType"]
        }));
    }
    if total > MAX_TOTAL_BYTES {
        return Err("Images must be 25 MB or smaller in total".into());
    }
    Ok(Value::Array(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_image_mime_count_and_sizes() {
        let png = b"\x89PNG\r\n\x1a\nrest";
        assert!(image("a.png", Some("image/png"), png.to_vec()).is_ok());
        assert!(image("a.svg", Some("image/svg+xml"), b"<svg/>".to_vec()).is_err());
        assert!(image("a.png", Some("image/jpeg"), png.to_vec()).is_err());
        assert!(image("huge.png", None, vec![0; MAX_IMAGE_BYTES + 1]).is_err());
        let too_many = (0..=MAX_IMAGES).map(|_| json!({"size":1})).collect();
        assert!(validate_batch(too_many).is_err());
        let too_large = vec![json!({"size":MAX_TOTAL_BYTES as u64 + 1})];
        assert!(validate_batch(too_large).is_err());
        let path = std::env::temp_dir().join(format!(
            "pion-oversize-{}-{}",
            std::process::id(),
            IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_IMAGE_BYTES as u64 + 1).unwrap();
        assert!(read(&[&path]).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
