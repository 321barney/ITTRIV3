import { Redis } from "ioredis";

/** Strip accidental quotes and encoded quotes from env values (common on Replit). */
function clean(url: string) {
  return url.replace(/^["']|["']$/g, "").replace(/^%22|%22$/g, "");
}

const RAW = process.env.REDIS_URL || "";
const URL = clean(RAW);

/**
 * Single Redis client for the app.
 * - Works with `rediss://` (Upstash) or local `redis://localhost:6379`
 * - Auto-pipelining for perf
 * - Conservative retry/backoff
 * - Never crashes the app on connection errors
 */
export const redis = new Redis(URL || "redis://localhost:6379", {
  tls: URL.startsWith("rediss://") ? {} : undefined,
  enableAutoPipelining: true,
  lazyConnect: false,             // connect on import so we fail fast in dev
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(1000 * 2 ** times, 15000),
  reconnectOnError: (err) => {
    // retry on common transient TLS/ECONNRESET issues
    const msg = String(err?.message || "");
    return /READONLY|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/i.test(msg);
  },
});

redis.on("ready", () => {
  console.log("[redis] ✅ connected");
});
redis.on("error", (err) => {
  console.error("[redis] error:", err?.message || err);
});

/** Safe helpers that never throw if Redis is temporarily unavailable. */
export async function safeIncr(key: string): Promise<number | null> {
  try { return await redis.incr(key); } catch { return null; }
}
export async function safeExpire(key: string, sec: number): Promise<boolean> {
  try { return (await redis.expire(key, sec)) === 1; } catch { return false; }
}
export async function safeTtl(key: string): Promise<number | null> {
  try { return await redis.ttl(key); } catch { return null; }
}
export async function safeDel(key: string): Promise<void> {
  try { await redis.del(key); } catch { /* no-op */ }
}
