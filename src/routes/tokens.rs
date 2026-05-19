// /api/v1/tokens — personal API tokens (bearer auth).
//
//   GET    /tokens                → list (no raw value, just metadata)
//   POST   /tokens   { name, scope, expires_in_days? }  → 201 { id, token } (raw shown once)
//   DELETE /tokens/{id}           → revoke

use crate::{
    auth::{new_token, scope::is_valid_scope},
    errors::AppError,
    middleware::auth_extractor::SessionUser,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", delete(revoke))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TokenRow {
    id: Uuid,
    name: String,
    scope: String,
    last_used_at: Option<DateTime<Utc>>,
    expires_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

async fn list(
    State(state): State<AppState>,
    user: SessionUser,
) -> Result<Json<Vec<TokenRow>>, AppError> {
    let rows: Vec<TokenRow> = sqlx::query_as(
        r#"
        SELECT id, name, scope, last_used_at, expires_at, revoked_at, created_at
        FROM api_tokens WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 50
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateBody {
    name: String,
    #[serde(default = "default_scope")]
    scope: String,
    expires_in_days: Option<i64>,
}
fn default_scope() -> String {
    "all".to_string()
}

#[derive(Serialize)]
pub struct CreatedToken {
    id: Uuid,
    name: String,
    scope: String,
    token: String, // raw, shown ONCE
    expires_at: Option<DateTime<Utc>>,
}

async fn create(
    State(state): State<AppState>,
    user: SessionUser,
    Json(input): Json<CreateBody>,
) -> Result<(StatusCode, Json<CreatedToken>), AppError> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::BadRequest("name 1..64 chars".into()));
    }
    if !is_valid_scope(&input.scope) {
        return Err(AppError::BadRequest(
            "invalid scope; use all, read, read:<resource>, or write:<resource>".into(),
        ));
    }
    let (raw, hash) = new_token().map_err(AppError::Internal)?;
    let expires_at = input.expires_in_days.map(|d| Utc::now() + chrono::Duration::days(d));

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO api_tokens (user_id, name, token_hash, scope, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(name)
    .bind(&hash)
    .bind(&input.scope)
    .bind(expires_at)
    .fetch_one(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedToken {
            id,
            name: name.to_string(),
            scope: input.scope,
            token: raw,
            expires_at,
        }),
    ))
}

async fn revoke(
    State(state): State<AppState>,
    user: SessionUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query(
        "UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(user.user_id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
