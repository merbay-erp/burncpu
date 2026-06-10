// Fixed-window rate-limit primitive.
//
// The naive pattern — `INCR key` then, on the first hit, `EXPIRE key window` —
// is two round-trips that aren't atomic: if the process dies (or the connection
// drops) between them, the key is left with no TTL and lives forever, a slow
// Redis memory leak across the dozen-plus call sites that used it. Running both
// commands in one server-side EVAL closes that window — the counter and its
// expiry are set together or not at all.

use redis::aio::ConnectionManager;

/// Increment `key`'s counter and (on the first hit of the window) set its TTL,
/// atomically. Returns the post-increment count, or 0 if Redis is unreachable
/// (fail-open: a Redis blip must not lock everyone out).
pub async fn hit(redis: &mut ConnectionManager, key: &str, window_secs: i64) -> u32 {
    redis::Script::new(
        "local c = redis.call('INCR', KEYS[1])\n\
         if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\n\
         return c",
    )
    .key(key)
    .arg(window_secs)
    .invoke_async(redis)
    .await
    .unwrap_or(0)
}
