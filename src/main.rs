#![recursion_limit = "512"]
// burncpu.com — kendi sosyal medyamız
//
// Bootstrap entrypoint. Reads .env, initializes tracing, builds the Axum
// router with all middleware, opens Postgres + Redis pools, and serves on
// the configured TCP address.

use anyhow::Result;
use axum::{Router, routing::get};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod cache;
mod cleanup;
mod config;
mod content;
mod cover_cache;
mod db;
mod errors;
mod federation;
mod middleware;
mod moderation;
mod net_safety;
mod ratelimit;
mod routes;
mod search;
mod state;
mod transcode;

use state::{AppState, NotificationHub};

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "burncpu=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().compact())
        .init();

    let cfg = config::Config::from_env()?;
    tracing::info!(?cfg.bind_addr, "burncpu starting");

    // Record the registration posture at boot. Open signup on a public origin is
    // a deliberate choice for burncpu (invite gating was removed), so this is an
    // INFO statement of fact — not a warning that cries misconfiguration on every
    // boot and drowns out the real ones. Set INVITES_REQUIRED=true to go
    // invite-only and this line stops firing.
    let is_prod = cfg.site_origin.starts_with("https://");
    if is_prod && !cfg.invites_required {
        tracing::info!(
            "open registration enabled (INVITES_REQUIRED=false) on {}",
            cfg.site_origin
        );
    }
    if cfg.federation_enabled {
        tracing::info!("federation ENABLED (ActivityPub server-to-server is live)");
    }

    let pg_pool = db::connect(&cfg.database_url).await?;
    tracing::info!("postgres connected");

    sqlx::migrate!("./migrations").run(&pg_pool).await?;
    tracing::info!("migrations applied");

    let redis = redis::Client::open(cfg.redis_url.clone())?;
    let redis_mgr = redis::aio::ConnectionManager::new(redis).await?;
    tracing::info!("redis connected");

    let search = search::Search::new(&cfg.meilisearch_url, &cfg.meilisearch_key);
    if let Err(e) = search.ensure_ready().await {
        tracing::warn!(
            ?e,
            "meilisearch ensure_ready failed; continuing — search will be degraded"
        );
    } else {
        tracing::info!("meilisearch index ready");
    }

    // Targeted per-user SSE channels plus a separate public-post channel.
    // This avoids sending every private event through every connection.
    let notif_hub = NotificationHub::new(512);
    let (notification_delivery_tx, notification_delivery_rx) = tokio::sync::mpsc::channel(1024);

    // Background cleanup of expired rows + orphan media files (hourly).
    cleanup::spawn(pg_pool.clone(), cfg.media_dir.clone());
    tracing::info!("cleanup task scheduled");

    // Bounded webhook delivery worker — keeps event fan-out from spawning
    // unbounded outbound tasks.
    let webhook_tx = routes::webhooks::spawn_dispatcher(pg_pool.clone());

    // Bounded video transcode worker — normalises uploaded clips to H.264/AAC
    // MP4 off the request path (see `transcode`).
    let transcode_tx = transcode::spawn_transcoder(
        pg_pool.clone(),
        cfg.media_dir.clone(),
        cfg.transcode_max_duration_secs,
    );

    let state = AppState {
        pg: pg_pool,
        redis: redis_mgr,
        config: cfg.clone(),
        search,
        notif_hub,
        notification_delivery_tx,
        webhook_tx,
        transcode_tx,
    };
    routes::notifications::spawn_delivery_worker(state.clone(), notification_delivery_rx);

    // Make sure media dir exists on first boot (idempotent).
    let _ = tokio::fs::create_dir_all(&cfg.media_dir).await;

    // Recover any video transcodes a previous run left pending/processing.
    if cfg.video_transcode_enabled {
        transcode::requeue_pending(&state.pg, &state.transcode_tx).await;
    }

    let app = Router::new()
        .route("/", get(routes::index::handler))
        .route("/healthz", get(routes::health::handler))
        .route("/sitemap.xml", get(routes::sitemap::handler))
        .route("/embed/posts/{id}", get(routes::embed::post_embed))
        .route("/.well-known/webfinger", get(routes::federation::webfinger))
        .route(
            "/.well-known/nodeinfo",
            get(routes::federation::nodeinfo_discovery),
        )
        .route("/nodeinfo/2.1", get(routes::federation::nodeinfo))
        .route(
            "/.well-known/apple-app-site-association",
            get(routes::applinks::apple_app_site_association),
        )
        .route(
            "/.well-known/assetlinks.json",
            get(routes::applinks::android_assetlinks),
        )
        .route(
            "/.well-known/security.txt",
            get(routes::applinks::security_txt),
        )
        .nest("/ap", routes::federation::router())
        .nest("/rss", routes::rss::router())
        .nest("/api/v1", routes::api::router(state.clone()))
        // Small default body cap for JSON/non-media routes; /api/v1/media
        // overrides this with its own image/video upload limit.
        .layer(axum::extract::DefaultBodyLimit::max(6 * 1024 * 1024))
        .layer(axum::middleware::from_fn(middleware::timeout::layer))
        // Order on the request: audit (outer, sees user_id) → session
        // (loads CurrentUser) → csrf (rejects cookied cross-origin
        // state-changes) → trace → compression → handler.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::audit::layer,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::session::layer,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::csrf::layer,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .with_state(state);

    let addr: SocketAddr = cfg.bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
