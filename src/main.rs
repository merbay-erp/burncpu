#![recursion_limit = "512"]
// burncpu.com — kendi sosyal medyamız
//
// Bootstrap entrypoint. Reads .env, initializes tracing, builds the Axum
// router with all middleware, opens Postgres + Redis pools, and serves on
// the configured TCP address.

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod auth;
mod cleanup;
mod config;
mod content;
mod db;
mod errors;
mod federation;
mod middleware;
mod routes;
mod search;
mod state;

use state::AppState;

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

    let pg_pool = db::connect(&cfg.database_url).await?;
    tracing::info!("postgres connected");

    sqlx::migrate!("./migrations").run(&pg_pool).await?;
    tracing::info!("migrations applied");

    let redis = redis::Client::open(cfg.redis_url.clone())?;
    let redis_mgr = redis::aio::ConnectionManager::new(redis).await?;
    tracing::info!("redis connected");

    let search = search::Search::new(&cfg.meilisearch_url, &cfg.meilisearch_key);
    if let Err(e) = search.ensure_ready().await {
        tracing::warn!(?e, "meilisearch ensure_ready failed; continuing — search will be degraded");
    } else {
        tracing::info!("meilisearch index ready");
    }

    // Broadcast channel for live notifications (SSE). Capacity 512 is
    // enough to absorb a burst while subscribers catch up — slow
    // consumers will get Lagged errors and the SSE handler will drop
    // them, which is fine.
    let (notif_tx, _) = tokio::sync::broadcast::channel(512);

    // Background cleanup of expired rows (hourly).
    cleanup::spawn(pg_pool.clone());
    tracing::info!("cleanup task scheduled");

    let state = AppState {
        pg: pg_pool,
        redis: redis_mgr,
        config: cfg.clone(),
        search,
        notif_tx,
    };

    // Make sure media dir exists on first boot (idempotent).
    let _ = tokio::fs::create_dir_all(&cfg.media_dir).await;

    let app = Router::new()
        .route("/", get(routes::index::handler))
        .route("/healthz", get(routes::health::handler))
        .route("/sitemap.xml", get(routes::sitemap::handler))
        .route("/embed/posts/{id}", get(routes::embed::post_embed))
        .route("/.well-known/webfinger", get(routes::federation::webfinger))
        .route("/.well-known/nodeinfo", get(routes::federation::nodeinfo_discovery))
        .route("/nodeinfo/2.1", get(routes::federation::nodeinfo))
        .nest("/ap", routes::federation::router())
        .nest("/rss", routes::rss::router())
        .nest("/api/v1", routes::api::router(state.clone()))
        // 6 MiB request body cap (5 MiB media + multipart overhead)
        .layer(axum::extract::DefaultBodyLimit::max(6 * 1024 * 1024))
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
