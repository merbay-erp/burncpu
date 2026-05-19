// /embed/posts/{id} — minimal HTML with per-post OG meta for share previews.
//
// SPAs can't set <meta> tags in time for crawlers that read the initial
// HTML response (Twitterbot, Slackbot, Discordbot, LinkedInBot, WhatsApp,
// Telegram, Pinterest, facebookexternalhit). This route renders a tiny
// HTML page tailored for those crawlers; nginx rewrites /posts/{id} to
// /embed/posts/{id} when the User-Agent matches one of those bots, so
// human visitors still hit the SPA. The page also has a meta-refresh and
// a real <a> tag pointing back to /posts/{id} so any crawler that *does*
// follow the link lands on the real page.

use crate::{content::excerpt, errors::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub async fn post_embed(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    let row: Option<(String, String, String, DateTime<Utc>)> = sqlx::query_as(
        r#"
        SELECT u.username, u.display_name, p.body, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
          AND p.moderation_state = 'live' AND p.visibility = 'public'
          AND u.role <> 'suspended'
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;
    let (username, display_name, body, created_at) = row.ok_or(AppError::NotFound)?;

    let site = state.config.site_origin.trim_end_matches('/').to_string();
    let canonical = format!("{site}/posts/{id}");
    let title = format!("@{username} — burncpu");
    let excerpt = excerpt(&body, 180);

    let html = format!(
        r#"<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc_title}</title>
<link rel="canonical" href="{canonical}">
<meta name="description" content="{esc_excerpt}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="burncpu">
<meta property="og:title" content="{esc_title}">
<meta property="og:description" content="{esc_excerpt}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{site}/og-card.svg">
<meta property="article:author" content="{esc_display}">
<meta property="article:published_time" content="{published}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc_title}">
<meta name="twitter:description" content="{esc_excerpt}">
<meta name="twitter:image" content="{site}/og-card.svg">

<meta http-equiv="refresh" content="0; url={canonical}">
</head>
<body style="background:#0b0b0c;color:#e6e6e8;font-family:system-ui,sans-serif;padding:40px;">
<p><a href="{canonical}" style="color:#ff6b35;">→ {esc_title} adresine git</a></p>
<blockquote>{esc_excerpt}</blockquote>
</body>
</html>"#,
        esc_title = esc(&title),
        esc_display = esc(&display_name),
        esc_excerpt = esc(&excerpt),
        canonical = canonical,
        site = site,
        published = created_at.to_rfc3339(),
    );

    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=600"),
    );
    Ok((StatusCode::OK, h, html).into_response())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
