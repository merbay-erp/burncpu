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
    /// Apple app identifier `TEAMID.com.burncpu.app` for the AASA file +
    /// webcredentials. Unset → the apple-app-site-association route 404s.
    pub ios_app_id: Option<String>,
    /// Android signing SHA-256 fingerprints (colon-hex) for assetlinks.json.
    /// Empty → the assetlinks route 404s. Accepts a comma-separated list so
    /// debug + EAS-managed prod keys can both verify.
    pub android_cert_fingerprints: Vec<String>,
    /// OAuth provider credentials keyed by provider name (google|github|microsoft).
    /// A provider is "enabled" iff its entry is present here — i.e. both its
    /// {PROVIDER}_CLIENT_ID and {PROVIDER}_CLIENT_SECRET env vars are set.
    pub oauth: std::collections::HashMap<String, OAuthProviderCreds>,
    /// Spam engine: a top-level public post is quarantined when its score ≥ this.
    pub spam_threshold: i32,
    /// Lowercased phrases that strongly mark a post as spam (`SPAM_DENYLIST`, csv).
    pub spam_denylist: Vec<String>,
    /// Lowercased phrases marking a post as toxic/harassing (`TOXICITY_DENYLIST`,
    /// csv) — a free, operator-tuned heuristic standing in for an ML classifier.
    /// Kept separate from spam so the two tune and log independently.
    pub toxicity_denylist: Vec<String>,
    /// Reactive moderation: a live post is auto-quarantined once this many distinct
    /// accounts file an open report against it (`REPORT_QUARANTINE_THRESHOLD`, default 4).
    pub report_quarantine_threshold: i64,
    /// Escalation: an account is auto-suspended once its decaying moderation heat
    /// reaches this (`HEAT_SUSPEND_THRESHOLD`, default 12; set 0 to disable the
    /// hard tier and keep only heat-weighted quarantining).
    pub heat_suspend_threshold: i32,
    /// Escalation: below the suspend threshold, an account is auto-shadow-banned
    /// once its heat reaches this (`SHADOW_BAN_THRESHOLD`, default 8; set 0 to
    /// disable autonomous shadow-banning and keep it an admin-only tool).
    pub shadow_ban_threshold: i32,
    /// Video transcode worker on/off (`VIDEO_TRANSCODE_ENABLED`, default true).
    /// When false, uploaded videos are kept verbatim and marked `ready` (the
    /// pre-pipeline behaviour) — a safety valve for hosts without ffmpeg.
    pub video_transcode_enabled: bool,
    /// Fail source videos longer than this (`TRANSCODE_MAX_DURATION_SECS`, default 300).
    pub transcode_max_duration_secs: i64,
}

/// Static OAuth2 client credentials for one provider.
#[derive(Debug, Clone)]
pub struct OAuthProviderCreds {
    pub client_id: String,
    pub client_secret: String,
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
            spam_threshold: env::var("SPAM_THRESHOLD")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(4),
            report_quarantine_threshold: env::var("REPORT_QUARANTINE_THRESHOLD")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(4),
            heat_suspend_threshold: env::var("HEAT_SUSPEND_THRESHOLD")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(12),
            shadow_ban_threshold: env::var("SHADOW_BAN_THRESHOLD")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(8),
            toxicity_denylist: env::var("TOXICITY_DENYLIST")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect(),
            spam_denylist: env::var("SPAM_DENYLIST")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect(),
            video_transcode_enabled: env::var("VIDEO_TRANSCODE_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(true),
            transcode_max_duration_secs: env::var("TRANSCODE_MAX_DURATION_SECS")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(300),
            media_dir: env::var("MEDIA_DIR").unwrap_or_else(|_| "/data/media".into()),
            federation_enabled: env::var("FEDERATION_ENABLED")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
                .unwrap_or(false),
            ios_app_id: env::var("IOS_APP_ID")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            android_cert_fingerprints: env::var("ANDROID_CERT_FINGERPRINTS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            oauth: {
                let mut m = std::collections::HashMap::new();
                for p in ["google", "github", "microsoft"] {
                    let up = p.to_uppercase();
                    if let (Ok(id), Ok(secret)) = (
                        env::var(format!("{up}_CLIENT_ID")),
                        env::var(format!("{up}_CLIENT_SECRET")),
                    ) {
                        let id = id.trim().to_string();
                        let secret = secret.trim().to_string();
                        if !id.is_empty() && !secret.is_empty() {
                            m.insert(
                                p.to_string(),
                                OAuthProviderCreds { client_id: id, client_secret: secret },
                            );
                        }
                    }
                }
                m
            },
        })
    }
}
