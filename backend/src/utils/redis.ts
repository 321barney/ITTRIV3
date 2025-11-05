// src/utils/redis.ts
import IORedis from 'ioredis';

const truthy = (v?: string | null) =>
  typeof v === 'string' && !['0', 'false', 'no', 'off', ''].includes(v.trim().toLowerCase());

export const REDIS_ENABLED = truthy(process.env.REDIS_ENABLED ?? '1');

/** Normalize env URL: decode %22, strip quotes, default if blank */
function normalizeRedisUrl(input?: string): string {
  let raw = (input ?? '').trim();
  try {
    const dec = decodeURIComponent(raw);
    if (/%22/.test(raw)) raw = dec;
  } catch { /* ignore */ }
  raw = raw.replace(/^["']+/, '').replace(/["']+$/, '');
  return raw || 'redis://127.0.0.1:6379/1';
}

const url = normalizeRedisUrl(process.env.REDIS_URL);

/** Build a real ioredis client (TLS for rediss://) */
function makeClient(u: string) {
  const useTls = u.startsWith('rediss://');
  return new IORedis(u, {
    ...(useTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,   // BullMQ recommendation
    enableReadyCheck: true,
    retryStrategy: times => Math.min(1000 * Math.pow(2, times), 30000),
  });
}

let lastError: string | null = null;

/** Real client when enabled; otherwise a minimal no-op shim */
const redis: any = REDIS_ENABLED
  ? makeClient(url)
  : {
      status: 'end',
      on: () => redis,
      quit: async () => {},
      disconnect: () => {},
      // Minimal async stubs some callers might touch:
      get: async () => null,
      set: async () => 'OK',
      del: async () => 0,
      publish: async () => 0,
      subscribe: async () => {},
      psubscribe: async () => {},
      eval: async () => null,
    };

if (REDIS_ENABLED) {
  redis.on('error', (e: any) => {
    lastError = String(e?.message || e);
    console.error('[redis] error', lastError);
  });
  redis.on('ready', () => console.log('[redis] ready'));
} else {
  console.log('[redis] disabled (REDIS_ENABLED=false)');
}

export { redis };

/** BullMQ expects an options object like { connection } */
export const bullConnection = REDIS_ENABLED ? { connection: redis as IORedis } : undefined;

/** Helpers */
export function isRedisEnabled() { return REDIS_ENABLED; }
export function getLastRedisError() { return lastError; }
export function getRedisUrl() { return url; }
