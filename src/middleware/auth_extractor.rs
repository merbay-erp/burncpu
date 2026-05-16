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

/// Wraps CurrentUser, but rejects with 403 if role != "admin". Routes under
/// /api/v1/admin should take `_a: AdminUser` to enforce.
#[derive(Clone)]
pub struct AdminUser(pub CurrentUser);

impl<S> FromRequestParts<S> for AdminUser
where
    S: Send + Sync,
{
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let u = parts
            .extensions
            .get::<CurrentUser>()
            .cloned()
            .ok_or(AppError::Unauthorized)?;
        if u.role != "admin" {
            return Err(AppError::Forbidden);
        }
        Ok(AdminUser(u))
    }
}

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
