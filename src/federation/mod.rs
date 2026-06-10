// ActivityPub federation core.
//
// Scope (MVP):
//   - Per-user RSA-2048 keypair (lazy-generated, encrypted at rest)
//   - HTTP Signatures: sign outbound POSTs, verify inbound POSTs
//   - Webfinger + Actor + Outbox + Followers/Following collections
//   - Inbox: handle Follow / Undo Follow, reply with Accept
//   - Fanout: local public Create → all remote follower inboxes
//
// Out of scope for this cut:
//   - Receiving Create/Like/Announce (we only accept Follow/Undo for now)
//   - sharedInbox optimisation (we POST per follower)
//   - Likes/Boosts in either direction
//   - Profile sync to remote
//
// All operations gated on cfg.federation_enabled. When false, every
// /ap/* / /.well-known/webfinger / /.well-known/nodeinfo returns 404.

pub mod sign;

use crate::{auth::totp, state::AppState};
use anyhow::{Result, anyhow};
use rsa::{
    RsaPrivateKey, RsaPublicKey,
    pkcs1::EncodeRsaPublicKey,
    pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding},
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::Utc;
use uuid::Uuid;

const AS_CTX: &str = "https://www.w3.org/ns/activitystreams";
const SEC_CTX: &str = "https://w3id.org/security/v1";
pub const PUBLIC_URI: &str = "https://www.w3.org/ns/activitystreams#Public";
pub const AP_CT: &str = "application/activity+json";
type ActorKeyRow = (Option<Vec<u8>>, Option<Vec<u8>>, Option<String>);

// ─── Per-user keypair (lazy-generated) ─────────────────────────

pub struct ActorKey {
    pub public_pem: String,
    pub private_pem: String,
}

pub async fn ensure_actor_key(state: &AppState, user_id: Uuid) -> Result<ActorKey> {
    // Fast path
    let row: Option<ActorKeyRow> = sqlx::query_as(
        "SELECT actor_private_key_encrypted, actor_private_key_nonce, actor_public_key_pem FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((enc, nonce, pubpem)) = row else {
        return Err(anyhow!("user not found"));
    };
    if let (Some(enc), Some(nonce), Some(pubpem)) = (enc.clone(), nonce.clone(), pubpem.clone()) {
        let priv_bytes = totp::decrypt_blob(&enc, &nonce)?;
        let private_pem = String::from_utf8(priv_bytes)?;
        return Ok(ActorKey {
            public_pem: pubpem,
            private_pem,
        });
    }

    // Generate fresh keypair (2048-bit, blocking-but-fast — spawn_blocking)
    let (priv_key, pub_key) =
        tokio::task::spawn_blocking(|| -> Result<(RsaPrivateKey, RsaPublicKey)> {
            let mut rng = rand::thread_rng();
            let priv_key =
                RsaPrivateKey::new(&mut rng, 2048).map_err(|e| anyhow!("rsa gen: {e}"))?;
            let pub_key = RsaPublicKey::from(&priv_key);
            Ok((priv_key, pub_key))
        })
        .await
        .map_err(|e| anyhow!("join: {e}"))??;

    let private_pem = priv_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| anyhow!("pkcs8: {e}"))?
        .to_string();
    let public_pem = pub_key
        .to_pkcs1_pem(LineEnding::LF)
        .map_err(|e| anyhow!("pkcs1: {e}"))?;

    let (enc, nonce) = totp::encrypt_blob(private_pem.as_bytes())?;
    sqlx::query(
        r#"
        UPDATE users SET
            actor_private_key_encrypted = $1,
            actor_private_key_nonce     = $2,
            actor_public_key_pem        = $3
        WHERE id = $4
        "#,
    )
    .bind(&enc)
    .bind(&nonce)
    .bind(&public_pem)
    .bind(user_id)
    .execute(&state.pg)
    .await?;

    Ok(ActorKey {
        public_pem,
        private_pem,
    })
}

pub fn load_private(pem: &str) -> Result<RsaPrivateKey> {
    RsaPrivateKey::from_pkcs8_pem(pem).map_err(|e| anyhow!("load priv: {e}"))
}

// ─── Actor JSON ────────────────────────────────────────────────

pub fn actor_url(site: &str, username: &str) -> String {
    format!("{}/ap/users/{}", site.trim_end_matches('/'), username)
}

#[derive(Serialize)]
pub struct ActorJson {
    #[serde(rename = "@context")]
    context: [&'static str; 2],
    id: String,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(rename = "preferredUsername")]
    preferred_username: String,
    name: String,
    summary: Option<String>,
    inbox: String,
    outbox: String,
    followers: String,
    following: String,
    url: String,
    #[serde(rename = "publicKey")]
    public_key: ActorPubKey,
}

#[derive(Serialize)]
pub struct ActorPubKey {
    id: String,
    owner: String,
    #[serde(rename = "publicKeyPem")]
    pem: String,
}

pub fn actor_json(
    site: &str,
    username: &str,
    display_name: &str,
    bio: Option<&str>,
    public_pem: &str,
) -> ActorJson {
    let id = actor_url(site, username);
    ActorJson {
        context: [AS_CTX, SEC_CTX],
        id: id.clone(),
        typ: "Person",
        preferred_username: username.to_string(),
        name: display_name.to_string(),
        summary: bio.map(|s| s.to_string()),
        inbox: format!("{id}/inbox"),
        outbox: format!("{id}/outbox"),
        followers: format!("{id}/followers"),
        following: format!("{id}/following"),
        url: format!("{}/u/{}", site.trim_end_matches('/'), username),
        public_key: ActorPubKey {
            id: format!("{id}#main-key"),
            owner: id.clone(),
            pem: public_pem.to_string(),
        },
    }
}

// ─── Inbox dispatcher ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct IncomingActivity {
    pub id: String,
    #[serde(rename = "type")]
    pub typ: String,
    pub actor: String,
    pub object: serde_json::Value,
}

pub async fn handle_inbox(
    state: &AppState,
    local_user_id: Uuid,
    activity: IncomingActivity,
) -> Result<()> {
    // De-dupe
    let inserted = sqlx::query(
        "INSERT INTO federation_activities (activity_id, kind, actor_uri, direction) VALUES ($1, $2, $3, 'in') ON CONFLICT DO NOTHING",
    )
    .bind(&activity.id)
    .bind(&activity.typ)
    .bind(&activity.actor)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(());
    }

    match activity.typ.as_str() {
        "Follow" => handle_follow(state, local_user_id, &activity).await,
        "Undo" => handle_undo(state, local_user_id, &activity).await,
        "Create" => handle_create(state, &activity).await,
        "Announce" => handle_announce(state, &activity).await,
        "Delete" => handle_delete(state, &activity).await,
        _ => {
            tracing::info!(kind = %activity.typ, actor = %activity.actor, "inbox: ignored");
            Ok(())
        }
    }
}

/// Ingest a remote Create (a remote actor's new post) into the federated explore
/// store. The activity is already signature-verified by the inbox route, so the
/// actor is authentic; we still drop host-blocked instances and sanitize the
/// content with the local ammonia allowlist (no scripts, no remote images).
async fn handle_create(state: &AppState, activity: &IncomingActivity) -> Result<()> {
    if let Some(host) = host_of(&activity.actor)
        && is_host_blocked(state, &host).await
    {
        return Ok(());
    }
    ingest_remote_note(state, &activity.object, &activity.actor).await;
    Ok(())
}

/// Store a remote `Note` object as a remote_post. Best-effort: malformed objects
/// are skipped, never erroring the inbox. content_html is sanitized at the door.
async fn ingest_remote_note(state: &AppState, object: &serde_json::Value, actor_uri: &str) {
    if object.get("type").and_then(|v| v.as_str()) != Some("Note") {
        return;
    }
    let uri = match object.get("id").and_then(|v| v.as_str()) {
        Some(u) if u.starts_with("https://") => u,
        _ => return,
    };
    let content_raw = object.get("content").and_then(|v| v.as_str()).unwrap_or("");
    if content_raw.trim().is_empty() {
        return;
    }
    // Cap before sanitizing so a hostile peer can't hand us a megabyte of HTML.
    let capped: String = content_raw.chars().take(8000).collect();
    let content_html = crate::content::sanitize_html(&capped);
    let author = object
        .get("attributedTo")
        .and_then(|v| v.as_str())
        .unwrap_or(actor_uri);
    let url = object.get("url").and_then(|v| v.as_str());
    let in_reply_to = object.get("inReplyTo").and_then(|v| v.as_str());
    let published = object
        .get("published")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        // Reject future timestamps — the explore feed orders by published_at, so
        // a back-/forward-dated post must not be able to pin itself to the top.
        // A future date falls back to NOW() via the INSERT's COALESCE.
        .filter(|d| *d <= chrono::Utc::now());
    let handle = host_of(author).map(|h| format!("@{h}"));

    let _ = sqlx::query(
        r#"
        INSERT INTO remote_posts (uri, actor_uri, actor_handle, content_html, url, in_reply_to, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
        ON CONFLICT (uri) DO NOTHING
        "#,
    )
    .bind(uri)
    .bind(author)
    .bind(handle)
    .bind(&content_html)
    .bind(url)
    .bind(in_reply_to)
    .bind(published)
    .execute(&state.pg)
    .await;
}

/// Ingest a remote Announce (a boost). The booster is signature-verified by the
/// inbox, but the *boosted* post lives on a third origin the booster doesn't
/// speak for — so we never trust the embedded/forwarded copy. We re-fetch the
/// post from its own canonical id (SSRF-safe) and ingest the origin's version,
/// which makes it impossible for a booster (or a relay) to forge content under
/// another instance's name.
async fn handle_announce(state: &AppState, activity: &IncomingActivity) -> Result<()> {
    let obj_uri = activity
        .object
        .as_str()
        .or_else(|| activity.object.get("id").and_then(|v| v.as_str()));
    let Some(obj_uri) = obj_uri else { return Ok(()) };
    ingest_remote_uri(state, obj_uri).await
}

/// Re-fetch a remote post from its own canonical origin and ingest it. The
/// caller was *told* about the post by a third party — a booster's Announce or a
/// relay's forwarded Create — that doesn't speak for it, so we never trust the
/// messenger's copy: GET the post from its own id, require the document to
/// self-identify as that id, attribute it to the origin's attributedTo, and
/// enforce host-blocks on both the post origin and the author.
async fn ingest_remote_uri(state: &AppState, obj_uri: &str) -> Result<()> {
    if !obj_uri.starts_with("https://") {
        return Ok(());
    }
    // Skip the outbound fetch if we already hold this post (popular boosts are
    // re-announced constantly — fetch once, not once per booster).
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM remote_posts WHERE uri = $1)")
            .bind(obj_uri)
            .fetch_one(&state.pg)
            .await
            .unwrap_or(false);
    if exists {
        return Ok(());
    }
    // Don't even fetch from a defederated origin.
    if let Some(host) = host_of(obj_uri)
        && is_host_blocked(state, &host).await
    {
        return Ok(());
    }
    let Ok(object) = fetch_remote_object(obj_uri).await else {
        return Ok(());
    };
    // No bait-and-switch: the document the origin served must self-identify as
    // the exact uri we asked for.
    if object.get("id").and_then(|v| v.as_str()) != Some(obj_uri) {
        return Ok(());
    }
    // The author is the original poster (attributedTo), never the booster.
    let author = object
        .get("attributedTo")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if author.is_empty() {
        return Ok(());
    }
    if let Some(host) = host_of(author)
        && is_host_blocked(state, &host).await
    {
        return Ok(());
    }
    ingest_remote_note(state, &object, author).await;
    Ok(())
}

/// SSRF-safe GET of a public ActivityPub object. Same guards as `fetch_actor`:
/// the URL is validated against private/loopback ranges, redirects are refused
/// (so a public→internal redirect can't slip past the check), and the body is
/// length-capped. Unsigned — public objects are world-readable.
async fn fetch_remote_object(uri: &str) -> Result<serde_json::Value> {
    let (http, safe_uri) = crate::net_safety::safe_client_for(
        uri,
        "burncpu-federation/0.1",
        std::time::Duration::from_secs(8),
    )
    .await?;
    let resp = http
        .get(safe_uri.as_str())
        .header(reqwest::header::ACCEPT, AP_CT)
        .send()
        .await?
        .error_for_status()?;
    let raw = crate::net_safety::read_capped_bytes(resp, 256 * 1024).await?;
    Ok(serde_json::from_slice(&raw)?)
}

/// A remote Delete tombstones one of its own posts.
async fn handle_delete(state: &AppState, activity: &IncomingActivity) -> Result<()> {
    let uri = activity
        .object
        .as_str()
        .or_else(|| activity.object.get("id").and_then(|v| v.as_str()));
    if let Some(uri) = uri {
        // An actor may only delete its own post.
        let _ = sqlx::query("DELETE FROM remote_posts WHERE uri = $1 AND actor_uri = $2")
            .bind(uri)
            .bind(&activity.actor)
            .execute(&state.pg)
            .await;
    }
    Ok(())
}

async fn handle_follow(
    state: &AppState,
    local_user_id: Uuid,
    activity: &IncomingActivity,
) -> Result<()> {
    // Fetch / cache the actor
    let actor = fetch_actor(state, &activity.actor).await?;
    sqlx::query(
        r#"
        INSERT INTO federation_followers (local_user_id, remote_actor_uri, accepted)
        VALUES ($1, $2, true)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(local_user_id)
    .bind(&actor.uri)
    .execute(&state.pg)
    .await?;

    // Reply with Accept activity
    let username = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(local_user_id)
        .fetch_one(&state.pg)
        .await?;
    let key = ensure_actor_key(state, local_user_id).await?;
    let actor_uri = actor_url(&state.config.site_origin, &username);
    let accept = serde_json::json!({
        "@context": AS_CTX,
        "id": format!("{actor_uri}#accepts/{}", uuid::Uuid::new_v4()),
        "type": "Accept",
        "actor": actor_uri.clone(),
        "object": {
            "id": activity.id,
            "type": "Follow",
            "actor": activity.actor,
            "object": actor_uri.clone(),
        },
    });
    sign::deliver(&state.config, &key, &actor_uri, &actor.inbox, &accept).await?;
    tracing::info!(actor = %activity.actor, "federation: Accept sent");
    Ok(())
}

async fn handle_undo(
    state: &AppState,
    local_user_id: Uuid,
    activity: &IncomingActivity,
) -> Result<()> {
    // We only honour Undo Follow for now
    if activity.object.get("type").and_then(|v| v.as_str()) != Some("Follow") {
        return Ok(());
    }
    sqlx::query(
        "DELETE FROM federation_followers WHERE local_user_id = $1 AND remote_actor_uri = $2",
    )
    .bind(local_user_id)
    .bind(&activity.actor)
    .execute(&state.pg)
    .await?;
    Ok(())
}

// ─── Remote actor fetch + cache ────────────────────────────────

pub struct RemoteActor {
    pub uri: String,
    pub inbox: String,
    pub public_key_id: String,
    pub public_key_pem: String,
}

pub async fn fetch_actor(state: &AppState, uri: &str) -> Result<RemoteActor> {
    let cached: Option<(String, String, String)> = sqlx::query_as(
        "SELECT inbox, public_key_id, public_key_pem FROM federation_actors WHERE uri = $1 AND fetched_at > NOW() - interval '7 days'",
    )
    .bind(uri)
    .fetch_optional(&state.pg)
    .await?;
    if let Some((inbox, kid, pem)) = cached {
        return Ok(RemoteActor {
            uri: uri.to_string(),
            inbox,
            public_key_id: kid,
            public_key_pem: pem,
        });
    }

    let (http, safe_uri) = crate::net_safety::safe_client_for(
        uri,
        "burncpu-federation/0.1",
        std::time::Duration::from_secs(8),
    )
    .await?;
    let resp = http
        .get(safe_uri.as_str())
        .header(reqwest::header::ACCEPT, AP_CT)
        .send()
        .await?
        .error_for_status()?;
    // Cap the actor document with a streaming read — a hostile (or compromised)
    // peer shouldn't be able to stream an unbounded body into memory before we
    // notice it's too big.
    let raw = crate::net_safety::read_capped_bytes(resp, 256 * 1024).await?;
    let body: serde_json::Value = serde_json::from_slice(&raw)?;
    let inbox = body
        .get("inbox")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("no inbox"))?
        .to_string();
    let shared_inbox = body
        .get("endpoints")
        .and_then(|e| e.get("sharedInbox"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    crate::net_safety::validate_public_http_url(&inbox).await?;
    if let Some(ref inbox) = shared_inbox {
        crate::net_safety::validate_public_http_url(inbox).await?;
    }
    let pk = body
        .get("publicKey")
        .ok_or_else(|| anyhow!("no publicKey"))?;
    let pk_id = pk
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("no publicKey.id"))?
        .to_string();
    let pk_pem = pk
        .get("publicKeyPem")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("no publicKeyPem"))?
        .to_string();
    let username = body
        .get("preferredUsername")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let host = uri
        .strip_prefix("https://")
        .or_else(|| uri.strip_prefix("http://"))
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();

    sqlx::query(
        r#"
        INSERT INTO federation_actors (uri, username, host, inbox, shared_inbox, public_key_pem, public_key_id, actor_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (uri) DO UPDATE SET
            inbox = EXCLUDED.inbox,
            shared_inbox = EXCLUDED.shared_inbox,
            public_key_pem = EXCLUDED.public_key_pem,
            public_key_id = EXCLUDED.public_key_id,
            actor_json = EXCLUDED.actor_json,
            fetched_at = NOW()
        "#,
    )
    .bind(uri)
    .bind(&username)
    .bind(&host)
    .bind(&inbox)
    .bind(&shared_inbox)
    .bind(&pk_pem)
    .bind(&pk_id)
    .bind(&body)
    .execute(&state.pg)
    .await?;

    Ok(RemoteActor {
        uri: uri.to_string(),
        inbox,
        public_key_id: pk_id,
        public_key_pem: pk_pem,
    })
}

// ─── Outbound: fan a local public Create to remote followers ──

/// Extract the lowercased host from an actor/object URI.
pub fn host_of(uri: &str) -> Option<String> {
    url::Url::parse(uri)
        .ok()?
        .host_str()
        .map(|h| h.to_lowercase())
}

/// Whether an instance is defederated (admin blocklist). Fail-open: a transient
/// DB error must not silently sever all federation.
pub async fn is_host_blocked(state: &AppState, host: &str) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM federation_blocks WHERE host = $1)")
        .bind(host)
        .fetch_one(&state.pg)
        .await
        .unwrap_or(false)
}

pub async fn fanout_post(state: &AppState, post_id: Uuid) {
    if !state.config.federation_enabled {
        return;
    }
    let row: Option<(
        Uuid,
        String,
        String,
        String,
        sqlx::types::chrono::DateTime<Utc>,
    )> = sqlx::query_as(
        r#"
        SELECT p.author_id, u.username, p.body, p.body_html, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL AND p.moderation_state = 'live'
              AND p.visibility = 'public'
              AND u.role <> 'suspended'
        "#,
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();
    let Some((author_id, username, _body, body_html, created_at)) = row else {
        return;
    };

    let inboxes: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT COALESCE(a.shared_inbox, a.inbox)
        FROM federation_followers f
        JOIN federation_actors a ON a.uri = f.remote_actor_uri
        WHERE f.local_user_id = $1 AND f.accepted = true
          AND a.host NOT IN (SELECT host FROM federation_blocks)
        "#,
    )
    .bind(author_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    if inboxes.is_empty() {
        return;
    }

    let key = match ensure_actor_key(state, author_id).await {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!(?e, "fanout: actor key");
            return;
        }
    };
    let actor_uri = actor_url(&state.config.site_origin, &username);
    let object_id = format!(
        "{}/posts/{post_id}",
        state.config.site_origin.trim_end_matches('/')
    );
    let create = serde_json::json!({
        "@context": AS_CTX,
        "id": format!("{object_id}#create"),
        "type": "Create",
        "actor": actor_uri.clone(),
        "to": [PUBLIC_URI],
        "cc": [format!("{actor_uri}/followers")],
        "published": created_at,
        "object": {
            "id": object_id.clone(),
            "type": "Note",
            "attributedTo": actor_uri.clone(),
            "content": body_html,
            "published": created_at,
            "to": [PUBLIC_URI],
            "url": object_id,
        },
    });

    // Log out
    let _ = sqlx::query(
        "INSERT INTO federation_activities (activity_id, kind, actor_uri, direction) VALUES ($1, 'Create', $2, 'out')",
    )
    .bind(format!("{object_id}#create"))
    .bind(&actor_uri)
    .execute(&state.pg)
    .await;

    let cfg = state.config.clone();
    let key_clone = ActorKey {
        public_pem: key.public_pem.clone(),
        private_pem: key.private_pem.clone(),
    };
    tokio::spawn(async move {
        for inbox in inboxes {
            let _ = sign::deliver(&cfg, &key_clone, &actor_uri, &inbox, &create).await;
        }
    });
}

// ═══ Instance actor + relays ═══════════════════════════════════════
//
// A singleton "Application" actor (distinct from per-user actors) used to
// subscribe to relays and receive their firehose. Relay-forwarded activities are
// signed by the *relay*, not the original author (signer ≠ actor) — so the inbox
// verifies the relay's signature, and content is re-fetched from its own origin
// (ingest_remote_uri) before storing. Relays are admin-added only; nothing is
// auto-subscribed, so the firehose is never enabled by surprise.

pub fn instance_actor_url(site: &str) -> String {
    format!("{}/ap/instance", site.trim_end_matches('/'))
}

/// Lazily generate + cache the singleton instance keypair (RSA-2048, encrypted at
/// rest), mirroring `ensure_actor_key` but for the one-row `instance_actor`.
pub async fn ensure_instance_key(state: &AppState) -> Result<ActorKey> {
    let row: Option<(Vec<u8>, Vec<u8>, String)> = sqlx::query_as(
        "SELECT private_key_encrypted, private_key_nonce, public_key_pem FROM instance_actor WHERE id = true",
    )
    .fetch_optional(&state.pg)
    .await?;
    if let Some((enc, nonce, pubpem)) = row {
        let private_pem = String::from_utf8(totp::decrypt_blob(&enc, &nonce)?)?;
        return Ok(ActorKey { public_pem: pubpem, private_pem });
    }

    let (priv_key, pub_key) =
        tokio::task::spawn_blocking(|| -> Result<(RsaPrivateKey, RsaPublicKey)> {
            let mut rng = rand::thread_rng();
            let priv_key =
                RsaPrivateKey::new(&mut rng, 2048).map_err(|e| anyhow!("rsa gen: {e}"))?;
            let pub_key = RsaPublicKey::from(&priv_key);
            Ok((priv_key, pub_key))
        })
        .await
        .map_err(|e| anyhow!("join: {e}"))??;
    let private_pem = priv_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| anyhow!("pkcs8: {e}"))?
        .to_string();
    let public_pem = pub_key
        .to_pkcs1_pem(LineEnding::LF)
        .map_err(|e| anyhow!("pkcs1: {e}"))?;
    let (enc, nonce) = totp::encrypt_blob(private_pem.as_bytes())?;
    sqlx::query(
        "INSERT INTO instance_actor (id, private_key_encrypted, private_key_nonce, public_key_pem) VALUES (true, $1, $2, $3) ON CONFLICT (id) DO NOTHING",
    )
    .bind(&enc)
    .bind(&nonce)
    .bind(&public_pem)
    .execute(&state.pg)
    .await?;
    // Re-read the canonical row in case a concurrent request won the insert.
    let (enc, nonce, pubpem): (Vec<u8>, Vec<u8>, String) = sqlx::query_as(
        "SELECT private_key_encrypted, private_key_nonce, public_key_pem FROM instance_actor WHERE id = true",
    )
    .fetch_one(&state.pg)
    .await?;
    let private_pem = String::from_utf8(totp::decrypt_blob(&enc, &nonce)?)?;
    Ok(ActorKey { public_pem: pubpem, private_pem })
}

/// The instance actor document (type Application).
pub async fn instance_actor_json(state: &AppState) -> Result<ActorJson> {
    let key = ensure_instance_key(state).await?;
    let site = &state.config.site_origin;
    let id = instance_actor_url(site);
    let host = host_of(site).unwrap_or_else(|| "instance".to_string());
    Ok(ActorJson {
        context: [AS_CTX, SEC_CTX],
        id: id.clone(),
        typ: "Application",
        preferred_username: host.clone(),
        name: host,
        summary: None,
        inbox: format!("{id}/inbox"),
        outbox: format!("{id}/outbox"),
        followers: format!("{id}/followers"),
        following: format!("{id}/following"),
        url: id.clone(),
        public_key: ActorPubKey {
            id: format!("{id}#main-key"),
            owner: id.clone(),
            pem: key.public_pem,
        },
    })
}

/// Whether `actor_uri` is a relay we've subscribed to and that has accepted.
async fn is_active_relay(state: &AppState, actor_uri: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM federation_relays WHERE actor_uri = $1 AND state = 'active')",
    )
    .bind(actor_uri)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false)
}

async fn mark_relay_accepted(state: &AppState, signer_uri: &str) -> Result<()> {
    sqlx::query(
        "UPDATE federation_relays SET state = 'active', accepted_at = NOW() WHERE actor_uri = $1 AND state = 'pending'",
    )
    .bind(signer_uri)
    .execute(&state.pg)
    .await?;
    Ok(())
}

/// Dispatch a signature-verified activity from the instance inbox (relay
/// firehose). `signer_uri` is the actor whose key signed the request (the relay).
pub async fn handle_instance_inbox(
    state: &AppState,
    signer_uri: &str,
    activity: IncomingActivity,
) -> Result<()> {
    let inserted = sqlx::query(
        "INSERT INTO federation_activities (activity_id, kind, actor_uri, direction) VALUES ($1, $2, $3, 'in') ON CONFLICT DO NOTHING",
    )
    .bind(&activity.id)
    .bind(&activity.typ)
    .bind(&activity.actor)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(());
    }

    // The relay accepting our Follow activates the subscription.
    if activity.typ == "Accept" {
        return mark_relay_accepted(state, signer_uri).await;
    }

    // Beyond Accept, only a relay we actually subscribed to may drive ingestion.
    // The origin re-fetch already prevents forgery, but this stops an arbitrary
    // signed actor from POSTing Creates to make us fetch+store content at will.
    if !is_active_relay(state, signer_uri).await {
        return Ok(());
    }

    match activity.typ.as_str() {
        "Create" => {
            let uri = activity
                .object
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| activity.object.as_str());
            match uri {
                Some(u) => ingest_remote_uri(state, u).await,
                None => Ok(()),
            }
        }
        "Announce" => handle_announce(state, &activity).await,
        "Delete" => handle_delete(state, &activity).await,
        _ => Ok(()),
    }
}

/// Subscribe to a relay: fetch its actor (inbox + key), record it pending, and
/// POST a Follow signed by the instance actor. Convention: Follow the public
/// collection (`as:Public`), which modern relays interpret as "send me the feed".
pub async fn subscribe_relay(state: &AppState, relay_actor_uri: &str) -> Result<()> {
    let key = ensure_instance_key(state).await?;
    let relay = fetch_actor(state, relay_actor_uri).await?;
    let instance_uri = instance_actor_url(&state.config.site_origin);
    let follow_id = format!("{instance_uri}#follows/{}", uuid::Uuid::new_v4());
    let follow = serde_json::json!({
        "@context": AS_CTX,
        "id": follow_id,
        "type": "Follow",
        "actor": instance_uri,
        "object": PUBLIC_URI,
        "to": [relay.uri.clone()],
    });
    sqlx::query(
        "INSERT INTO federation_relays (actor_uri, inbox, state, follow_id) VALUES ($1, $2, 'pending', $3) ON CONFLICT (actor_uri) DO UPDATE SET inbox = EXCLUDED.inbox, state = 'pending', follow_id = EXCLUDED.follow_id, subscribed_at = NOW(), accepted_at = NULL",
    )
    .bind(&relay.uri)
    .bind(&relay.inbox)
    .bind(&follow_id)
    .execute(&state.pg)
    .await?;
    sign::deliver(&state.config, &key, &instance_uri, &relay.inbox, &follow).await?;
    Ok(())
}

/// Unsubscribe: mark the relay disabled and best-effort POST an Undo Follow.
pub async fn unsubscribe_relay(state: &AppState, relay_actor_uri: &str) -> Result<()> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT inbox, follow_id FROM federation_relays WHERE actor_uri = $1")
            .bind(relay_actor_uri)
            .fetch_optional(&state.pg)
            .await?;
    let Some((inbox, follow_id)) = row else {
        return Ok(());
    };
    sqlx::query("UPDATE federation_relays SET state = 'disabled' WHERE actor_uri = $1")
        .bind(relay_actor_uri)
        .execute(&state.pg)
        .await?;
    let key = ensure_instance_key(state).await?;
    let instance_uri = instance_actor_url(&state.config.site_origin);
    let undo = serde_json::json!({
        "@context": AS_CTX,
        "id": format!("{instance_uri}#undo/{}", uuid::Uuid::new_v4()),
        "type": "Undo",
        "actor": instance_uri,
        "object": {
            "id": follow_id,
            "type": "Follow",
            "actor": instance_uri,
            "object": PUBLIC_URI,
        },
    });
    let _ = sign::deliver(&state.config, &key, &instance_uri, &inbox, &undo).await;
    Ok(())
}
