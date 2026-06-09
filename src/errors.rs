// Single error type that converts cleanly into an HTTP response.
// Handlers return `Result<T, AppError>` and bubble most errors up via `?`.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("rate limited")]
    RateLimited,

    #[error("database error")]
    Database(#[from] sqlx::Error),

    #[error("redis error")]
    Redis(#[from] redis::RedisError),

    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // The `message` is client-facing. For 4xx it is our own text (validation
        // hints, etc.) and safe to surface; for the 5xx group it is forced to a
        // static string so an internal error's detail (a sqlx/anyhow message that
        // can name tables, columns, or hosts) is never leaked — the full error is
        // logged server-side instead.
        let (status, code, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found", self.to_string()),
            AppError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, "unauthorized", self.to_string())
            }
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", self.to_string()),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request", self.to_string()),
            AppError::RateLimited => {
                (StatusCode::TOO_MANY_REQUESTS, "rate_limited", self.to_string())
            }
            AppError::Database(_) | AppError::Redis(_) | AppError::Internal(_) => {
                tracing::error!(error = ?self, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "internal error".to_string(),
                )
            }
        };
        let body = Json(json!({ "error": code, "message": message }));
        let mut resp = (status, body).into_response();
        // Give API / mobile clients a concrete backoff hint on 429s.
        if matches!(self, AppError::RateLimited) {
            resp.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("60"),
            );
        }
        resp
    }
}
