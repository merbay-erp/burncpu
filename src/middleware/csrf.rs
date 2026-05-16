// CSRF / Origin defense.
//
// Cookie auth alone is insecure against cross-site form submissions. Even
// though `SameSite=Lax` blocks most cases, modern attacks (notably the
// "method override" trick and some niche browser bugs) still warrant a
// belt-and-suspenders Origin check on state-changing requests.
//
// Policy:
//   - GET / HEAD / OPTIONS                                  → always pass through
//   - Other methods (POST/PUT/PATCH/DELETE) on cookied req  → Origin must
//       match `site_origin` or one of `allowed_origins`. Empty Origin on a
//       cookied state-changing request is rejected (a real browser always
//       sends it for cross-origin or same-origin POSTs).
//   - Other methods WITHOUT the session cookie               → skip. Machine
//       clients that pass their own credentials (future: API tokens) are
//       not subject to CSRF, which is a browser-only attack class.

use crate::{auth::token::SESSION_COOKIE, state::AppState};
use axum::{
    body::Body,
    extract::State,
    http::{header, Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub async fn layer(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if is_safe_method(req.method()) {
        return next.run(req).await;
    }

    let has_session_cookie = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|raw| {
            let needle = format!("{SESSION_COOKIE}=");
            raw.split(';').any(|p| p.trim().starts_with(&needle))
        })
        .unwrap_or(false);

    if !has_session_cookie {
        return next.run(req).await;
    }

    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().trim_end_matches('/').to_string());

    let allowed: Vec<String> = std::iter::once(state.config.site_origin.clone())
        .chain(state.config.allowed_origins.iter().cloned())
        .map(|o| o.trim_end_matches('/').to_string())
        .collect();

    match origin {
        Some(o) if allowed.iter().any(|a| a == &o) => next.run(req).await,
        Some(o) => {
            tracing::warn!(origin = %o, "CSRF: rejecting state-change with unknown Origin");
            csrf_denied()
        }
        None => {
            tracing::warn!("CSRF: rejecting cookied state-change with no Origin header");
            csrf_denied()
        }
    }
}

fn is_safe_method(m: &Method) -> bool {
    matches!(*m, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn csrf_denied() -> Response {
    (
        StatusCode::FORBIDDEN,
        axum::Json(serde_json::json!({
            "error": "csrf",
            "message": "cross-origin request rejected; Origin missing or not allowlisted"
        })),
    )
        .into_response()
}
