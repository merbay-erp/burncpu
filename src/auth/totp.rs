// TOTP (RFC 6238) helpers + at-rest secret encryption.
//
// - Secret: 20 random bytes (160 bits)
// - Algorithm: SHA1 (universal TOTP authenticator compatibility)
// - Digits: 6, period: 30s
// - Stored: XChaCha20-Poly1305 (24-byte nonce + ciphertext+tag),
//           key from BURNCPU_ENC_KEY (64 hex chars = 32 bytes).
// - Recovery codes: 10 codes, sha256 hashed individually; consumed on use.

use anyhow::{anyhow, Context, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng as RandOsRng, RngCore};
use sha2::{Digest, Sha256};
use totp_rs::{Algorithm, Secret, TOTP};

pub const RECOVERY_CODE_COUNT: usize = 10;
const ISSUER: &str = "burncpu.com";

pub struct EnrollResult {
    pub otpauth_uri: String,
    pub raw_secret_b32: String,
    pub recovery_codes_plain: Vec<String>, // shown ONCE to the user
    pub secret_encrypted: Vec<u8>,
    pub secret_nonce: Vec<u8>,
    pub recovery_hashes: Vec<Vec<u8>>,
}

pub fn enroll(username: &str) -> Result<EnrollResult> {
    let mut secret = [0u8; 20];
    RandOsRng.fill_bytes(&mut secret);
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret.to_vec(),
        Some(ISSUER.into()),
        username.to_string(),
    )?;
    let otpauth_uri = totp.get_url();
    let raw_b32 = Secret::Raw(secret.to_vec()).to_encoded().to_string();

    let key = load_enc_key()?;
    let cipher = XChaCha20Poly1305::new(&key.into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let secret_encrypted = cipher
        .encrypt(&nonce, secret.as_ref())
        .map_err(|e| anyhow!("encrypt: {e}"))?;
    let secret_nonce = nonce.to_vec();

    // Generate recovery codes — 8 alphanumeric chars each, shown to user once.
    let mut codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    let mut hashes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    for _ in 0..RECOVERY_CODE_COUNT {
        let c = random_code(8);
        let h = Sha256::digest(c.as_bytes()).to_vec();
        codes.push(c);
        hashes.push(h);
    }

    Ok(EnrollResult {
        otpauth_uri,
        raw_secret_b32: raw_b32,
        recovery_codes_plain: codes,
        secret_encrypted,
        secret_nonce,
        recovery_hashes: hashes,
    })
}

/// Verify a 6-digit code against the stored encrypted secret. Returns
/// the matched step counter so the caller can persist `last_used_step`
/// to prevent replay within the 30s window.
pub fn verify_code(
    secret_encrypted: &[u8],
    secret_nonce: &[u8],
    code: &str,
    last_used_step: Option<i64>,
) -> Result<i64> {
    let key = load_enc_key()?;
    let cipher = XChaCha20Poly1305::new(&key.into());
    let nonce = XNonce::from_slice(secret_nonce);
    let secret = cipher
        .decrypt(nonce, secret_encrypted)
        .map_err(|e| anyhow!("decrypt: {e}"))?;
    let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret, Some(ISSUER.into()), "u".into())?;

    // Accept current step ± 1 (one 30s window of clock drift)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let current_step = (now / 30) as i64;
    for delta in [0i64, -1, 1] {
        let step = current_step + delta;
        if let Some(last) = last_used_step {
            if step <= last {
                continue;
            }
        }
        // totp-rs generate() takes a unix timestamp in *seconds*, not the
        // step counter. Convert: step * 30 = the start of that 30-second
        // window.
        let expected = totp.generate((step * 30) as u64);
        if constant_eq(expected.as_bytes(), code.trim().as_bytes()) {
            return Ok(step);
        }
    }
    Err(anyhow!("invalid TOTP"))
}

pub fn hash_recovery(code: &str) -> Vec<u8> {
    Sha256::digest(code.trim().as_bytes()).to_vec()
}

fn random_code(n: usize) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut buf = vec![0u8; n];
    RandOsRng.fill_bytes(&mut buf);
    buf.iter().map(|b| ALPHA[(*b as usize) % ALPHA.len()] as char).collect()
}

fn load_enc_key() -> Result<[u8; 32]> {
    let hex_str = std::env::var("BURNCPU_ENC_KEY").context("BURNCPU_ENC_KEY not set (need 64 hex chars = 32 bytes)")?;
    if hex_str.len() != 64 {
        return Err(anyhow!("BURNCPU_ENC_KEY must be 64 hex chars"));
    }
    let bytes = hex::decode(&hex_str).context("BURNCPU_ENC_KEY not valid hex")?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
