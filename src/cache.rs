//! Tiny Redis read-through cache for hot, viewer-independent read endpoints
//! (the anonymous public timeline, trending). The cached value is the already-
//! serialized JSON response body, stored and returned raw — no per-struct
//! `Deserialize` needed. Short TTLs make explicit invalidation unnecessary.
//!
//! A stampede lock keeps a cold popular key from being recomputed by every
//! concurrent request at once (without it, a cache *adds* a thundering-herd
//! failure mode on expiry). The whole thing is strictly best-effort: any Redis
//! error degrades to computing directly — it is never a correctness or
//! availability dependency.

use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use std::future::Future;
use std::time::Duration;

/// Return the JSON body for `key` from cache, or compute it via `f`, cache it for
/// `ttl_secs`, and return it. `f` yields the serialized JSON `String` (or an
/// error, which is propagated and never cached).
pub async fn read_through_json<E, F, Fut>(
    redis: &mut ConnectionManager,
    key: &str,
    ttl_secs: u64,
    f: F,
) -> Result<String, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<String, E>>,
{
    // Fast path: cache hit.
    if let Ok(Some(hit)) = redis.get::<_, Option<String>>(key).await {
        return Ok(hit);
    }

    // Stampede control: only the lock winner recomputes a cold key.
    let lock_key = format!("{key}:lock");
    let won: Option<String> = redis::cmd("SET")
        .arg(&lock_key)
        .arg(1)
        .arg("NX")
        .arg("EX")
        .arg(5i64)
        .query_async(redis)
        .await
        .unwrap_or(None);

    if won.is_none() {
        // Someone else is computing — wait briefly, then re-check the cache.
        tokio::time::sleep(Duration::from_millis(120)).await;
        if let Ok(Some(hit)) = redis.get::<_, Option<String>>(key).await {
            return Ok(hit);
        }
        // Still cold (slow producer / lost race) — compute uncached rather than block.
        return f().await;
    }

    // We hold the lock: compute, cache on success, release.
    let result = f().await;
    if let Ok(json) = &result {
        let _: () = redis.set_ex(key, json, ttl_secs.max(1)).await.unwrap_or(());
    }
    let _: i64 = redis.del(&lock_key).await.unwrap_or(0);
    result
}
