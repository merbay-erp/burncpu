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
        _ => {
            tracing::info!(kind = %activity.typ, actor = %activity.actor, "inbox: ignored");
            Ok(())
        }
    }
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
    let body: serde_json::Value = resp.json().await?;
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
