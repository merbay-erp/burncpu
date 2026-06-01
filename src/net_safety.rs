//! Outbound HTTP SSRF guard.

use anyhow::{Result, anyhow, bail};
use reqwest::Client;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

pub async fn validate_public_http_url(raw: &str) -> Result<Url> {
    let url = parse_url(raw)?;
    let (host, port) = host_port(&url)?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        check_ip(ip)?;
        return Ok(url);
    }
    let mut saw = false;
    for addr in lookup_host((host.as_str(), port)).await? {
        saw = true;
        check_ip(addr.ip())?;
    }
    if !saw {
        bail!("URL host did not resolve");
    }
    Ok(url)
}

pub async fn safe_client_for(
    raw: &str,
    user_agent: &str,
    timeout: Duration,
) -> Result<(Client, Url)> {
    let url = parse_url(raw)?;
    let (host, port) = host_port(&url)?;
    let pinned: SocketAddr = if let Ok(ip) = host.parse::<IpAddr>() {
        check_ip(ip)?;
        SocketAddr::new(ip, port)
    } else {
        let mut chosen = None;
        for addr in lookup_host((host.as_str(), port)).await? {
            check_ip(addr.ip())?;
            chosen.get_or_insert(addr);
        }
        chosen.ok_or_else(|| anyhow!("URL host did not resolve"))?
    };
    let client = Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(&host, pinned)
        .build()?;
    Ok((client, url))
}

fn parse_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|e| anyhow!("invalid URL: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        _ => bail!("URL scheme must be http or https"),
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("URL credentials are not allowed");
    }
    Ok(url)
}

fn host_port(url: &Url) -> Result<(String, u16)> {
    let host = url.host_str().ok_or_else(|| anyhow!("URL host required"))?;
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    if is_forbidden_hostname(&normalized) {
        bail!("URL host is not public");
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("URL port could not be determined"))?;
    Ok((normalized, port))
}

fn check_ip(ip: IpAddr) -> Result<()> {
    if is_forbidden_ip(ip) {
        bail!("URL host resolves to a non-public address");
    }
    Ok(())
}

fn is_forbidden_hostname(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "ip6-localhost"
        || host == "ip6-loopback"
        || host == "local"
        || host.ends_with(".local")
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_forbidden_ipv4(ip),
        IpAddr::V6(ip) => is_forbidden_ipv6(ip),
    }
}

fn is_forbidden_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_broadcast()
        || o[0] == 0
        || (o[0] == 100 && (64..=127).contains(&o[1]))
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 198 && (18..=19).contains(&o[1]))
        || (o[0] == 192 && o[1] == 0 && o[2] == 2)
        || (o[0] == 198 && o[1] == 51 && o[2] == 100)
        || (o[0] == 203 && o[1] == 0 && o[2] == 113)
}

fn is_forbidden_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_forbidden_ipv4(mapped);
    }
    let s = ip.segments();
    // Re-map any embedded IPv4 and apply the v4 rules, otherwise an internal
    // target can be reached through an IPv6 wrapper:
    //   - IPv4-compatible ::a.b.c.d  (high 96 bits zero, deprecated)
    //   - NAT64           64:ff9b::a.b.c.d
    let high96_zero = s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0;
    let nat64 =
        s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0;
    if high96_zero || nat64 {
        let v4 = Ipv4Addr::new(
            (s[6] >> 8) as u8,
            (s[6] & 0xff) as u8,
            (s[7] >> 8) as u8,
            (s[7] & 0xff) as u8,
        );
        return is_forbidden_ipv4(v4);
    }
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (s[0] & 0xfe00) == 0xfc00
        || (s[0] & 0xffc0) == 0xfe80
        || (s[0] == 0x2001 && s[1] == 0x0db8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_local_and_private_urls() {
        for raw in [
            "http://localhost/",
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://10.0.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "file:///etc/passwd",
            "https://user:pass@example.com/",
        ] {
            assert!(validate_public_http_url(raw).await.is_err(), "{raw}");
        }
    }

    #[test]
    fn forbids_ipv6_embedded_ipv4() {
        // IPv4-compatible ::a.b.c.d and NAT64 64:ff9b::a.b.c.d wrappers around
        // the cloud-metadata address must still be rejected.
        for raw in ["::169.254.169.254", "64:ff9b::a9fe:a9fe", "::127.0.0.1"] {
            let ip: IpAddr = raw.parse().unwrap();
            assert!(is_forbidden_ip(ip), "{raw}");
        }
    }
}
