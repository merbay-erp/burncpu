//! API-token scope enforcement.
//!
//! Supported scope strings:
//! - `all`
//! - `read`
//! - `read:<resource>`
//! - `write:<resource>`
//!
//! API tokens are never accepted for auth/account-control surfaces such
//! as `/api/v1/auth`, `/api/v1/tokens`, or `/api/v1/admin`.

use axum::http::Method;

const SESSION_ONLY_PREFIXES: &[&str] = &[
    "/api/v1/admin",
    "/api/v1/auth",
    "/api/v1/tokens",
    // Account-control surfaces: a leaked / over-scoped API token must not read
    // the security log, revoke sessions, or exfiltrate the data export.
    // (Destructive DELETE /users/me is additionally session-gated in its handler.)
    "/api/v1/users/me/security",
    "/api/v1/users/me/sessions",
    "/api/v1/users/me/export",
];

const RESOURCE_PREFIXES: &[(&str, &str)] = &[
    ("profile", "/api/v1/users"),
    ("notifications", "/api/v1/notifications"),
    ("bookmarks", "/api/v1/bookmarks"),
    ("posts", "/api/v1/posts"),
    ("webhooks", "/api/v1/webhooks"),
    ("dm", "/api/v1/dm"),
    ("feed", "/api/v1/feed"),
    ("search", "/api/v1/search"),
    ("trending", "/api/v1/trending"),
    ("media", "/api/v1/media"),
    ("invites", "/api/v1/invites"),
    ("push", "/api/v1/push"),
];

pub fn scope_allows(scope: &str, method: &Method, path: &str) -> bool {
    if SESSION_ONLY_PREFIXES
        .iter()
        .any(|prefix| path_matches_prefix(path, prefix))
    {
        return false;
    }

    let is_read = matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS);

    if scope == "all" {
        return true;
    }
    if scope == "read" {
        return is_read;
    }

    let Some((verb, resource)) = scope.split_once(':') else {
        return false;
    };
    let Some((_, prefix)) = RESOURCE_PREFIXES.iter().find(|(r, _)| *r == resource) else {
        return false;
    };
    if !path_matches_prefix(path, prefix) {
        return false;
    }

    match verb {
        "read" => is_read,
        "write" => true,
        _ => false,
    }
}

pub fn is_valid_scope(scope: &str) -> bool {
    if matches!(scope, "all" | "read") {
        return true;
    }
    let Some((verb, resource)) = scope.split_once(':') else {
        return false;
    };
    matches!(verb, "read" | "write") && RESOURCE_PREFIXES.iter().any(|(r, _)| *r == resource)
}

fn path_matches_prefix(path: &str, prefix: &str) -> bool {
    path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_scope_blocks_writes() {
        assert!(scope_allows("read", &Method::GET, "/api/v1/posts"));
        assert!(!scope_allows("read", &Method::POST, "/api/v1/posts"));
        assert!(!scope_allows("read", &Method::DELETE, "/api/v1/posts/1"));
    }

    #[test]
    fn session_only_surfaces_reject_all_api_tokens() {
        for path in [
            "/api/v1/admin/users",
            "/api/v1/auth/2fa/enroll",
            "/api/v1/auth/request",
            "/api/v1/tokens",
            "/api/v1/tokens/00000000-0000-0000-0000-000000000000",
        ] {
            assert!(!scope_allows("all", &Method::POST, path), "{path}");
            assert!(!scope_allows("read", &Method::GET, path), "{path}");
        }
    }

    #[test]
    fn granular_scopes_match_only_their_resource() {
        assert!(scope_allows(
            "write:posts",
            &Method::PATCH,
            "/api/v1/posts/abc"
        ));
        assert!(scope_allows("write:posts", &Method::GET, "/api/v1/posts"));
        assert!(!scope_allows(
            "write:posts",
            &Method::GET,
            "/api/v1/webhooks"
        ));
        assert!(scope_allows(
            "read:notifications",
            &Method::GET,
            "/api/v1/notifications"
        ));
        assert!(!scope_allows(
            "read:notifications",
            &Method::POST,
            "/api/v1/notifications/read"
        ));
    }

    #[test]
    fn prefix_matching_requires_path_boundary() {
        assert!(!scope_allows(
            "read:posts",
            &Method::GET,
            "/api/v1/posts-old"
        ));
        assert!(scope_allows(
            "read:posts",
            &Method::GET,
            "/api/v1/posts/abc"
        ));
    }

    #[test]
    fn validates_scope_strings() {
        assert!(is_valid_scope("all"));
        assert!(is_valid_scope("read"));
        assert!(is_valid_scope("read:profile"));
        assert!(is_valid_scope("write:webhooks"));
        assert!(!is_valid_scope("admin"));
        assert!(!is_valid_scope("read:admin"));
        assert!(!is_valid_scope("delete:posts"));
        assert!(!is_valid_scope("read:unknown"));
    }
}
