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
    let path = redact_sensitive_path(req.uri().path());
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

    // Async write — don't block the response on DB. Gated: at scale the audit
    // row is the dominant write, and successful read traffic (GET 2xx) has little
    // forensic value, so only durably record mutations, failures, and security-
    // relevant surfaces (see `audit_worthy`). Skipped requests still emit a
    // tracing event below.
    if audit_worthy(&method, status, &path) {
        let pg = state.pg.clone();
        let path_clone = path.clone();
        let method_str = method.to_string();
        tokio::spawn(async move {
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
    }

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

/// Magic-link tokens travel in the URL *path* on the verify/confirm routes
/// (e.g. `GET /api/v1/auth/verify/{token}`). That token is a single-use
/// secret with a 15-minute TTL, and the GET bounce does NOT consume it — so
/// logging the raw path would persist a still-valid credential into
/// `audit_log` (readable via `/admin/audit`) and into tracing output. Strip
/// the token segment before it is ever recorded.
fn redact_sensitive_path(path: &str) -> String {
    for prefix in ["/api/v1/auth/verify/", "/auth/confirm/", "/auth/verify/"] {
        if path
            .strip_prefix(prefix)
            .is_some_and(|rest| !rest.is_empty())
        {
            return format!("{prefix}[redacted]");
        }
    }
    path.to_string()
}

/// Which requests get a durable `audit_log` row. Always kept: mutations (non-GET)
/// and failures (4xx/5xx) — the forensically valuable events. Successful GETs are
/// kept only on security-relevant, low-volume surfaces; the bulk of read traffic
/// (feed / posts / profiles / search) is dropped, which is the per-request
/// write-amplification fix for scale.
fn audit_worthy(method: &axum::http::Method, status: StatusCode, path: &str) -> bool {
    use axum::http::Method;
    if path == "/healthz" {
        return false;
    }
    if *method != Method::GET || !status.is_success() {
        return true;
    }
    const SENSITIVE: &[&str] = &[
        "/admin",
        "/auth",
        "/oauth",
        "/2fa",
        "/passkeys",
        "/tokens",
        "/sessions",
        "/webhooks",
    ];
    SENSITIVE.iter().any(|p| path.contains(p))
}

#[cfg(test)]
mod tests {
    use super::{audit_worthy, redact_sensitive_path};
    use axum::http::{Method, StatusCode};

    #[test]
    fn audit_keeps_mutations_failures_and_sensitive_gets() {
        let ok = StatusCode::OK;
        // Bulk successful read traffic is dropped (the write-amplification fix).
        assert!(!audit_worthy(&Method::GET, ok, "/api/v1/posts"));
        assert!(!audit_worthy(&Method::GET, ok, "/api/v1/feed"));
        assert!(!audit_worthy(&Method::GET, ok, "/healthz"));
        // Mutations, failures, and security-relevant GETs are kept.
        assert!(audit_worthy(
            &Method::POST,
            StatusCode::CREATED,
            "/api/v1/posts"
        ));
        assert!(audit_worthy(&Method::DELETE, ok, "/api/v1/posts/x"));
        assert!(audit_worthy(
            &Method::GET,
            StatusCode::UNAUTHORIZED,
            "/api/v1/feed"
        ));
        assert!(audit_worthy(&Method::GET, ok, "/api/v1/admin/reports"));
        assert!(audit_worthy(
            &Method::GET,
            ok,
            "/api/v1/auth/verify/[redacted]"
        ));
    }

    #[test]
    fn redacts_magic_link_tokens() {
        assert_eq!(
            redact_sensitive_path("/api/v1/auth/verify/abc123SECRET"),
            "/api/v1/auth/verify/[redacted]"
        );
        assert_eq!(
            redact_sensitive_path("/auth/confirm/abc123SECRET"),
            "/auth/confirm/[redacted]"
        );
        // Untouched paths pass through verbatim.
        assert_eq!(redact_sensitive_path("/api/v1/posts"), "/api/v1/posts");
        assert_eq!(redact_sensitive_path("/healthz"), "/healthz");
        // Bare prefix with no token is left alone (nothing to leak).
        assert_eq!(
            redact_sensitive_path("/api/v1/auth/verify"),
            "/api/v1/auth/verify"
        );
    }
}
