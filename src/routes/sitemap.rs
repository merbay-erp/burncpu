// /sitemap.xml — basic sitemap covering profile pages + recent public posts.
// Caches via nginx-side max-age=3600.

use crate::{errors::AppError, state::AppState};
use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub async fn handler(State(state): State<AppState>) -> Result<Response, AppError> {
    let site = state.config.site_origin.trim_end_matches('/').to_string();

    let users: Vec<(String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT username, last_seen_at FROM users WHERE role <> 'suspended' ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

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
    .await
    .unwrap_or_default();

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

    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    Ok((StatusCode::OK, h, xml).into_response())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
