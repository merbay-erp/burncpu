// /api/v1 — public API surface. Submodules attach themselves below.

use super::{admin, auth, bookmarks, dm, feed, invites, media, notifications, posts, push, relations, reports, search, tokens, trending, users, webhooks};
use crate::state::AppState;
use axum::{routing::get, Router};
use serde_json::json;

pub fn router(_state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(|| async {
                axum::Json(json!({
                    "name": "burncpu API",
                    "version": env!("CARGO_PKG_VERSION"),
                    "endpoints": {
                        "POST   /api/v1/auth/request":         "request magic-link email",
                        "GET    /api/v1/auth/verify/{token}":  "verify token + start session",
                        "POST   /api/v1/auth/logout":          "revoke current session",
                        "POST   /api/v1/auth/2fa/enroll":      "enroll TOTP (returns otpauth URI + recovery codes)",
                        "POST   /api/v1/auth/2fa/confirm":     "verify first code to activate",
                        "POST   /api/v1/auth/2fa/challenge":   "satisfy 2FA on a pending session",
                        "POST   /api/v1/auth/2fa/disable":     "remove TOTP (requires current code)",
                        "POST   /api/v1/posts":                "create post (auth)",
                        "GET    /api/v1/posts":                "public timeline (paginated)",
                        "GET    /api/v1/posts/{id}":           "single post",
                        "DELETE /api/v1/posts/{id}":           "soft-delete (author or admin)",
                        "POST   /api/v1/posts/{id}/react":     "react with emoji (auth)",
                        "DELETE /api/v1/posts/{id}/react":     "remove your reaction (auth)",
                        "GET    /api/v1/posts/{id}/reactions": "reaction tallies + your reaction",
                        "GET    /api/v1/posts/{id}/replies":   "direct replies (paginated)",
                        "GET    /api/v1/posts/{id}/thread":    "full conversation (root + descendants, max depth 6)",
                        "GET    /api/v1/feed":                 "personal home timeline (auth)",
                        "GET    /api/v1/users/{username}":     "profile",
                        "GET    /api/v1/users/{username}/posts":     "author posts",
                        "GET    /api/v1/users/{username}/followers": "followers list",
                        "GET    /api/v1/users/{username}/following": "following list",
                        "POST   /api/v1/users/{username}/follow":    "follow (auth)",
                        "DELETE /api/v1/users/{username}/follow":    "unfollow (auth)",
                        "PATCH  /api/v1/users/me":             "edit profile (auth)",
                        "POST   /api/v1/invites":              "create invite code (auth, 5/day)",
                        "GET    /api/v1/invites":              "list your invites (auth)",
                        "GET    /api/v1/invites/{code}":       "check code validity",
                        "DELETE /api/v1/invites/{code}":       "revoke unredeemed invite (auth)",
                        "GET    /api/v1/admin/posts":          "moderation queue (admin)",
                        "PATCH  /api/v1/admin/posts/{id}":     "change moderation_state (admin)",
                        "GET    /api/v1/admin/users":          "user list + counts (admin)",
                        "PATCH  /api/v1/admin/users/{id}":     "suspend / unsuspend (admin)",
                        "GET    /api/v1/admin/login_attempts": "recent attempts (admin)",
                        "GET    /api/v1/admin/audit":          "request audit log (admin)",
                        "GET    /api/v1/admin/sessions":       "active / flagged sessions (admin)",
                        "GET    /api/v1/admin/moderation_log": "append-only mod history (admin)",
                        "GET    /api/v1/search ?q=&tag=":      "text + hashtag search (public live posts)",
                        "GET    /api/v1/hashtags/{tag}":       "posts tagged with #tag",
                        "POST   /api/v1/search/reindex":       "bulk re-index live public posts (admin)",
                        "GET    /api/v1/notifications":        "inbox (auth, paginated, ?unread_only=1)",
                        "GET    /api/v1/notifications/count":  "unread count for badge",
                        "PATCH  /api/v1/notifications/read":   "bulk mark all read",
                        "PATCH  /api/v1/notifications/{id}/read": "mark single read",
                        "GET    /api/v1/notifications/stream": "SSE live notifications",
                        "POST   /api/v1/media":                "upload image (multipart, max 5 MiB)",
                        "GET    /api/v1/media":                "list your uploads",
                        "DELETE /api/v1/media/{id}":           "delete own upload",
                        "GET    /api/v1/bookmarks":            "your bookmarked posts",
                        "POST   /api/v1/bookmarks/{post_id}":  "bookmark",
                        "DELETE /api/v1/bookmarks/{post_id}":  "unbookmark",
                        "PATCH  /api/v1/posts/{id}":           "edit (author only) — sets edited_at",
                        "POST   /api/v1/posts/{id}/repost":    "repost (optional quote body)",
                        "DELETE /api/v1/users/me":             "delete own account (X-Confirm-Username header)",
                        "GET    /api/v1/users/me/export":      "GDPR JSON download",
                        "POST   /api/v1/users/me/pin/{post_id}":   "pin post to profile",
                        "DELETE /api/v1/users/me/pin/{post_id}":   "unpin",
                        "GET    /api/v1/users/lookup ?prefix=": "username typeahead",
                        "GET    /api/v1/dm/threads":           "DM thread list",
                        "GET    /api/v1/dm/threads/{u}":       "open / fetch thread",
                        "POST   /api/v1/dm/threads/{u}":       "send DM (requires mutual follow)",
                        "PATCH  /api/v1/dm/threads/{u}/read":  "mark thread read",
                        "DELETE /api/v1/dm/messages/{id}":     "soft-delete own message",
                        "GET    /api/v1/trending/hashtags":    "hashtag counts (window=24h)",
                        "GET    /api/v1/trending/posts":       "most-reacted public posts",
                        "GET    /embed/posts/{id}":            "minimal HTML with per-post OG meta (used by share crawlers)",
                        "GET    /api/v1/tokens":               "list API tokens",
                        "POST   /api/v1/tokens":               "create bearer token (shown ONCE)",
                        "DELETE /api/v1/tokens/{id}":          "revoke token",
                        "GET    /api/v1/webhooks":             "list outgoing webhooks",
                        "POST   /api/v1/webhooks":             "create webhook (secret shown ONCE)",
                        "PATCH  /api/v1/webhooks/{id}":        "toggle active / events",
                        "DELETE /api/v1/webhooks/{id}":        "remove webhook",
                        "AUTH":                                "Authorization: Bearer <token> works on every authenticated endpoint",
                        "POST   /api/v1/users/{u}/block":      "block (drops mutual follow)",
                        "DELETE /api/v1/users/{u}/block":      "unblock",
                        "POST   /api/v1/users/{u}/mute":       "mute (silent on the other side)",
                        "DELETE /api/v1/users/{u}/mute":       "unmute",
                        "GET    /api/v1/users/me/blocks":      "your block list",
                        "GET    /api/v1/users/me/mutes":       "your mute list",
                        "POST   /api/v1/reports":              "report post / user / dm",
                        "GET    /api/v1/admin/reports":        "report queue (admin, ?open=1)",
                        "PATCH  /api/v1/admin/reports/{id}":   "resolve { resolution } (admin)",
                        "GET    /healthz":                     "liveness probe",
                    },
                }))
            }),
        )
        .nest("/auth", auth::router())
        .nest("/posts", posts::router())
        .nest("/users", users::router())
        .nest("/feed", feed::router())
        .nest("/invites", invites::router())
        .nest("/admin", admin::router())
        .nest("/search", search::router())
        .nest("/hashtags", search::hashtags_router())
        .nest("/notifications", notifications::router())
        .nest("/media", media::router())
        .nest("/bookmarks", bookmarks::router())
        .nest("/dm", dm::router())
        .nest("/trending", trending::router())
        .nest("/tokens", tokens::router())
        .nest("/webhooks", webhooks::router())
        .nest("/push", push::router())
        .nest("/users", relations::router())   // /users/{u}/block + /mute + /me/blocks etc
        .nest("/reports", reports::router())
        .nest("/admin/reports", reports::admin_router())
}
