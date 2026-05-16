// Runtime config. Values come from environment variables; in production
// systemd's EnvironmentFile=/opt/burncpu/.env provides them, locally
// `cargo run` with a project-root `.env` works via dotenvy.

use anyhow::{Context, Result};
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: String,
    pub database_url: String,
    pub redis_url: String,
    pub meilisearch_url: String,
    pub meilisearch_key: String,
    pub site_origin: String,
    pub invites_required: bool,
    pub bootstrap_admin_email: Option<String>,
    pub allowed_origins: Vec<String>,
    pub media_dir: String,
    pub federation_enabled: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3050".into()),
            database_url: env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6380".into()),
            meilisearch_url: env::var("MEILISEARCH_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:7700".into()),
            meilisearch_key: env::var("MEILI_MASTER_KEY")
                .or_else(|_| env::var("MEILISEARCH_KEY"))
                .unwrap_or_default(),
            site_origin: env::var("SITE_ORIGIN").unwrap_or_else(|_| "https://burncpu.com".into()),
            invites_required: env::var("INVITES_REQUIRED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(false),
            bootstrap_admin_email: env::var("BOOTSTRAP_ADMIN_EMAIL")
                .ok()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty()),
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            media_dir: env::var("MEDIA_DIR").unwrap_or_else(|_| "/data/media".into()),
            federation_enabled: env::var("FEDERATION_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(false),
        })
    }
}
