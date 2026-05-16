// FromRequestParts extractor for CurrentUser.
//
// Handlers declare `user: CurrentUser` in their signature; if the
// session middleware didn't attach one (no cookie / expired / revoked),
// we return 401. This is the single place auth is enforced for
// authenticated routes — no per-handler boilerplate.

use crate::{errors::AppError, middleware::session::CurrentUser};
use axum::{extract::FromRequestParts, http::request::Parts};

impl<S> FromRequestParts<S> for CurrentUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<CurrentUser>()
            .cloned()
            .ok_or(AppError::Unauthorized)
    }
}
