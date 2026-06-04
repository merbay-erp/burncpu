//! Background video transcode worker.
//!
//! Uploaded videos are stored verbatim and marked `pending` (see
//! `routes::media`). This worker normalises each one to a universally-playable
//! H.264/AAC MP4 (`+faststart` so it streams before fully downloaded), extracts
//! a poster frame, records the probed duration, and flips the row to `ready` —
//! or `failed` with a reason. The original upload is removed once `ready`, since
//! the transcoded file is what we serve from then on.
//!
//! Concurrency mirrors `routes::webhooks::spawn_dispatcher`: a bounded mpsc
//! channel feeds a worker loop that acquires a semaphore permit BEFORE spawning,
//! so at most `MAX_CONCURRENT` ffmpeg processes run at once and the channel
//! bounds the backlog. The DB column `processing_state` is the source of truth —
//! the in-memory queue is just a wake-up signal, so `requeue_pending` can rebuild
//! it on boot after a restart.

use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

/// A unit of work: normalise the video stored at `src_filename` for `media_id`.
#[derive(Debug, Clone)]
pub struct TranscodeJob {
    pub media_id: Uuid,
    pub src_filename: String,
}

const QUEUE_CAP: usize = 256;
/// Transcoding is CPU + memory heavy; keep it serialized so it can't starve the
/// web server on a small VPS. The bounded channel absorbs bursts.
const MAX_CONCURRENT: usize = 1;

/// Fit inside this box, preserving aspect ratio (even dimensions for yuv420p).
const MAX_W: u32 = 1280;
const MAX_H: u32 = 720;

/// Start the worker and return the queue sender to hold in `AppState`.
pub fn spawn_transcoder(
    pg: PgPool,
    media_dir: String,
    max_duration_secs: i64,
) -> mpsc::Sender<TranscodeJob> {
    let (tx, mut rx) = mpsc::channel::<TranscodeJob>(QUEUE_CAP);
    tokio::spawn(async move {
        let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT));
        while let Some(job) = rx.recv().await {
            let Ok(permit) = sem.clone().acquire_owned().await else {
                break; // semaphore closed → shutting down
            };
            let pg = pg.clone();
            let media_dir = media_dir.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(reason) = process(&pg, &media_dir, max_duration_secs, &job).await {
                    tracing::warn!(media_id = %job.media_id, %reason, "transcode failed");
                    mark_failed(&pg, job.media_id, &reason).await;
                }
            });
        }
    });
    tx
}

/// On boot, rebuild the in-memory queue from the DB: anything left `processing`
/// (a crash mid-run) is reset to `pending`, then every `pending` video is
/// re-enqueued. Best-effort — rows that don't fit the channel stay `pending` and
/// are picked up next boot.
pub async fn requeue_pending(pg: &PgPool, tx: &mpsc::Sender<TranscodeJob>) {
    let _ = sqlx::query(
        "UPDATE media SET processing_state = 'pending' WHERE processing_state = 'processing' AND kind = 'video'",
    )
    .execute(pg)
    .await;

    let pending: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, filename FROM media WHERE processing_state = 'pending' AND kind = 'video' ORDER BY created_at",
    )
    .fetch_all(pg)
    .await
    .unwrap_or_default();

    let n = pending.len();
    for (media_id, src_filename) in pending {
        if tx.try_send(TranscodeJob { media_id, src_filename }).is_err() {
            break; // channel full — leave the rest pending for the next boot
        }
    }
    if n > 0 {
        tracing::info!(count = n, "requeued pending video transcodes");
    }
}

/// Probe → transcode → poster → mark ready. Returns `Err(reason)` on any failure
/// (the caller records it as `processing_state = 'failed'`).
async fn process(
    pg: &PgPool,
    media_dir: &str,
    max_duration_secs: i64,
    job: &TranscodeJob,
) -> Result<(), String> {
    let dir = PathBuf::from(media_dir);
    let src = dir.join(&job.src_filename);
    if !src.exists() {
        return Err("source file missing".into());
    }

    // Mark in-flight so the admin/client sees progress and a crash is recoverable.
    let _ = sqlx::query("UPDATE media SET processing_state = 'processing' WHERE id = $1")
        .bind(job.media_id)
        .execute(pg)
        .await;

    // Derive sibling filenames from the content-addressed stem (collision-free).
    let stem = job
        .src_filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(&job.src_filename);
    let out_name = format!("{stem}.h264.mp4");
    let poster_name = format!("{stem}.poster.jpg");
    let out_path = dir.join(&out_name);
    let poster_path = dir.join(&poster_name);

    // Generous per-job ceiling: transcoding runs roughly real-time, so allow a
    // few× the max accepted duration before treating a run as hung.
    let timeout = Duration::from_secs((max_duration_secs as u64 * 3).max(120));

    // 1) Probe duration + confirm there is a decodable video stream.
    let probe = run(
        "ffprobe",
        &[
            "-v", "error",
            "-show_entries", "format=duration:stream=codec_type",
            "-of", "json",
            path_str(&src)?,
        ],
        timeout,
    )
    .await?;
    if !probe.status.success() {
        return Err("ffprobe failed (not a decodable video?)".into());
    }
    let meta: Probe = serde_json::from_slice(&probe.stdout)
        .map_err(|e| format!("probe parse: {e}"))?;
    if !meta.has_video() {
        return Err("no video stream".into());
    }
    let duration_secs = meta.duration_secs();
    if let Some(d) = duration_secs
        && d > max_duration_secs as f64 + 1.0
    {
        return Err(format!("too long: {d:.0}s > {max_duration_secs}s cap"));
    }
    let duration_ms = duration_secs.map(|d| (d * 1000.0) as i32);

    // 2) Transcode to H.264/AAC MP4, fit within MAX_W×MAX_H, faststart for
    //    progressive streaming. Write to a .tmp then rename so a crash never
    //    leaves a half-written file at the served path.
    let tmp_out = dir.join(format!("{out_name}.tmp"));
    let scale = format!(
        "scale=w={MAX_W}:h={MAX_H}:force_original_aspect_ratio=decrease:force_divisible_by=2"
    );
    let xcode = run(
        "ffmpeg",
        &[
            "-y", "-nostdin",
            "-i", path_str(&src)?,
            "-vf", &scale,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-max_muxing_queue_size", "1024",
            path_str(&tmp_out)?,
        ],
        timeout,
    )
    .await?;
    if !xcode.status.success() {
        let _ = tokio::fs::remove_file(&tmp_out).await;
        return Err(format!("ffmpeg transcode failed: {}", tail_stderr(&xcode)));
    }
    tokio::fs::rename(&tmp_out, &out_path)
        .await
        .map_err(|e| format!("rename output: {e}"))?;

    // 3) Poster frame from the normalised output (guaranteed decodable). Best
    //    effort — a missing poster doesn't fail the job, the client just shows a
    //    neutral placeholder behind the play button.
    let tmp_poster = dir.join(format!("{poster_name}.tmp"));
    let poster_ok = match run(
        "ffmpeg",
        &[
            "-y", "-nostdin",
            "-ss", "0.5",
            "-i", path_str(&out_path)?,
            "-frames:v", "1", "-an",
            "-q:v", "3",
            path_str(&tmp_poster)?,
        ],
        Duration::from_secs(60),
    )
    .await
    {
        Ok(o) if o.status.success() => tokio::fs::rename(&tmp_poster, &poster_path).await.is_ok(),
        _ => {
            let _ = tokio::fs::remove_file(&tmp_poster).await;
            false
        }
    };

    // 4) Flip to ready. From here the transcoded file is what we serve, so the
    //    original upload is no longer needed.
    sqlx::query(
        r#"
        UPDATE media
        SET processing_state = 'ready',
            transcoded_filename = $2,
            poster_filename = $3,
            duration_ms = $4,
            mime_type = 'video/mp4',
            error = NULL
        WHERE id = $1
        "#,
    )
    .bind(job.media_id)
    .bind(&out_name)
    .bind(if poster_ok { Some(&poster_name) } else { None })
    .bind(duration_ms)
    .execute(pg)
    .await
    .map_err(|e| format!("db update: {e}"))?;

    // Keep the original upload: existing DM rows still reference it by URL and
    // clients predating this pipeline play it directly. The transcoded file is a
    // progressive enhancement resolved at render time; orphan/failed raws are
    // swept by `cleanup`, not deleted here (safe for un-updated mobile apps).
    tracing::info!(media_id = %job.media_id, out = %out_name, "transcode ready");
    Ok(())
}

async fn mark_failed(pg: &PgPool, media_id: Uuid, reason: &str) {
    // Truncate so a giant ffmpeg dump can't bloat the row.
    let reason: String = reason.chars().take(500).collect();
    let _ = sqlx::query("UPDATE media SET processing_state = 'failed', error = $2 WHERE id = $1")
        .bind(media_id)
        .bind(reason)
        .execute(pg)
        .await;
}

/// Run a command with a hard timeout, capturing output. `Err` on spawn failure
/// (e.g. ffmpeg not installed) or timeout.
async fn run(bin: &str, args: &[&str], timeout: Duration) -> Result<Output, String> {
    let fut = tokio::process::Command::new(bin)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output();
    match tokio::time::timeout(timeout, fut).await {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(format!("{bin} spawn failed: {e} (is it installed?)")),
        Err(_) => Err(format!("{bin} timed out after {}s", timeout.as_secs())),
    }
}

fn path_str(p: &Path) -> Result<&str, String> {
    p.to_str().ok_or_else(|| "non-utf8 path".to_string())
}

/// Last few lines of stderr, joined — enough to diagnose a transcode failure.
fn tail_stderr(out: &Output) -> String {
    let s = String::from_utf8_lossy(&out.stderr);
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(3);
    lines[start..].join(" | ").chars().take(300).collect()
}

#[derive(serde::Deserialize)]
struct Probe {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    format: ProbeFormat,
}
#[derive(serde::Deserialize)]
struct ProbeStream {
    #[serde(default)]
    codec_type: String,
}
#[derive(serde::Deserialize, Default)]
struct ProbeFormat {
    duration: Option<String>,
}
impl Probe {
    fn has_video(&self) -> bool {
        self.streams.iter().any(|s| s.codec_type == "video")
    }
    fn duration_secs(&self) -> Option<f64> {
        self.format.duration.as_ref().and_then(|d| d.parse().ok())
    }
}
