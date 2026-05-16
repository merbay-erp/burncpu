// Client IP extraction.
//
// The app sits behind nginx behind Cloudflare. Real client IP arrives in
// one of these headers (priority order):
//   1. CF-Connecting-IP   (Cloudflare, most trusted)
//   2. X-Real-IP          (nginx, set from CF-Connecting-IP)
//   3. X-Forwarded-For    (first hop, only if CF/nginx missing)
//   4. ConnectInfo socket (peer — likely 172.x.x.x docker bridge)
//
// We trust 1-3 because nginx is configured to only set them from
// Cloudflare's IP range (real_ip_module). Direct connections to 3060
// bypass that — but the port is bound to 127.0.0.1, so reachable only
// from the same host (and Docker network internally).

use axum::http::HeaderMap;
use std::net::{IpAddr, SocketAddr};

pub fn extract(headers: &HeaderMap, peer: Option<&SocketAddr>) -> Option<IpAddr> {
    // 1. CF-Connecting-IP
    if let Some(v) = headers.get("cf-connecting-ip").and_then(|h| h.to_str().ok()) {
        if let Ok(ip) = v.trim().parse() {
            return Some(ip);
        }
    }
    // 2. X-Real-IP
    if let Some(v) = headers.get("x-real-ip").and_then(|h| h.to_str().ok()) {
        if let Ok(ip) = v.trim().parse() {
            return Some(ip);
        }
    }
    // 3. X-Forwarded-For (left-most is original client)
    if let Some(v) = headers.get("x-forwarded-for").and_then(|h| h.to_str().ok()) {
        if let Some(first) = v.split(',').next() {
            if let Ok(ip) = first.trim().parse() {
                return Some(ip);
            }
        }
    }
    // 4. Direct socket
    peer.map(|sa| sa.ip())
}
