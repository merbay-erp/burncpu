// HTTP Signatures (cavage / draft-ietf-httpbis) — the legacy variant the
// ActivityPub ecosystem actually deploys.
//
//   Signature: keyId="...#main-key",algorithm="rsa-sha256",
//              headers="(request-target) host date digest",
//              signature="<base64 RSA-SHA256(signing-string)>"
//
// signing-string = "(request-target): post /inbox\nhost: example\ndate: ...\ndigest: SHA-256=..."

use crate::{
    config::Config,
    federation::{AP_CT, ActorKey, load_private},
};
use anyhow::{Result, anyhow};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use rsa::{
    RsaPublicKey,
    pkcs1::DecodeRsaPublicKey,
    pkcs1v15::{Signature, SigningKey, VerifyingKey},
    pkcs8::DecodePublicKey,
    signature::{RandomizedSigner, SignatureEncoding, Verifier},
};
use sha2::{Digest, Sha256};

pub async fn deliver(
    cfg: &Config,
    key: &ActorKey,
    actor_uri: &str,
    inbox_url: &str,
    body: &serde_json::Value,
) -> Result<()> {
    let ua = format!(
        "burncpu-federation/0.1 ({}/inbox-delivery)",
        cfg.site_origin
    );
    let (client, url) =
        crate::net_safety::safe_client_for(inbox_url, &ua, std::time::Duration::from_secs(8))
            .await?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("no host"))?
        .to_string();
    let path = if let Some(q) = url.query() {
        format!("{}?{}", url.path(), q)
    } else {
        url.path().to_string()
    };

    let body_bytes = serde_json::to_vec(body)?;
    let digest = format!("SHA-256={}", B64.encode(Sha256::digest(&body_bytes)));
    let date = httpdate::fmt_http_date(std::time::SystemTime::now());
    let signing_string =
        format!("(request-target): post {path}\nhost: {host}\ndate: {date}\ndigest: {digest}");

    let priv_key = load_private(&key.private_pem)?;
    let signer: SigningKey<Sha256> = SigningKey::new(priv_key);
    let mut rng = rand::rngs::OsRng;
    let sig: Signature = signer.sign_with_rng(&mut rng, signing_string.as_bytes());
    let sig_b64 = B64.encode(sig.to_bytes());
    let key_id = format!("{actor_uri}#main-key");
    let signature_header = format!(
        "keyId=\"{key_id}\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"{sig_b64}\""
    );

    let resp = client
        .post(url.as_str())
        .header(reqwest::header::CONTENT_TYPE, AP_CT)
        .header(reqwest::header::ACCEPT, AP_CT)
        .header(reqwest::header::HOST, host.clone())
        .header(reqwest::header::DATE, date.clone())
        .header("Digest", digest.clone())
        .header("Signature", signature_header)
        .body(body_bytes)
        .send()
        .await?;
    let status = resp.status();
    let snippet = resp
        .text()
        .await
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect::<String>();
    if !status.is_success() {
        tracing::warn!(%status, %inbox_url, snippet, "federation: inbox delivery non-2xx");
        return Err(anyhow!("inbox returned {status}"));
    }
    tracing::debug!(%status, %inbox_url, "federation: delivered");
    Ok(())
}

/// Verifies that the given request was signed by the given public key.
/// Pass `path` exactly as it appears in the request-target (path?query).
/// Returns Ok(()) when valid, Err otherwise.
pub fn verify_request(
    method: &str,
    path: &str,
    headers: &axum::http::HeaderMap,
    body: &[u8],
    public_key_pem: &str,
) -> Result<()> {
    let sig_header = headers
        .get("signature")
        .or_else(|| headers.get("Signature"))
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| anyhow!("no Signature header"))?;
    let parts = parse_signature_header(sig_header);
    // The signer must declare which headers it covered — no permissive
    // default. An attacker who controls `headers=` could otherwise sign a
    // minimal set, omit digest, and swap the body.
    let headers_list = parts
        .get("headers")
        .cloned()
        .ok_or_else(|| anyhow!("signature must declare a headers= set"))?;
    let sig_b64 = parts
        .get("signature")
        .cloned()
        .ok_or_else(|| anyhow!("no signature= param"))?;

    let signed: Vec<String> = headers_list
        .split_whitespace()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    let signs = |h: &str| signed.iter().any(|s| s == h);

    // Require coverage of the request line, Host and Date always, and Digest
    // whenever there's a body — so the signature binds the target, freshness,
    // and the payload. Without the digest requirement the JSON body is
    // unauthenticated and forgeable.
    if !signs("(request-target)") || !signs("host") || !signs("date") {
        return Err(anyhow!(
            "signature must cover (request-target), host, and date"
        ));
    }
    if !body.is_empty() && !signs("digest") {
        return Err(anyhow!(
            "signature must cover digest when a body is present"
        ));
    }

    // Freshness window: reject a signature whose Date is more than 5 minutes
    // from now (either direction), so a captured signature can't be replayed
    // indefinitely.
    let date_str = headers
        .get("date")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| anyhow!("no Date header"))?;
    let sent = httpdate::parse_http_date(date_str).map_err(|e| anyhow!("bad Date: {e}"))?;
    let now = std::time::SystemTime::now();
    let skew = now
        .duration_since(sent)
        .or_else(|_| sent.duration_since(now))
        .map_err(|e| anyhow!("clock: {e}"))?;
    if skew > std::time::Duration::from_secs(300) {
        return Err(anyhow!("signature date outside freshness window"));
    }

    // Build signing string
    let mut signing_lines = Vec::<String>::new();
    for name in headers_list.split_whitespace() {
        match name {
            "(request-target)" => {
                signing_lines.push(format!(
                    "(request-target): {} {path}",
                    method.to_lowercase()
                ));
            }
            other => {
                let v = headers
                    .get(other)
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or("");
                signing_lines.push(format!("{}: {v}", other.to_lowercase()));
            }
        }
    }
    let signing_string = signing_lines.join("\n");

    // Verify the digest matches the actual body (presence already enforced
    // above when a body exists).
    if signs("digest") {
        let claimed = headers
            .get("digest")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("no Digest header"))?;
        let actual = format!("SHA-256={}", B64.encode(Sha256::digest(body)));
        if !claimed.eq_ignore_ascii_case(&actual) {
            return Err(anyhow!("digest mismatch"));
        }
    }

    // Load pubkey (try PKCS#1 then SPKI/PKCS#8)
    let pub_key = RsaPublicKey::from_pkcs1_pem(public_key_pem)
        .or_else(|_| RsaPublicKey::from_public_key_pem(public_key_pem))
        .map_err(|e| anyhow!("pubkey parse: {e}"))?;
    let verifier: VerifyingKey<Sha256> = VerifyingKey::new(pub_key);
    let sig_bytes = B64.decode(sig_b64).map_err(|e| anyhow!("sig b64: {e}"))?;
    let sig = Signature::try_from(sig_bytes.as_slice()).map_err(|e| anyhow!("sig parse: {e}"))?;
    verifier
        .verify(signing_string.as_bytes(), &sig)
        .map_err(|e| anyhow!("verify: {e}"))?;
    Ok(())
}

pub fn signature_key_id(headers: &axum::http::HeaderMap) -> Option<String> {
    let sig_header = headers
        .get("signature")
        .or_else(|| headers.get("Signature"))
        .and_then(|v| v.to_str().ok())?;
    parse_signature_header(sig_header).get("keyId").cloned()
}

fn parse_signature_header(s: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for part in s.split(',') {
        let trimmed = part.trim();
        if let Some(eq) = trimmed.find('=') {
            let k = trimmed[..eq].trim().to_string();
            let mut v = trimmed[eq + 1..].trim().to_string();
            if v.starts_with('"') && v.ends_with('"') && v.len() >= 2 {
                v = v[1..v.len() - 1].to_string();
            }
            out.insert(k, v);
        }
    }
    out
}
