// Postgres connection pool factory. Keep this thin — schema lives in
// migrations/, query helpers in routes/* or future repository modules.

use anyhow::Result;
use sqlx::{PgPool, postgres::PgPoolOptions};

pub async fn connect(database_url: &str) -> Result<PgPool> {
    // Pool size: Postgres on the prod box allows 100 connections and the host
    // has ample RAM/cores, so 16 was leaving most of that idle and capping us at
    // ~16 concurrent in-flight DB queries — under load every authenticated
    // request (which does a session SELECT) would queue then hit the 5s
    // acquire timeout. Override via DB_MAX_CONNECTIONS; default 48 keeps healthy
    // headroom under Postgres's 100 (app + migrations + manual psql).
    let max = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(48);
    let pool = PgPoolOptions::new()
        .max_connections(max)
        .min_connections(4)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(database_url)
        .await?;
    Ok(pool)
}
