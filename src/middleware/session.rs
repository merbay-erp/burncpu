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

use crate::{auth::hash_token, auth::token::SESSION_COOKIE, middleware::client_ip, state::AppState};
use axum::{
    body::Body,
    extract::State,
    http::{header, Request},
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub user_id: Uuid,
    pub role: String,
    pub session_id: Uuid,
    pub session_flagged: bool,
    pub pending_2fa: bool,
}

pub async fn layer(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    // Prefer bearer token (API client); fall back to session cookie (browser).
    let bearer = read_bearer(req.headers());
    if let Some(token) = bearer {
        let hash = hash_token(&token);
        let row: Option<(uuid::Uuid, String, String, Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as(
                r#"
                SELECT t.id, t.user_id::text, u.role, t.expires_at, t.revoked_at
                FROM api_tokens t JOIN users u ON u.id = t.user_id
                WHERE t.token_hash = $1
                "#,
            )
            .bind(&hash)
            .fetch_optional(&state.pg)
            .await
            .ok()
            .flatten();
        if let Some((_tid, user_id_text, role, expires_at, revoked_at)) = row {
            let alive = revoked_at.is_none()
                && expires_at.map(|e| e > chrono::Utc::now()).unwrap_or(true);
            if alive {
                if let Ok(user_id) = uuid::Uuid::parse_str(&user_id_text) {
                    // Bump last_used_at best-effort
                    let _ = sqlx::query(
                        "UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1",
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
                    });
                    return next.run(req).await;
                }
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

        let row: Option<(Uuid, Uuid, String, Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>, bool)> =
            sqlx::query_as(
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
            let should_flag = (ip_drift || ua_drift) && !was_flagged;

            if should_flag {
                tracing::warn!(
                    %session_id, %user_id, %ip, ?last_ip, ua_drift, ip_drift,
                    "session anomaly — flagging"
                );
            }

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
