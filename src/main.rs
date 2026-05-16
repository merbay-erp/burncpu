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

mod config;
mod db;
mod errors;
mod routes;
mod state;

use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    // ── Load .env (best-effort; production uses systemd EnvironmentFile)
    let _ = dotenvy::dotenv();

    // ── Tracing
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "burncpu=info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer().compact())
        .init();

    let cfg = config::Config::from_env()?;
    tracing::info!(?cfg.bind_addr, "burncpu starting");

    // ── Database
    let pg_pool = db::connect(&cfg.database_url).await?;
    tracing::info!("postgres connected");

    // Run migrations
    sqlx::migrate!("./migrations").run(&pg_pool).await?;
    tracing::info!("migrations applied");

    // ── Redis
    let redis = redis::Client::open(cfg.redis_url.clone())?;
    let redis_mgr = redis::aio::ConnectionManager::new(redis).await?;
    tracing::info!("redis connected");

    // ── App state
    let state = AppState {
        pg: pg_pool,
        redis: redis_mgr,
        config: cfg.clone(),
    };

    // ── Router
    let app = Router::new()
        .route("/", get(routes::index::handler))
        .route("/healthz", get(routes::health::handler))
        .nest("/api/v1", routes::api::router(state.clone()))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .with_state(state);

    // ── Bind + serve
    let addr: SocketAddr = cfg.bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "listening");
    axum::serve(listener, app).await?;

    Ok(())
}
