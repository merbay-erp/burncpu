// FromRequestParts extractor for CurrentUser.
//
// Handlers declare `user: CurrentUser` in their signature; if the
// session middleware didn't attach one (no cookie / expired / revoked),
// we return 401. This is the single place auth is enforced for
// authenticated routes — no per-handler boilerplate.

use crate::{errors::AppError, middleware::session::CurrentUser};
use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::request::Parts,
};
use std::convert::Infallible;

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

// Lets handlers use `viewer: Option<CurrentUser>` for endpoints that
// expose extra fields to logged-in users but stay publicly accessible.
impl<S> OptionalFromRequestParts<S> for CurrentUser
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        Ok(parts.extensions.get::<CurrentUser>().cloned())
    }
}
