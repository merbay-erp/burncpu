// Client IP extraction.
//
// The app sits behind nginx behind Cloudflare. Real client IP arrives in
// one of these headers (priority order):
//   1. CF-Connecting-IP   (Cloudflare, most trusted)
//   2. X-Real-IP          (nginx, set from CF-Connecting-IP)
//   3. X-Forwarded-For    (first hop, only if CF/nginx missing)
//   4. ConnectInfo socket (peer — likely 172.x.x.x docker bridge)
//
// These forwarding headers are honored ONLY when the immediate peer is a trusted
// proxy — loopback or a private/internal address, i.e. nginx or the container
// network, never a public client. nginx itself only sets them from Cloudflare's
// range (real_ip_module), and the app port is bound to 127.0.0.1; the peer gate
// here is defense-in-depth, so that any direct connection which bypasses the proxy
// can't forge CF-Connecting-IP / X-Forwarded-For to spoof its IP (rate-limit
// evasion, audit-log poisoning). For an untrusted peer we ignore the headers and
// use the socket address.

use axum::http::HeaderMap;
use std::net::{IpAddr, SocketAddr};

pub fn extract(headers: &HeaderMap, peer: Option<&SocketAddr>) -> Option<IpAddr> {
    let peer_ip = peer.map(|sa| sa.ip());

    if peer_ip.is_some_and(is_trusted_proxy) {
        // 1. CF-Connecting-IP
        if let Some(ip) = header_ip(headers, "cf-connecting-ip") {
            return Some(ip);
        }
        // 2. X-Real-IP
        if let Some(ip) = header_ip(headers, "x-real-ip") {
            return Some(ip);
        }
        // 3. X-Forwarded-For (left-most is the original client)
        if let Some(v) = headers.get("x-forwarded-for").and_then(|h| h.to_str().ok())
            && let Some(first) = v.split(',').next()
            && let Ok(ip) = first.trim().parse()
        {
            return Some(ip);
        }
    }
    // Untrusted peer (or no forwarding headers): the socket address is the truth.
    peer_ip
}

/// Whether `ip` is an internal hop we accept forwarding headers from: loopback or
/// any private / link-local / unique-local address (the reverse-proxy + container
/// network). A public peer is a client talking to us directly and is never trusted
/// to set its own forwarded IP. IPv4-mapped IPv6 is normalized first.
fn is_trusted_proxy(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        v4 => v4,
    };
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        // ::1, plus unique-local fc00::/7 and link-local fe80::/10.
        IpAddr::V6(v6) => {
            let head = v6.segments()[0];
            v6.is_loopback() || (head & 0xfe00) == 0xfc00 || (head & 0xffc0) == 0xfe80
        }
    }
}

fn header_ip(headers: &HeaderMap, name: &str) -> Option<IpAddr> {
    headers
        .get(name)
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr(name: &'static str, val: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(name, val.parse().unwrap());
        h
    }

    #[test]
    fn trusted_peer_honors_forwarded_header() {
        // nginx on the container bridge (private) → the forwarded client IP is used.
        let peer: SocketAddr = "172.18.0.5:443".parse().unwrap();
        let ip = extract(&hdr("cf-connecting-ip", "203.0.113.7"), Some(&peer));
        assert_eq!(ip, Some("203.0.113.7".parse().unwrap()));
    }

    #[test]
    fn untrusted_peer_ignores_forwarded_header() {
        // A public client talking to us directly cannot spoof its IP — we use the
        // socket address, never the (forgeable) header.
        let peer: SocketAddr = "203.0.113.9:51000".parse().unwrap();
        let ip = extract(&hdr("cf-connecting-ip", "10.0.0.1"), Some(&peer));
        assert_eq!(ip, Some("203.0.113.9".parse().unwrap()));
    }

    #[test]
    fn trust_boundary() {
        for t in ["127.0.0.1", "::1", "10.1.2.3", "172.18.0.5", "192.168.1.9"] {
            assert!(
                is_trusted_proxy(t.parse().unwrap()),
                "{t} should be trusted"
            );
        }
        for u in ["8.8.8.8", "203.0.113.1", "2606:4700:4700::1111"] {
            assert!(
                !is_trusted_proxy(u.parse().unwrap()),
                "{u} should be untrusted"
            );
        }
    }
}
