// /api/v1 — public API surface. All future endpoints (posts, users,
// timeline, follows, reactions, moderation) hang off this router.

use crate::state::AppState;
use axum::{routing::get, Router};
use serde_json::json;

pub fn router(_state: AppState) -> Router<AppState> {
    Router::new().route(
        "/",
        get(|| async {
            axum::Json(json!({
                "name": "burncpu API",
                "version": env!("CARGO_PKG_VERSION"),
                "endpoints": {
                    "GET /api/v1/": "this index",
                    // posts, users, timeline, etc. coming soon
                },
            }))
        }),
    )
}
