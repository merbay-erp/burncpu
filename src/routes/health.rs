// GET /healthz — liveness + readiness probe.
// Pings Postgres + Redis; non-200 means something is wrong upstream.

use crate::{errors::AppError, state::AppState};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

pub async fn handler(State(state): State<AppState>) -> Result<Response, AppError> {
    // ── Postgres ping
    let pg_ok: bool = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pg)
        .await
        .map(|n| n == 1)
        .unwrap_or(false);

    // ── Redis ping
    let mut redis_conn = state.redis.clone();
    let redis_ok: bool = redis::cmd("PING")
        .query_async::<String>(&mut redis_conn)
        .await
        .map(|r| r == "PONG")
        .unwrap_or(false);

    let ok = pg_ok && redis_ok;
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body: Value = json!({
        "ok": ok,
        "service": "burncpu",
        "version": env!("CARGO_PKG_VERSION"),
        "checks": {
            "postgres": pg_ok,
            "redis": redis_ok,
        },
        "ts": chrono::Utc::now().to_rfc3339(),
    });
    Ok((status, Json(body)).into_response())
}
