//! Same-origin, downscaled, re-encoded cache for link-preview cover images.
//!
//! The mobile LCP on the public timeline is the first card's cover image. When a
//! post links out (e.g. a blog), that cover is fetched **cross-origin** as a full
//! ~1200px PNG — a fresh DNS+TLS handshake plus a large transfer that, on a poor
//! connection, dominates the LCP. We instead fetch it **once** (through the same
//! SSRF-guarded path as the unfurl itself), downscale it to the card's display
//! width, re-encode it as JPEG, and store it under `media_dir/c/` so the browser
//! loads a small image from **our own origin** (warm connection + CDN-cacheable).
//!
//! Best-effort by design: any failure (fetch, oversize, decode, encode, write)
//! returns `None` and the caller keeps the original URL — a cover never breaks.
//!
//! Storage note: files live in the `c/` subdirectory specifically because the
//! orphan-media sweep (`cleanup::sweep_orphan_media`) only walks top-level files,
//! so it never deletes a cover out from under a still-cached preview.

use crate::{net_safety, state::AppState};
use futures_util::StreamExt;
use image::{ImageReader, Limits};
use reqwest::header::CONTENT_TYPE;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (compatible; burncpubot/1.0; +https://burncpu.com)";
const FETCH_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_BYTES: usize = 10 * 1024 * 1024; // 10 MiB source cap — refuse anything larger
const MAX_SRC_DIMENSION: u32 = 8192; // reject decode bombs before they allocate
const CARD_WIDTH: u32 = 800; // downscale target — a retina-DPR mobile timeline card
const JPEG_QUALITY: u8 = 82;

/// Fetch an external cover image and return a same-origin `/media/c/…jpg` URL for
/// an optimized copy, or `None` to signal "keep using the original URL".
pub async fn optimize(state: &AppState, image_url: &str) -> Option<String> {
    // Content-addressed by the *source URL* so repeated resolves dedupe to one
    // file and we can short-circuit before any network call once it's cached.
    let mut h = Sha256::new();
    h.update(image_url.as_bytes());
    let hex: String = h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect();
    let filename = format!("{hex}.jpg");
    let dir = std::path::PathBuf::from(&state.config.media_dir).join("c");
    let final_path = dir.join(&filename);
    let url_path = format!("/media/c/{filename}");

    if tokio::fs::try_exists(&final_path).await.unwrap_or(false) {
        return Some(url_path);
    }

    // Fetch through the SSRF-guarded client (scheme allowlist, private-IP block,
    // IP pinning). Redirects are disabled there; a redirecting cover just falls
    // back to the original URL, which is fine.
    let (client, url) = net_safety::safe_client_for(image_url, UA, FETCH_TIMEOUT).await.ok()?;
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // Only bother with things that claim to be images (cheap early filter).
    if let Some(ct) = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        if !ct.to_ascii_lowercase().starts_with("image/") {
            return None;
        }
    }
    let raw = read_capped(resp, MAX_BYTES).await?;

    // Decode + downscale + re-encode is CPU-bound → keep it off the async workers.
    let jpeg = tokio::task::spawn_blocking(move || transcode_to_jpeg(&raw)).await.ok()??;

    // Atomic write (.tmp + rename). The pid-suffixed tmp name avoids clobbering a
    // concurrent writer for the same cover.
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let tmp_path = dir.join(format!("{filename}.{}.tmp", std::process::id()));
    tokio::fs::write(&tmp_path, &jpeg).await.ok()?;
    if tokio::fs::rename(&tmp_path, &final_path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return None;
    }
    tracing::debug!(src = %image_url, bytes = jpeg.len(), "cached optimized cover");
    Some(url_path)
}

/// Decode (bounded), downscale to `CARD_WIDTH`, and re-encode as baseline JPEG.
/// Pure-CPU; runs inside `spawn_blocking`. Returns `None` on any decode/encode error.
fn transcode_to_jpeg(raw: &[u8]) -> Option<Vec<u8>> {
    let mut reader = ImageReader::new(Cursor::new(raw)).with_guessed_format().ok()?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SRC_DIMENSION);
    limits.max_image_height = Some(MAX_SRC_DIMENSION);
    // Permit decoding a full MAX_SRC_DIMENSION² image (we downscale immediately).
    limits.max_alloc = Some((MAX_SRC_DIMENSION as u64) * (MAX_SRC_DIMENSION as u64) * 4);
    reader.limits(limits);

    let img = reader.decode().ok()?;
    // Fit inside CARD_WIDTH×CARD_WIDTH, preserving aspect — the resize itself is
    // the biggest byte saving (a 1200px cover carries ~2× the pixels we display).
    let img = if img.width() > CARD_WIDTH || img.height() > CARD_WIDTH {
        img.resize(CARD_WIDTH, CARD_WIDTH, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    // JPEG has no alpha; OG covers are opaque, so flatten to RGB.
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut out: Vec<u8> = Vec::with_capacity(32 * 1024);
    {
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
        enc.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8).ok()?;
    }
    Some(out)
}

/// Read a response body, refusing to buffer more than `cap` bytes.
async fn read_capped(resp: reqwest::Response, cap: usize) -> Option<Vec<u8>> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if buf.len() + chunk.len() > cap {
            return None; // oversized → bail, caller keeps the original URL
        }
        buf.extend_from_slice(&chunk);
    }
    Some(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcode_downscales_and_reencodes_jpeg() {
        // A 1600×900 source → expect a JPEG capped at CARD_WIDTH, smaller on disk.
        let src = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            1600,
            900,
            image::Rgb([180, 40, 40]),
        ));
        let mut png = Cursor::new(Vec::new());
        src.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let png = png.into_inner();

        let out = transcode_to_jpeg(&png).expect("transcode should succeed");
        // JPEG SOI magic.
        assert_eq!(&out[..2], &[0xFF, 0xD8], "output must be JPEG");
        // Downscaled to the card width, aspect preserved.
        let decoded = image::load_from_memory(&out).unwrap();
        assert!(decoded.width() <= CARD_WIDTH, "width {} > cap", decoded.width());
        assert_eq!(decoded.width(), CARD_WIDTH); // 1600→800
    }

    #[test]
    fn transcode_rejects_garbage() {
        assert!(transcode_to_jpeg(b"not an image at all").is_none());
    }
}
