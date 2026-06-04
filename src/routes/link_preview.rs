//! Link previews ("unfurls"): given a URL found in a post body, fetch the
//! remote page and extract Open Graph / Twitter Card / <title> metadata so the
//! client can render a rich preview card.
//!
//! Safety is the whole game here — the server fetches *user-supplied* URLs, so
//! every request goes through `net_safety::safe_client_for` (scheme allowlist,
//! credential rejection, DNS resolution + private/loopback/link-local IP block,
//! and IP pinning to defeat DNS-rebinding). Redirects are disabled at the
//! client level and followed manually so each hop is re-validated. The response
//! body is read with a hard byte cap, only `text/html` is parsed, and the whole
//! thing is auth-gated + per-user rate-limited so we never become an open proxy.
//!
//! Results (including "no preview") are cached in redis with a TTL so a popular
//! link is fetched once, not once per render.

use crate::{
    errors::AppError,
    middleware::{client_ip, session::CurrentUser},
    net_safety,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Query, State},
    http::HeaderMap,
    routing::get,
};
use futures_util::StreamExt;
use redis::AsyncCommands;
use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

// Classic "Mozilla/5.0 (compatible; …)" crawler shape — still honestly identifies
// burncpu, but WAFs / bot-managers (e.g. Cloudflare) wave it through far more
// reliably than a bare `burncpubot/1.0`, which some challenge as an unknown bot.
const UA: &str = "Mozilla/5.0 (compatible; burncpubot/1.0; +https://burncpu.com)";
const FETCH_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_BYTES: usize = 768 * 1024; // plenty for any <head>
const MAX_REDIRECTS: usize = 4;
const CACHE_TTL_OK: u64 = 7 * 24 * 3600; // 7 days — a real preview
const CACHE_TTL_NULL: u64 = 6 * 3600; // 6 hours — fetched cleanly, page simply has no preview
const CACHE_TTL_FAIL: u64 = 5 * 60; // 5 min — a *fetch failure* (timeout/blocked/5xx); retry soon
const RL_WINDOW_SECS: i64 = 60;
const RL_MAX_USER: i64 = 40; // real fetches per logged-in user per minute (cache hits are free)
const RL_MAX_ANON: i64 = 15; // stricter per-IP cap for anonymous timeline viewers

const TITLE_MAX: usize = 200;
const DESC_MAX: usize = 360;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_preview))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkPreview {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
}

#[derive(Deserialize)]
pub struct PreviewQuery {
    pub url: String,
}

#[derive(Serialize)]
pub struct PreviewResponse {
    pub preview: Option<LinkPreview>,
}

pub async fn get_preview(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PreviewQuery>,
) -> Result<Json<PreviewResponse>, AppError> {
    let raw = q.url.trim();
    if raw.is_empty() || raw.len() > 2048 {
        return Err(AppError::BadRequest("url is required (max 2048 chars)".into()));
    }
    // Reject anything that isn't a public http(s) URL up front — cheap, and keeps
    // junk out of the cache. (Full SSRF validation happens again per fetch hop.)
    let normalized = match net_safety::validate_public_http_url(raw).await {
        Ok(u) => u.to_string(),
        Err(_) => {
            // Not fetchable (private host, bad scheme, unresolved…) — treat as "no
            // preview" rather than an error so the client just renders nothing.
            return Ok(Json(PreviewResponse { preview: None }));
        }
    };

    let mut redis = state.redis.clone();
    let key = format!("lp:{}", hex_sha256(&normalized));

    // Cache hit (a cached `null` is a valid, meaningful answer).
    if let Ok(Some(cached)) = redis.get::<_, Option<String>>(&key).await
        && let Ok(preview) = serde_json::from_str::<Option<LinkPreview>>(&cached)
    {
        return Ok(Json(PreviewResponse { preview }));
    }

    // Rate-limit only the expensive path (cache misses → real outbound fetches).
    // Keyed per-user when signed in, else per-IP with a tighter cap.
    let (rl_key, rl_max) = match &user {
        Some(u) => (format!("lp:rl:u:{}", u.user_id), RL_MAX_USER),
        None => {
            let ip = client_ip::extract(&headers, Some(&peer))
                .map(|i| i.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            (format!("lp:rl:ip:{ip}"), RL_MAX_ANON)
        }
    };
    let hits: i64 = redis.incr(&rl_key, 1).await?;
    if hits == 1 {
        let _: () = redis.expire(&rl_key, RL_WINDOW_SECS).await?;
    }
    if hits > rl_max {
        return Err(AppError::RateLimited);
    }

    // Distinguish a clean "no preview here" (cache a while) from a *fetch failure*
    // — timeout, momentary bot challenge, 5xx — which is usually transient and must
    // NOT hide the preview for hours: cache it only briefly so the next view retries.
    let (preview, ttl) = match resolve_inner(&normalized).await {
        Ok(Some(p)) => (Some(p), CACHE_TTL_OK),
        Ok(None) => (None, CACHE_TTL_NULL),
        Err(e) => {
            tracing::debug!(error = %e, url = %normalized, "link preview fetch failed");
            (None, CACHE_TTL_FAIL)
        }
    };
    let serialized = serde_json::to_string(&preview).unwrap_or_else(|_| "null".to_string());
    let _: () = redis.set_ex(&key, serialized, ttl).await?;

    Ok(Json(PreviewResponse { preview }))
}

async fn resolve_inner(raw: &str) -> anyhow::Result<Option<LinkPreview>> {
    let mut current = raw.to_string();
    let mut hops = 0usize;

    loop {
        // Re-validate + IP-pin on every hop: a 30x can point anywhere.
        let (client, url) = net_safety::safe_client_for(&current, UA, FETCH_TIMEOUT).await?;
        let resp = client
            .get(url.clone())
            .header(ACCEPT, "text/html,application/xhtml+xml,*/*;q=0.8")
            .send()
            .await?;

        let status = resp.status();
        if status.is_redirection() {
            hops += 1;
            if hops > MAX_REDIRECTS {
                anyhow::bail!("too many redirects");
            }
            let loc = resp
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| anyhow::anyhow!("redirect without Location"))?;
            current = url.join(loc)?.to_string();
            continue;
        }
        if !status.is_success() {
            anyhow::bail!("non-success status {status}");
        }

        // Only parse HTML. Empty content-type → try anyway (some servers omit it).
        if let Some(ct) = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
            let ct = ct.to_ascii_lowercase();
            if !ct.is_empty() && !ct.contains("html") && !ct.contains("xml") {
                return Ok(None);
            }
        }

        let body = read_capped(resp, MAX_BYTES).await?;
        return Ok(parse_metadata(&body, &url));
    }
}

/// Read the response body but never buffer more than `cap` bytes.
async fn read_capped(resp: reqwest::Response, cap: usize) -> anyhow::Result<String> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if buf.len() + chunk.len() >= cap {
            let take = cap.saturating_sub(buf.len());
            buf.extend_from_slice(&chunk[..take]);
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

// ── Metadata extraction ─────────────────────────────────────────────────────
// OG / Twitter / <title> tags are simple, machine-generated markup, so a couple
// of focused regexes beat pulling a whole DOM stack into the build. We only scan
// the <head> to avoid picking up stray attributes from page content.

fn meta_tag_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?is)<meta\b[^>]*>").unwrap())
}
fn link_tag_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?is)<link\b[^>]*>").unwrap())
}
fn title_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap())
}
fn attr_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r#"(?is)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#,
        )
        .unwrap()
    })
}

/// Parse `key="value"` attributes out of a single tag string.
fn attrs_of(tag: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for c in attr_re().captures_iter(tag) {
        let k = c.get(1).map(|m| m.as_str().to_ascii_lowercase());
        let v = c
            .get(2)
            .or_else(|| c.get(3))
            .or_else(|| c.get(4))
            .map(|m| m.as_str().to_string());
        if let (Some(k), Some(v)) = (k, v) {
            map.entry(k).or_insert(v);
        }
    }
    map
}

fn parse_metadata(html: &str, final_url: &Url) -> Option<LinkPreview> {
    // Restrict to <head> when present — that's where all the metadata lives.
    let head = match html.to_ascii_lowercase().find("</head>") {
        Some(idx) => &html[..idx],
        None => html,
    };

    let mut og: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut named: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for m in meta_tag_re().find_iter(head) {
        let a = attrs_of(m.as_str());
        let content = match a.get("content") {
            Some(c) if !c.trim().is_empty() => clean_text(c),
            _ => continue,
        };
        if content.is_empty() {
            continue;
        }
        if let Some(prop) = a.get("property") {
            og.entry(prop.to_ascii_lowercase()).or_insert(content);
        } else if let Some(name) = a.get("name") {
            named.entry(name.to_ascii_lowercase()).or_insert(content);
        }
    }

    let pick = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = og.get(*k).or_else(|| named.get(*k))
                && !v.is_empty()
            {
                return Some(v.clone());
            }
        }
        None
    };

    let mut title = pick(&["og:title", "twitter:title"]);
    if title.is_none()
        && let Some(c) = title_re().captures(head)
    {
        let t = clean_text(&c[1]);
        if !t.is_empty() {
            title = Some(t);
        }
    }
    let description = pick(&["og:description", "twitter:description", "description"]);
    let image_raw = pick(&[
        "og:image",
        "og:image:url",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
    ]);
    let site_name = pick(&["og:site_name", "application-name"])
        .or_else(|| final_url.host_str().map(|h| h.trim_start_matches("www.").to_string()));

    let image = image_raw.and_then(|i| absolutize(final_url, &i));
    let favicon = find_favicon(head, final_url);

    // A card with neither a title nor an image is useless — signal "no preview".
    if title.is_none() && image.is_none() {
        return None;
    }

    Some(LinkPreview {
        url: final_url.to_string(),
        title: title.map(|t| clamp(&t, TITLE_MAX)),
        description: description.map(|d| clamp(&d, DESC_MAX)),
        image,
        site_name,
        favicon,
    })
}

fn find_favicon(head: &str, base: &Url) -> Option<String> {
    let mut apple: Option<String> = None;
    let mut icon: Option<String> = None;
    for m in link_tag_re().find_iter(head) {
        let a = attrs_of(m.as_str());
        let rel = a.get("rel").map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        let href = match a.get("href") {
            Some(h) if !h.trim().is_empty() => h,
            _ => continue,
        };
        if rel.contains("apple-touch-icon") {
            apple.get_or_insert_with(|| href.clone());
        } else if rel.contains("icon") {
            icon.get_or_insert_with(|| href.clone());
        }
    }
    let chosen = apple.or(icon)?;
    absolutize(base, &chosen)
}

/// Resolve a possibly-relative URL against the page URL; keep only http(s).
fn absolutize(base: &Url, raw: &str) -> Option<String> {
    let raw = decode_entities(raw.trim());
    let joined = base.join(&raw).ok()?;
    match joined.scheme() {
        "http" | "https" => Some(joined.to_string()),
        _ => None,
    }
}

fn clean_text(s: &str) -> String {
    let decoded = decode_entities(s);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Decode the handful of HTML entities that actually show up in OG/meta values.
fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&'
            && let Some(semi) = s[i..].find(';').map(|p| i + p)
            && semi - i <= 12
        {
            let ent = &s[i + 1..semi];
            let replaced = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                    u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32)
                }
                _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(ch) = replaced {
                out.push(ch);
                i = semi + 1;
                continue;
            }
        }
        // copy this byte as part of a UTF-8 char
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&s[i..(i + ch_len).min(s.len())]);
        i += ch_len;
    }
    out
}

fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

fn hex_sha256(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    let digest = h.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn extracts_open_graph() {
        let html = r#"<html><head>
            <title>Fallback Title</title>
            <meta property="og:title" content="Real &amp; Proper Title">
            <meta property="og:description" content="A short  description here.">
            <meta property="og:image" content="/img/cover.png">
            <meta property="og:site_name" content="Example">
            <link rel="icon" href="/favicon.ico">
          </head><body>noise</body></html>"#;
        let p = parse_metadata(html, &url("https://example.com/post/1")).unwrap();
        assert_eq!(p.title.as_deref(), Some("Real & Proper Title"));
        assert_eq!(p.description.as_deref(), Some("A short description here."));
        assert_eq!(p.image.as_deref(), Some("https://example.com/img/cover.png"));
        assert_eq!(p.site_name.as_deref(), Some("Example"));
        assert_eq!(p.favicon.as_deref(), Some("https://example.com/favicon.ico"));
    }

    #[test]
    fn reversed_attribute_order_and_twitter_fallback() {
        let html = r#"<head>
            <meta content="Tweeted Title" name="twitter:title">
            <meta name="twitter:image" content="https://cdn.example.com/x.jpg">
          </head>"#;
        let p = parse_metadata(html, &url("https://example.com/")).unwrap();
        assert_eq!(p.title.as_deref(), Some("Tweeted Title"));
        assert_eq!(p.image.as_deref(), Some("https://cdn.example.com/x.jpg"));
    }

    #[test]
    fn title_only_falls_back_to_title_tag() {
        let html = "<head><title>Just A Title</title></head>";
        let p = parse_metadata(html, &url("https://example.com/")).unwrap();
        assert_eq!(p.title.as_deref(), Some("Just A Title"));
        assert_eq!(p.site_name.as_deref(), Some("example.com"));
    }

    #[test]
    fn no_metadata_yields_none() {
        let html = "<head><meta name=\"viewport\" content=\"width=device-width\"></head>";
        assert!(parse_metadata(html, &url("https://example.com/")).is_none());
    }

    #[test]
    fn numeric_entities_decode() {
        assert_eq!(decode_entities("a &#38; b &#x27;c&#x27;"), "a & b 'c'");
        assert_eq!(decode_entities("plain text"), "plain text");
    }

    // Real network fetch through the full SSRF-guarded path. Ignored so CI only
    // compiles it; run locally with `--ignored --nocapture` to eyeball output.
    #[tokio::test]
    #[ignore = "hits the network"]
    async fn live_blog_unfurl() {
        let p = resolve_inner(
            "https://mustafaerbay.com.tr/blog/career/ai-agent-tool-use-siniri-mimari-secimlerin-maliyeti/",
        )
        .await
        .expect("fetch should succeed")
        .expect("expected a preview");
        eprintln!("{p:#?}");
        assert!(p.title.as_deref().unwrap_or("").contains("Tool-Use"));
        assert!(p.image.is_some());
        assert_eq!(p.site_name.as_deref(), Some("Mustafa Erbay"));
    }
}
