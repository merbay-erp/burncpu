//! Application request deadline.
//!
//! The edge proxy may give up on a request, but without an application deadline
//! the handler can continue consuming a DB connection or worker slot. Streaming
//! and long-running media/admin maintenance routes are explicitly excluded.

use axum::{
    Json,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn layer(req: Request, next: Next) -> Response {
    if excluded(req.uri().path()) {
        return next.run(req).await;
    }

    match tokio::time::timeout(REQUEST_TIMEOUT, next.run(req)).await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!("request exceeded 30 second application deadline");
            (
                StatusCode::GATEWAY_TIMEOUT,
                Json(json!({
                    "error": "timeout",
                    "message": "request timed out"
                })),
            )
                .into_response()
        }
    }
}

fn excluded(path: &str) -> bool {
    path == "/api/v1/notifications/stream"
        || path.starts_with("/api/v1/media")
        || path == "/api/v1/search/reindex"
}

#[cfg(test)]
mod tests {
    use super::excluded;

    #[test]
    fn only_long_lived_routes_are_excluded() {
        assert!(excluded("/api/v1/notifications/stream"));
        assert!(excluded("/api/v1/media"));
        assert!(excluded("/api/v1/media/abc"));
        assert!(excluded("/api/v1/search/reindex"));
        assert!(!excluded("/api/v1/posts"));
        assert!(!excluded("/healthz"));
    }
}
