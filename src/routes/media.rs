// /api/v1/media — image upload.
//
//   POST /media   multipart/form-data field "file"  → 201 { id, url, width, height, mime_type }
//   GET  /media   ?limit=                            → list of viewer's uploads
//   DELETE /media/{id}                               → 204 (owner only)
//
// Pipeline:
//   1. Read bytes (cap 5 MiB).
//   2. Sniff mime via `infer` — accept image/{jpeg,png,webp,gif} only.
//   3. Decode with `image` crate (rejects malformed / disguised payloads),
//      then re-encode to the original format. The re-encode strips EXIF
//      and Adobe XMP metadata, eliminating one privacy footgun and one
//      common XSS vector (SVG/PDF-in-JPEG tricks).
//   4. Content-addressed filename: first 16 hex chars of sha256(re-encoded
//      bytes) + ext. Same image uploaded twice = one file on disk.
//   5. DB row in `media` per owner (UNIQUE on owner_id+sha256 so duplicates
//      by the same user surface the existing id).
//
// Storage: files live in `state.config.media_dir` (default /data/media),
// served by nginx directly at /media/<filename>.

use crate::{
    errors::AppError,
    middleware::session::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use image::ImageFormat;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::types::chrono::{DateTime, Utc};
use std::io::Cursor;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(upload).get(list_mine))
        .route("/{id}", delete(delete_mine))
}

const MAX_BYTES: usize = 5 * 1024 * 1024;
const ALLOWED: &[(&str, ImageFormat, &str)] = &[
    ("image/jpeg", ImageFormat::Jpeg, "jpg"),
    ("image/png", ImageFormat::Png, "png"),
    ("image/webp", ImageFormat::WebP, "webp"),
    ("image/gif", ImageFormat::Gif, "gif"),
];

#[derive(Serialize)]
pub struct MediaResponse {
    id: Uuid,
    url: String,
    width: Option<i32>,
    height: Option<i32>,
    mime_type: String,
    size_bytes: i64,
}

async fn upload(
    State(state): State<AppState>,
    user: CurrentUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<MediaResponse>), AppError> {
    // Pull the first field named "file"
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("multipart: {e}")))? {
        if field.name() == Some("file") {
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("read field: {e}")))?;
            if data.len() > MAX_BYTES {
                return Err(AppError::BadRequest(format!(
                    "file too large (max {} bytes)",
                    MAX_BYTES
                )));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let raw = bytes.ok_or_else(|| AppError::BadRequest("missing 'file' field".into()))?;
    if raw.is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }

    // Sniff MIME from the bytes (not from the client's claim)
    let kind = infer::get(&raw).ok_or_else(|| AppError::BadRequest("unrecognized format".into()))?;
    let mime = kind.mime_type();
    let (mime_str, fmt, ext) = ALLOWED
        .iter()
        .find(|(m, _, _)| *m == mime)
        .ok_or_else(|| AppError::BadRequest(format!("unsupported type: {mime}")))?;

    // Decode + re-encode → drops metadata (EXIF / XMP) and rejects fake/bombed payloads.
    let img = image::load_from_memory(&raw)
        .map_err(|e| AppError::BadRequest(format!("decode: {e}")))?;
    let width = img.width() as i32;
    let height = img.height() as i32;

    let mut out = Cursor::new(Vec::with_capacity(raw.len()));
    img.write_to(&mut out, *fmt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("re-encode: {e}")))?;
    let re_encoded = out.into_inner();
    let size_bytes = re_encoded.len() as i64;

    // Content-addressed filename
    let mut h = Sha256::new();
    h.update(&re_encoded);
    let digest = h.finalize();
    let digest_vec = digest.to_vec();
    let hex_short: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let filename = format!("{hex_short}.{ext}");

    // Write to disk (atomic via .tmp + rename)
    let dir = std::path::PathBuf::from(&state.config.media_dir);
    tokio::fs::create_dir_all(&dir).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("media dir: {e}")))?;
    let final_path = dir.join(&filename);
    let tmp_path = dir.join(format!("{filename}.tmp"));
    tokio::fs::write(&tmp_path, &re_encoded).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write: {e}")))?;
    tokio::fs::rename(&tmp_path, &final_path).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("rename: {e}")))?;

    // INSERT (idempotent per owner via UNIQUE owner_id + sha256)
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO media (owner_id, sha256, kind, mime_type, width, height, size_bytes, filename)
        VALUES ($1, $2, 'image', $3, $4, $5, $6, $7)
        ON CONFLICT (owner_id, sha256) DO UPDATE SET created_at = media.created_at
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(&digest_vec)
    .bind(mime_str)
    .bind(width)
    .bind(height)
    .bind(size_bytes)
    .bind(&filename)
    .fetch_one(&state.pg)
    .await?;

    let url = format!("/media/{filename}");
    tracing::info!(user_id = %user.user_id, %url, w=width, h=height, "media uploaded");

    Ok((
        StatusCode::CREATED,
        Json(MediaResponse {
            id: row.0,
            url,
            width: Some(width),
            height: Some(height),
            mime_type: mime_str.to_string(),
            size_bytes,
        }),
    ))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MediaRow {
    id: Uuid,
    url: String,
    mime_type: String,
    width: Option<i32>,
    height: Option<i32>,
    size_bytes: i64,
    created_at: DateTime<Utc>,
}

async fn list_mine(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<MediaRow>>, AppError> {
    let rows: Vec<MediaRow> = sqlx::query_as(
        r#"
        SELECT id, '/media/' || filename AS url, mime_type, width, height, size_bytes, created_at
        FROM media
        WHERE owner_id = $1
        ORDER BY created_at DESC
        LIMIT 200
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

async fn delete_mine(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // Look up filename + verify ownership
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT filename FROM media WHERE id = $1 AND owner_id = $2",
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let (filename,) = row.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM media WHERE id = $1")
        .bind(id)
        .execute(&state.pg)
        .await?;

    // Only unlink the file if no other media row still references it.
    let still_referenced: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM media WHERE filename = $1)",
    )
    .bind(&filename)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false);
    if !still_referenced {
        let path = std::path::PathBuf::from(&state.config.media_dir).join(&filename);
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(StatusCode::NO_CONTENT)
}
