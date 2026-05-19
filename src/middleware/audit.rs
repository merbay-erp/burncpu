// Audit middleware — every request gets a UUID, logged with method/path/
// status/latency/IP/UA. Critical for forensics + abuse tracing.
//
// Storage: short retention in the `audit_log` table (created in 0002).
// High-traffic apps would push this to ClickHouse / Loki; for burncpu's
// expected volume (single-digit RPS Hafta 1-4) Postgres is fine.

use crate::{
    middleware::{client_ip, session::CurrentUser},
    state::AppState,
};
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;
use std::time::Instant;
use uuid::Uuid;

/// Tower middleware: wrap every request, attach request_id header, write
/// audit row asynchronously.
pub async fn layer(State(state): State<AppState>, req: Request<Body>, next: Next) -> Response {
    let started = Instant::now();
    let request_id = Uuid::new_v4();

    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let ua = req
        .headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect::<String>();
    let peer = req
        .extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0);
    let ip = client_ip::extract(req.headers(), peer.as_ref())
        .map(|ip| ip.to_string())
        .unwrap_or_default();
    let user_id = req.extensions().get::<CurrentUser>().map(|u| u.user_id);

    // Run inner handler
    let mut response = next.run(req).await;
    let status = response.status();
    let latency_ms = started.elapsed().as_millis() as i32;

    // Insert request_id header into response (for client-side error reports)
    if let Ok(val) = axum::http::HeaderValue::from_str(&request_id.to_string()) {
        response.headers_mut().insert("x-request-id", val);
    }

    // Async write — don't block the response on DB
    let pg = state.pg.clone();
    let path_clone = path.clone();
    let method_str = method.to_string();
    tokio::spawn(async move {
        // Skip very-noisy endpoints (healthchecks) — flip to allowlist if needed
        if matches!(path_clone.as_str(), "/healthz") {
            return;
        }
        let _ = sqlx::query(
            r#"
            INSERT INTO audit_log
                (id, method, path, status, latency_ms, ip, user_agent, user_id, ts)
            VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8, NOW())
            "#,
        )
        .bind(request_id)
        .bind(&method_str)
        .bind(&path_clone)
        .bind(status.as_u16() as i32)
        .bind(latency_ms)
        .bind(if ip.is_empty() { None } else { Some(ip) })
        .bind(&ua)
        .bind(user_id)
        .execute(&pg)
        .await;
    });

    // Emit a tracing event so logs still capture the call
    if status.is_client_error() || status.is_server_error() {
        tracing::warn!(
            %request_id, %method, %path, %status, latency_ms,
            "request"
        );
    } else {
        tracing::debug!(%request_id, %method, %path, %status, latency_ms, "request");
    }

    response
}

#[allow(dead_code)]
fn _status_help(s: StatusCode) -> bool {
    s.is_success()
}
