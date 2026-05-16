// Shared application state cloned into every handler via `with_state`.

use crate::config::Config;
use redis::aio::ConnectionManager;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pg: PgPool,
    pub redis: ConnectionManager,
    pub config: Config,
}
