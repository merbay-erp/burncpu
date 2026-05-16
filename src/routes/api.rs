// /api/v1 — public API surface. Submodules attach themselves below.

use super::auth;
use crate::state::AppState;
use axum::{routing::get, Router};
use serde_json::json;

pub fn router(_state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(|| async {
                axum::Json(json!({
                    "name": "burncpu API",
                    "version": env!("CARGO_PKG_VERSION"),
                    "endpoints": {
                        "POST /api/v1/auth/request":         "request magic-link email",
                        "GET  /api/v1/auth/verify/:token":   "verify token + start session",
                        "POST /api/v1/auth/logout":          "revoke current session",
                        "GET  /healthz":                      "liveness probe",
                    },
                }))
            }),
        )
        .nest("/auth", auth::router())
}
