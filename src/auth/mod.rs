// Auth subsystem.
//
// Token strategy:
//   - raw_token (256 bits, base64url) sent to user via email / cookie
//   - hash = SHA-256(raw_token) — only the hash is stored
//   - lookup at verify-time hashes the presented token and compares
//
// Two distinct token kinds:
//   - magic_link  : short-lived (15 min), one-shot, identifies an email
//   - session     : long-lived (30 days), revocable, identifies a user

pub mod email;
pub mod scope;
pub mod token;
pub mod totp;

use anyhow::Result;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Generate 32 cryptographically-random bytes and return them base64url-encoded
/// (URL-safe, no padding) plus their SHA-256 hash for storage.
pub fn new_token() -> Result<(String, Vec<u8>)> {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let raw = base64url_encode(&bytes);
    let hash = Sha256::digest(raw.as_bytes()).to_vec();
    Ok((raw, hash))
}

/// SHA-256 hash of an arbitrary string. Used at verify-time to look up the
/// stored hash without ever persisting the raw token.
pub fn hash_token(raw: &str) -> Vec<u8> {
    Sha256::digest(raw.as_bytes()).to_vec()
}

pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    // URL-safe base64 without padding (RFC 4648 §5)
    use std::fmt::Write;
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        let _ = out.write_char(CHARSET[((n >> 18) & 0x3f) as usize] as char);
        let _ = out.write_char(CHARSET[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            let _ = out.write_char(CHARSET[((n >> 6) & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            let _ = out.write_char(CHARSET[(n & 0x3f) as usize] as char);
        }
    }
    out
}
