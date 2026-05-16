// /api/v1 — public API surface. Submodules attach themselves below.

use super::{auth, feed, posts, users};
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
                        "POST   /api/v1/posts":                "create post (auth)",
                        "GET    /api/v1/posts":                "public timeline (paginated)",
                        "GET    /api/v1/posts/{id}":           "single post",
                        "DELETE /api/v1/posts/{id}":           "soft-delete (author or admin)",
                        "POST   /api/v1/posts/{id}/react":     "react with emoji (auth)",
                        "DELETE /api/v1/posts/{id}/react":     "remove your reaction (auth)",
                        "GET    /api/v1/posts/{id}/reactions": "reaction tallies + your reaction",
                        "GET    /api/v1/feed":                 "personal home timeline (auth)",
                        "GET    /api/v1/users/{username}":     "profile",
                        "GET    /api/v1/users/{username}/posts":     "author posts",
                        "GET    /api/v1/users/{username}/followers": "followers list",
                        "GET    /api/v1/users/{username}/following": "following list",
                        "POST   /api/v1/users/{username}/follow":    "follow (auth)",
                        "DELETE /api/v1/users/{username}/follow":    "unfollow (auth)",
                        "PATCH  /api/v1/users/me":             "edit profile (auth)",
                        "GET    /healthz":                     "liveness probe",
                    },
                }))
            }),
        )
        .nest("/auth", auth::router())
        .nest("/posts", posts::router())
        .nest("/users", users::router())
        .nest("/feed", feed::router())
}
