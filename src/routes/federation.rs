// /ap/* + /.well-known/* — ActivityPub server endpoints.
//
// All routes return 404 when FEDERATION_ENABLED is false. Webfinger and
// NodeInfo similarly 404 — discovery shouldn't claim the instance is
// federated when it isn't.

use crate::{
    errors::AppError,
    federation::{
        AP_CT, IncomingActivity, PUBLIC_URI, actor_json, actor_url, ensure_actor_key, fetch_actor,
        handle_inbox, sign,
    },
    state::AppState,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/{username}", get(actor))
        .route("/users/{username}/outbox", get(outbox))
        .route("/users/{username}/followers", get(followers))
        .route("/users/{username}/following", get(following))
        .route("/users/{username}/inbox", post(inbox))
}

fn fed_off() -> Response {
    (StatusCode::NOT_FOUND, "federation disabled").into_response()
}

fn ap_response<T: Serialize>(body: T) -> Response {
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/activity+json; charset=utf-8"),
    );
    (StatusCode::OK, h, Json(body)).into_response()
}

// ─── /ap/users/{username} ──────────────────────────────────────

async fn actor(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let row: Option<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, username, display_name, bio FROM users WHERE username = $1 AND role <> 'suspended'",
    )
    .bind(&username)
    .fetch_optional(&state.pg)
    .await?;
    let (user_id, username, display_name, bio) = row.ok_or(AppError::NotFound)?;
    let key = ensure_actor_key(&state, user_id)
        .await
        .map_err(AppError::Internal)?;
    let body = actor_json(
        &state.config.site_origin,
        &username,
        &display_name,
        bio.as_deref(),
        &key.public_pem,
    );
    Ok(ap_response(body))
}

// ─── /ap/users/{username}/outbox ───────────────────────────────

#[derive(Deserialize)]
pub struct PageQuery {
    page: Option<bool>,
}

#[derive(Serialize)]
struct OutboxCollection {
    #[serde(rename = "@context")]
    context: &'static str,
    id: String,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(rename = "totalItems")]
    total_items: i64,
    first: String,
}

#[derive(Serialize)]
struct OutboxPage {
    #[serde(rename = "@context")]
    context: &'static str,
    id: String,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(rename = "partOf")]
    part_of: String,
    #[serde(rename = "orderedItems")]
    ordered_items: Vec<serde_json::Value>,
}

async fn outbox(
    State(state): State<AppState>,
    Path(username): Path<String>,
    Query(q): Query<PageQuery>,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let row: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1 AND role <> 'suspended'")
            .bind(&username)
            .fetch_optional(&state.pg)
            .await?;
    let user_id = row.ok_or(AppError::NotFound)?;
    let actor = actor_url(&state.config.site_origin, &username);
    let outbox_id = format!("{actor}/outbox");

    if !q.page.unwrap_or(false) {
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL AND moderation_state = 'live' AND visibility = 'public'",
        )
        .bind(user_id)
        .fetch_one(&state.pg)
        .await
        .unwrap_or(0);
        return Ok(ap_response(OutboxCollection {
            context: "https://www.w3.org/ns/activitystreams",
            id: outbox_id.clone(),
            typ: "OrderedCollection",
            total_items: total,
            first: format!("{outbox_id}?page=true"),
        }));
    }

    // Page — last 50 public posts as Create activities
    let rows: Vec<(Uuid, String, sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>)> = sqlx::query_as(
        r#"
        SELECT id, body_html, created_at FROM posts
        WHERE author_id = $1 AND deleted_at IS NULL AND moderation_state = 'live' AND visibility = 'public'
        ORDER BY created_at DESC LIMIT 50
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pg)
    .await?;
    let site = state.config.site_origin.trim_end_matches('/');
    let items: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(pid, html, ts)| {
            let obj_id = format!("{site}/posts/{pid}");
            serde_json::json!({
                "id": format!("{obj_id}#create"),
                "type": "Create",
                "actor": actor,
                "to": [PUBLIC_URI],
                "cc": [format!("{actor}/followers")],
                "published": ts,
                "object": {
                    "id": obj_id.clone(),
                    "type": "Note",
                    "attributedTo": actor,
                    "content": html,
                    "published": ts,
                    "to": [PUBLIC_URI],
                    "url": obj_id,
                },
            })
        })
        .collect();

    Ok(ap_response(OutboxPage {
        context: "https://www.w3.org/ns/activitystreams",
        id: format!("{outbox_id}?page=true"),
        typ: "OrderedCollectionPage",
        part_of: outbox_id,
        ordered_items: items,
    }))
}

// ─── Followers / following collections ─────────────────────────

#[derive(Serialize)]
struct CollectionSummary {
    #[serde(rename = "@context")]
    context: &'static str,
    id: String,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(rename = "totalItems")]
    total_items: i64,
}

async fn followers(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1 AND role <> 'suspended'")
            .bind(&username)
            .fetch_optional(&state.pg)
            .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;
    let local: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM follows f
        JOIN users u ON u.id = f.follower_id
        WHERE f.followee_id = $1 AND u.role <> 'suspended'
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    let remote: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM federation_followers WHERE local_user_id = $1 AND accepted = true",
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    Ok(ap_response(CollectionSummary {
        context: "https://www.w3.org/ns/activitystreams",
        id: format!(
            "{}/followers",
            actor_url(&state.config.site_origin, &username)
        ),
        typ: "Collection",
        total_items: local + remote,
    }))
}

async fn following(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1 AND role <> 'suspended'")
            .bind(&username)
            .fetch_optional(&state.pg)
            .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;
    let n: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM follows f
        JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = $1 AND u.role <> 'suspended'
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    Ok(ap_response(CollectionSummary {
        context: "https://www.w3.org/ns/activitystreams",
        id: format!(
            "{}/following",
            actor_url(&state.config.site_origin, &username)
        ),
        typ: "Collection",
        total_items: n,
    }))
}

// ─── POST /ap/users/{username}/inbox ───────────────────────────

async fn inbox(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(username): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }

    // Require a signature *before* doing any outbound work. The inbox triggers
    // an outbound actor fetch, so an unsigned request must never reach it —
    // otherwise any anonymous client can make us GET an arbitrary URL.
    let key_id = sign::signature_key_id(&headers).ok_or(AppError::Unauthorized)?;

    // Per-source rate limit (the fetch is the amplification vector).
    let ip = crate::middleware::client_ip::extract(&headers, Some(&peer))
        .map(|i| i.to_string())
        .unwrap_or_default();
    if !ip.is_empty() {
        let mut redis = state.redis.clone();
        let rkey = format!("rl:ap:inbox:{ip}");
        let count: u32 = redis.incr(&rkey, 1u32).await.unwrap_or(0);
        if count == 1 {
            let _: () = redis.expire(&rkey, 60).await.unwrap_or(());
        }
        if count > 60 {
            return Err(AppError::RateLimited);
        }
    }

    let user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1 AND role <> 'suspended'")
            .bind(&username)
            .fetch_optional(&state.pg)
            .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;

    let activity: IncomingActivity = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::BadRequest(format!("invalid AS2: {e}")))?;

    // The signing key must live on the same origin as the claimed actor, so a
    // request can't point keyId at one host and actor at another to make us
    // fetch an unrelated target.
    if !same_origin(&key_id, &activity.actor) {
        return Err(AppError::BadRequest(
            "signature keyId / actor host mismatch".into(),
        ));
    }

    let actor = fetch_actor(&state, &activity.actor)
        .await
        .map_err(|e| AppError::BadRequest(format!("fetch actor: {e}")))?;
    if key_id != actor.public_key_id {
        return Err(AppError::BadRequest("signature keyId mismatch".into()));
    }
    let path = format!("/ap/users/{username}/inbox");
    sign::verify_request("POST", &path, &headers, &bytes, &actor.public_key_pem)
        .map_err(|e| AppError::BadRequest(format!("signature: {e}")))?;

    if let Err(e) = handle_inbox(&state, user_id, activity).await {
        tracing::warn!(?e, "inbox dispatch failed");
    }
    Ok((StatusCode::ACCEPTED, "ok").into_response())
}

/// Same scheme + host + effective port for two URLs (origin equality).
fn same_origin(a: &str, b: &str) -> bool {
    match (url::Url::parse(a), url::Url::parse(b)) {
        (Ok(ua), Ok(ub)) => {
            ua.scheme() == ub.scheme()
                && ua.host_str() == ub.host_str()
                && ua.port_or_known_default() == ub.port_or_known_default()
        }
        _ => false,
    }
}

// ─── Webfinger ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct WfQuery {
    resource: String,
}

#[derive(Serialize)]
struct Webfinger {
    subject: String,
    aliases: Vec<String>,
    links: Vec<WfLink>,
}

#[derive(Serialize)]
struct WfLink {
    rel: &'static str,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    typ: Option<&'static str>,
    href: String,
}

pub async fn webfinger(
    State(state): State<AppState>,
    Query(q): Query<WfQuery>,
) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    // Accept `acct:user@host` (host must match our site)
    let resource = q.resource.trim();
    let acct = resource.strip_prefix("acct:").unwrap_or(resource);
    let (user_part, host_part) = acct
        .split_once('@')
        .ok_or(AppError::BadRequest("bad resource".into()))?;
    let our_host = state
        .config
        .site_origin
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("");
    if host_part != our_host {
        return Err(AppError::NotFound);
    }
    let exists: Option<bool> =
        sqlx::query_scalar("SELECT TRUE FROM users WHERE username = $1 AND role <> 'suspended'")
            .bind(user_part)
            .fetch_optional(&state.pg)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let site = state.config.site_origin.trim_end_matches('/');
    let actor = format!("{site}/ap/users/{user_part}");
    let profile = format!("{site}/u/{user_part}");
    let wf = Webfinger {
        subject: format!("acct:{user_part}@{our_host}"),
        aliases: vec![profile.clone(), actor.clone()],
        links: vec![
            WfLink {
                rel: "self",
                typ: Some(AP_CT),
                href: actor,
            },
            WfLink {
                rel: "http://webfinger.net/rel/profile-page",
                typ: Some("text/html"),
                href: profile,
            },
        ],
    };
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/jrd+json; charset=utf-8"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=600"),
    );
    Ok((StatusCode::OK, h, Json(wf)).into_response())
}

// ─── NodeInfo discovery + payload ──────────────────────────────

#[derive(Serialize)]
struct NodeInfoDiscovery {
    links: Vec<NodeInfoLink>,
}

#[derive(Serialize)]
struct NodeInfoLink {
    rel: &'static str,
    href: String,
}

#[derive(Serialize)]
struct NodeInfo {
    version: &'static str,
    software: NodeSoftware,
    protocols: Vec<&'static str>,
    services: NodeServices,
    #[serde(rename = "openRegistrations")]
    open_registrations: bool,
    usage: NodeUsage,
    metadata: serde_json::Value,
}

#[derive(Serialize)]
struct NodeSoftware {
    name: &'static str,
    version: &'static str,
    repository: &'static str,
}

#[derive(Serialize)]
struct NodeServices {
    inbound: Vec<&'static str>,
    outbound: Vec<&'static str>,
}

#[derive(Serialize)]
struct NodeUsage {
    users: NodeUsers,
    #[serde(rename = "localPosts")]
    local_posts: i64,
}

#[derive(Serialize)]
struct NodeUsers {
    total: i64,
    #[serde(rename = "activeMonth")]
    active_month: i64,
}

pub async fn nodeinfo_discovery(State(state): State<AppState>) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let site = state.config.site_origin.trim_end_matches('/');
    let body = NodeInfoDiscovery {
        links: vec![NodeInfoLink {
            rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
            href: format!("{site}/nodeinfo/2.1"),
        }],
    };
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    Ok((StatusCode::OK, h, Json(body)).into_response())
}

pub async fn nodeinfo(State(state): State<AppState>) -> Result<Response, AppError> {
    if !state.config.federation_enabled {
        return Ok(fed_off());
    }
    let total_users: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role <> 'suspended'")
            .fetch_one(&state.pg)
            .await
            .unwrap_or(0);
    let active_month: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT s.user_id)
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.last_seen_at > NOW() - interval '30 days'
          AND u.role <> 'suspended'
        "#,
    )
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    let posts: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
          AND u.role <> 'suspended'
        "#,
    )
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    let body = NodeInfo {
        version: "2.1",
        software: NodeSoftware {
            name: "burncpu",
            version: env!("CARGO_PKG_VERSION"),
            repository: "https://github.com/merbay-erp/burncpu",
        },
        protocols: vec!["activitypub"],
        services: NodeServices {
            inbound: vec![],
            outbound: vec![],
        },
        open_registrations: !std::env::var("INVITES_REQUIRED")
            .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false),
        usage: NodeUsage {
            users: NodeUsers {
                total: total_users,
                active_month,
            },
            local_posts: posts,
        },
        metadata: serde_json::json!({
            "manifesto": "1 VPS yeter",
        }),
    };
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(
            "application/json; profile=\"http://nodeinfo.diaspora.software/ns/schema/2.1#\"",
        ),
    );
    Ok((StatusCode::OK, h, Json(body)).into_response())
}
