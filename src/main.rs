#![recursion_limit = "256"]
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
mod config;
mod content;
mod db;
mod errors;
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

    let state = AppState {
        pg: pg_pool,
        redis: redis_mgr,
        config: cfg.clone(),
        search,
    };

    let app = Router::new()
        .route("/", get(routes::index::handler))
        .route("/healthz", get(routes::health::handler))
        .nest("/api/v1", routes::api::router(state.clone()))
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
