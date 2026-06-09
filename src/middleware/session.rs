// Session loader + hijack detection.
//
// Reads the session cookie, looks up the row in `sessions`, and:
//   1. Updates last_seen_at / last_seen_ip / last_seen_ua
//   2. Compares last_seen_ip vs the request's IP, and last_seen_ua vs the
//      request's UA. If either has changed, sets `flagged_at = NOW()`.
//      We don't force re-auth yet — just record the anomaly so the admin
//      UI can show "this session moved from IP X to IP Y at time Z".
//   3. Attaches `CurrentUser { user_id, role, session_id }` as a request
//      extension so downstream handlers can call `.extensions().get()`.
//
// Soft-fail philosophy: if anything goes wrong (DB hiccup, malformed
// cookie), we don't abort the request — we just don't attach the
// extension and let the handler enforce its own auth (or 401).

use crate::{
    auth::{hash_token, scope::scope_allows, token::SESSION_COOKIE},
    middleware::client_ip,
    state::AppState,
};
use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthKind {
    Session,
    ApiToken,
}

type ApiTokenAuthRow = (
    Uuid,
    Uuid,
    String,
    String,
    Option<chrono::DateTime<chrono::Utc>>,
    Option<chrono::DateTime<chrono::Utc>>,
);
type SessionAuthRow = (
    Uuid,
    Uuid,
    String,
    Option<String>,
    Option<String>,
    Option<chrono::DateTime<chrono::Utc>>,
    bool,
);

#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub user_id: Uuid,
    pub role: String,
    #[allow(dead_code)]
    pub session_id: Uuid,
    pub session_flagged: bool,
    pub pending_2fa: bool,
    pub auth_kind: AuthKind,
}

impl CurrentUser {
    pub fn is_api_token(&self) -> bool {
        matches!(self.auth_kind, AuthKind::ApiToken)
    }
}

pub async fn layer(State(state): State<AppState>, mut req: Request<Body>, next: Next) -> Response {
    // Prefer bearer token (API client); fall back to session cookie (browser).
    let bearer = read_bearer(req.headers());
    if let Some(token) = bearer {
        let hash = hash_token(&token);
        let row: Option<ApiTokenAuthRow> = sqlx::query_as(
            r#"
                SELECT t.id, t.user_id, u.role, t.scope, t.expires_at, t.revoked_at
                FROM api_tokens t JOIN users u ON u.id = t.user_id
                WHERE t.token_hash = $1
                  AND u.role <> 'suspended'
                "#,
        )
        .bind(&hash)
        .fetch_optional(&state.pg)
        .await
        .ok()
        .flatten();
        if let Some((_tid, user_id, role, scope, expires_at, revoked_at)) = row {
            let alive =
                revoked_at.is_none() && expires_at.map(|e| e > chrono::Utc::now()).unwrap_or(true);
            if alive {
                if !scope_allows(&scope, req.method(), req.uri().path()) {
                    return forbidden(
                        "token_scope_denied",
                        "API token scope does not permit this request",
                    );
                }
                // Bump last_used_at best-effort, throttled to at most once per
                // minute. Writing on *every* API request turns a read path
                // into a per-request row UPDATE (WAL + row lock + vacuum
                // churn) that serializes concurrent calls on the same token.
                let _ = sqlx::query(
                    "UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - interval '60 seconds')",
                )
                .bind(&hash)
                .execute(&state.pg)
                .await;
                req.extensions_mut().insert(CurrentUser {
                    user_id,
                    role,
                    session_id: Uuid::nil(),
                    session_flagged: false,
                    pending_2fa: false,
                    auth_kind: AuthKind::ApiToken,
                });
                return next.run(req).await;
            }
        }
        // Fall through: bad bearer doesn't 401 here — handler decides.
    }
    if let Some(raw) = read_cookie(req.headers()) {
        let hash = hash_token(&raw);
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
            .map(|i| i.to_string())
            .unwrap_or_default();

        let row: Option<SessionAuthRow> = sqlx::query_as(
            r#"
                SELECT s.id, s.user_id, u.role,
                       host(s.last_seen_ip)::text AS last_seen_ip,
                       s.last_seen_ua,
                       s.flagged_at,
                       s.pending_2fa
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = $1
                  AND s.revoked_at IS NULL
                  AND s.expires_at > NOW()
                  AND u.role <> 'suspended'
                "#,
        )
        .bind(&hash)
        .fetch_optional(&state.pg)
        .await
        .ok()
        .flatten();

        if let Some((session_id, user_id, role, last_ip, last_ua, flagged, pending_2fa)) = row {
            let ip_drift = last_ip.as_deref().unwrap_or("") != ip;
            let ua_drift = last_ua.as_deref().unwrap_or("") != ua.as_str();
            let was_flagged = flagged.is_some();
            // IP drift alone is mostly noise: mobile networks, CGNAT, and
            // wifi↔cellular handoffs rotate the client IP constantly, so
            // flagging on it turns `flagged_at` into "this user is on a phone"
            // rather than a real signal — and a noisy flag is an ignored flag.
            // We flag on UA drift instead: a session's User-Agent should be
            // stable for its lifetime, so a change is a genuine "cookie replayed
            // from a different client" indicator. The new IP is still recorded
            // below for the admin "moved from X to Y" view.
            let should_flag = ua_drift && !was_flagged;

            if should_flag {
                tracing::warn!(
                    %session_id, %user_id, %ip, ?last_ip, ua_drift, ip_drift,
                    "session anomaly — flagging"
                );
            }

            // Throttle the "last seen" write to at most once per minute, exactly
            // like the API-token path above: updating on *every* authenticated
            // request turns a read into a per-request row UPDATE (WAL + row lock +
            // dead-tuple/vacuum churn) that serializes concurrent calls on the same
            // session — the single biggest write-amplifier at scale. The WHERE makes
            // the throttled case a 0-row no-op (index probe, no write). A genuine
            // anomaly ($4 = should_flag) always writes so the flag is never dropped.
            let _ = sqlx::query(
                r#"
                UPDATE sessions
                SET last_seen_at = NOW(),
                    last_seen_ip = $2::inet,
                    last_seen_ua = $3,
                    flagged_at   = CASE
                        WHEN flagged_at IS NULL AND $4 THEN NOW()
                        ELSE flagged_at
                    END
                WHERE id = $1
                  AND ($4 OR last_seen_at < NOW() - interval '60 seconds')
                "#,
            )
            .bind(session_id)
            .bind(if ip.is_empty() { None } else { Some(&ip) })
            .bind(&ua)
            .bind(should_flag)
            .execute(&state.pg)
            .await;

            req.extensions_mut().insert(CurrentUser {
                user_id,
                role,
                session_id,
                session_flagged: was_flagged || should_flag,
                pending_2fa,
                auth_kind: AuthKind::Session,
            });
        }
    }

    next.run(req).await
}

fn read_cookie(headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{SESSION_COOKIE}=");
    for part in raw.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix(&prefix) {
            return Some(rest.to_string());
        }
    }
    None
}

fn read_bearer(headers: &axum::http::HeaderMap) -> Option<String> {
    let v = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    v.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

fn forbidden(code: &str, message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": code,
            "message": message,
        })),
    )
        .into_response()
}
