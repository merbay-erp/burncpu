// Token TTL + format constants. Kept separate from the generator so callers
// can read these without pulling in `rand` / `sha2`.

use std::time::Duration;

/// Magic-link tokens expire fast (15 min). Re-request if user delays.
pub const MAGIC_LINK_TTL: Duration = Duration::from_secs(15 * 60);

/// Session cookies last 30 days. Renewed silently on each authenticated
/// request once we add a refresh helper.
pub const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Rate limit per email for the `/auth/request` endpoint: max 3 requests
/// per 10 minutes. Prevents account-enumeration + mailbox flooding.
pub const RATE_LIMIT_MAX: u32 = 3;
pub const RATE_LIMIT_WINDOW_SECS: u64 = 600;

/// Cookie name used to carry the session token.
pub const SESSION_COOKIE: &str = "burncpu_session";
