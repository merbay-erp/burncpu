// /rss/* — Atom 1.0 feeds (well-formed XML, no extra crate).
//
//   GET /rss/all                  → site-wide public timeline (latest 50)
//   GET /rss/user/{username}      → that user's public posts (latest 50)
//   GET /rss/hashtag/{tag}        → posts containing #tag (latest 50, via Postgres LIKE — Meilisearch only used for live search UX)
//
// We emit Atom (not RSS 2.0) — better unicode handling, fewer reader quirks.
// Body is wrapped in CDATA after entity-escaping <, >, &. The CDATA payload
// itself can't contain "]]>", so we split it just in case (paranoid).

use crate::{errors::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/all", get(all))
        .route("/user/{username}", get(user_feed))
        .route("/hashtag/{tag}", get(hashtag_feed))
}

#[derive(sqlx::FromRow)]
struct FeedRow {
    id: Uuid,
    author_username: String,
    author_display_name: String,
    body: String,
    body_html: String,
    created_at: DateTime<Utc>,
}

async fn all(State(state): State<AppState>) -> Result<Response, AppError> {
    let rows: Vec<FeedRow> = sqlx::query_as(
        r#"
        SELECT p.id, u.username AS author_username, u.display_name AS author_display_name,
               p.body, p.body_html, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL AND p.moderation_state = 'live' AND p.visibility = 'public'
        ORDER BY p.created_at DESC LIMIT 50
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(atom_response(
        &state.config.site_origin,
        "burncpu — public timeline",
        "/rss/all",
        rows,
    ))
}

async fn user_feed(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Response, AppError> {
    let rows: Vec<FeedRow> = sqlx::query_as(
        r#"
        SELECT p.id, u.username AS author_username, u.display_name AS author_display_name,
               p.body, p.body_html, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE u.username = $1
          AND p.deleted_at IS NULL AND p.moderation_state = 'live' AND p.visibility = 'public'
        ORDER BY p.created_at DESC LIMIT 50
        "#,
    )
    .bind(&username)
    .fetch_all(&state.pg)
    .await?;
    Ok(atom_response(
        &state.config.site_origin,
        &format!("burncpu — @{username}"),
        &format!("/rss/user/{username}"),
        rows,
    ))
}

async fn hashtag_feed(
    State(state): State<AppState>,
    Path(tag): Path<String>,
) -> Result<Response, AppError> {
    let needle = format!("%#{}%", tag.to_lowercase().replace('%', ""));
    let rows: Vec<FeedRow> = sqlx::query_as(
        r#"
        SELECT p.id, u.username AS author_username, u.display_name AS author_display_name,
               p.body, p.body_html, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE LOWER(p.body) LIKE $1
          AND p.deleted_at IS NULL AND p.moderation_state = 'live' AND p.visibility = 'public'
        ORDER BY p.created_at DESC LIMIT 50
        "#,
    )
    .bind(&needle)
    .fetch_all(&state.pg)
    .await?;
    Ok(atom_response(
        &state.config.site_origin,
        &format!("burncpu — #{tag}"),
        &format!("/rss/hashtag/{tag}"),
        rows,
    ))
}

// ── Atom serialization ──────────────────────────────────────────

fn atom_response(site: &str, title: &str, self_path: &str, rows: Vec<FeedRow>) -> Response {
    let updated = rows
        .first()
        .map(|r| r.created_at)
        .unwrap_or_else(Utc::now);
    let self_url = format!("{site}{self_path}");
    let mut xml = String::with_capacity(rows.len() * 512 + 1024);
    xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    xml.push_str("<feed xmlns=\"http://www.w3.org/2005/Atom\">\n");
    xml.push_str(&format!("  <title>{}</title>\n", esc(title)));
    xml.push_str(&format!("  <id>{}</id>\n", esc(&self_url)));
    xml.push_str(&format!(
        "  <link rel=\"self\" href=\"{}\"/>\n",
        esc(&self_url)
    ));
    xml.push_str(&format!("  <link href=\"{}\"/>\n", esc(site)));
    xml.push_str(&format!(
        "  <updated>{}</updated>\n",
        updated.to_rfc3339()
    ));
    xml.push_str(&format!(
        "  <generator uri=\"{}\">burncpu</generator>\n",
        esc(site)
    ));

    for r in rows {
        let post_url = format!("{site}/posts/{}", r.id);
        xml.push_str("  <entry>\n");
        xml.push_str(&format!("    <id>{}</id>\n", esc(&post_url)));
        xml.push_str(&format!(
            "    <title>{}</title>\n",
            esc(&first_line(&r.body, 80))
        ));
        xml.push_str(&format!(
            "    <link href=\"{}\"/>\n",
            esc(&post_url)
        ));
        xml.push_str(&format!(
            "    <updated>{}</updated>\n",
            r.created_at.to_rfc3339()
        ));
        xml.push_str(&format!(
            "    <published>{}</published>\n",
            r.created_at.to_rfc3339()
        ));
        xml.push_str("    <author>\n");
        xml.push_str(&format!(
            "      <name>{}</name>\n",
            esc(&r.author_display_name)
        ));
        xml.push_str(&format!(
            "      <uri>{site}/@{}</uri>\n",
            esc(&r.author_username)
        ));
        xml.push_str("    </author>\n");
        xml.push_str("    <content type=\"html\">");
        xml.push_str(&cdata(&r.body_html));
        xml.push_str("</content>\n");
        xml.push_str("  </entry>\n");
    }
    xml.push_str("</feed>\n");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/atom+xml; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    (StatusCode::OK, headers, xml).into_response()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn cdata(html: &str) -> String {
    // CDATA can't contain "]]>", split + re-close defensively
    let split = html.replace("]]>", "]]]]><![CDATA[>");
    format!("<![CDATA[{split}]]>")
}

fn first_line(s: &str, max: usize) -> String {
    let line = s.lines().next().unwrap_or("");
    line.chars().take(max).collect()
}
