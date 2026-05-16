// Shared application state cloned into every handler via `with_state`.

use crate::{config::Config, search::Search};
use redis::aio::ConnectionManager;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use uuid::Uuid;

/// One event delivered to every subscribed SSE consumer. The handler
/// filters by `user_id` so each connection only sees events for that user.
#[derive(Clone, Debug, Serialize)]
pub struct NotificationEvent {
    pub user_id: Uuid,
    pub kind: String,
    pub actor_id: Option<Uuid>,
    pub actor_username: Option<String>,
    pub target_kind: String,
    pub target_id: Uuid,
    pub created_at: String, // ISO-8601
}

#[derive(Clone)]
pub struct AppState {
    pub pg: PgPool,
    pub redis: ConnectionManager,
    pub config: Config,
    pub search: Search,
    pub notif_tx: broadcast::Sender<NotificationEvent>,
}
