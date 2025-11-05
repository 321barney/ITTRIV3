import type { Redis } from "ioredis";

/**
 * Login throttle: limit attempts within a time window.
 * Fails open (no block) if Redis isn’t reachable — avoids breaking login entirely.
 */
export async function checkAuthThrottle(
  redis: Redis | undefined,
  key: string,
  limit = 5,
  windowSec = 15 * 60
): Promise<{ blocked: boolean; retryAfter?: number; tryCount?: number }> {
  try {
    if (!redis) return { blocked: false };
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSec);
    if (n > limit) {
      const ttl = await redis.ttl(key);
      return { blocked: true, retryAfter: ttl };
    }
    return { blocked: false, tryCount: n };
  } catch {
    return { blocked: false }; // don’t break login if Redis hiccups
  }
}

export async function resetAuthThrottle(redis: Redis | undefined, key: string) {
  try { await redis?.del(key); } catch { /* no-op */ }
}
