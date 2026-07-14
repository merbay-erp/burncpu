// /sitemap.xml — basic sitemap covering profile pages + recent public posts.
// Caches via nginx-side max-age=3600.

use crate::{errors::AppError, state::AppState};
use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use redis::AsyncCommands;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

const CACHE_KEY: &str = "cache:sitemap:v1";
const CACHE_TTL_SECONDS: u64 = 3_600;

pub async fn handler(State(state): State<AppState>) -> Result<Response, AppError> {
    // Redis keeps the last successfully generated document. Besides avoiding
    // repeated multi-thousand-row reads, this means a transient database error
    // does not replace a valid sitemap with an empty document.
    let mut redis = state.redis.clone();
    let cached: Result<Option<String>, _> = redis.get(CACHE_KEY).await;
    if let Ok(Some(xml)) = cached {
        return Ok(xml_response(xml));
    }

    let site = state.config.site_origin.trim_end_matches('/').to_string();

    let users: Vec<(String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT username, last_seen_at FROM users WHERE role <> 'suspended' ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pg)
    .await?;

    let posts: Vec<(Uuid, DateTime<Utc>)> = sqlx::query_as(
        r#"
        SELECT p.id, COALESCE(p.edited_at, p.created_at)
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
          AND u.role <> 'suspended'
        ORDER BY p.created_at DESC LIMIT 5000
        "#,
    )
    .fetch_all(&state.pg)
    .await?;

    let mut xml = String::with_capacity(64 * 1024);
    xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    xml.push_str("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");

    xml.push_str(&format!(
        "  <url><loc>{site}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n"
    ));

    for (username, last_seen) in users {
        let mod_part = last_seen
            .map(|t| format!("<lastmod>{}</lastmod>", t.to_rfc3339()))
            .unwrap_or_default();
        xml.push_str(&format!(
            "  <url><loc>{site}/u/{}</loc>{mod_part}<changefreq>daily</changefreq></url>\n",
            esc(&username),
        ));
    }

    for (id, last) in posts {
        xml.push_str(&format!(
            "  <url><loc>{site}/posts/{id}</loc><lastmod>{}</lastmod></url>\n",
            last.to_rfc3339(),
        ));
    }

    xml.push_str("</urlset>\n");

    if let Err(error) = redis
        .set_ex::<_, _, ()>(CACHE_KEY, &xml, CACHE_TTL_SECONDS)
        .await
    {
        tracing::warn!(?error, "failed to cache sitemap");
    }

    Ok(xml_response(xml))
}

fn xml_response(xml: String) -> Response {
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600, s-maxage=3600, stale-if-error=86400"),
    );
    (StatusCode::OK, h, xml).into_response()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
