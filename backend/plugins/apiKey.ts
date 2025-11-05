// backend/src/plugins/apiKey.ts
import fp from 'fastify-plugin';
import bcrypt from 'bcryptjs';

type ApiKeyCtx = {
  user_id?: string | null;
  store_id?: string | null;
  key_id?: string | null;      // Optional (if you store a key id)
  scopes?: string[] | null;    // Optional (if you store scopes)
  name?: string | null;        // Optional (dev label)
};

declare module 'fastify' {
  interface FastifyInstance {
    requireApiKey: (req: any, rep: any) => Promise<void>;
  }
  interface FastifyRequest {
    apiKey?: ApiKeyCtx;
  }
}

// Tiny in-memory cache (key -> {ctx, exp})
const CACHE_TTL_MS = Number(process.env.APIKEY_CACHE_TTL_MS ?? 30_000);
const apiKeyCache = new Map<string, { ctx: ApiKeyCtx; exp: number }>();

function now() { return Date.now(); }
function cacheGet(k: string) {
  const v = apiKeyCache.get(k);
  if (!v) return null;
  if (v.exp < now()) { apiKeyCache.delete(k); return null; }
  return v.ctx;
}
function cacheSet(k: string, ctx: ApiKeyCtx) {
  apiKeyCache.set(k, { ctx, exp: now() + CACHE_TTL_MS });
}

function parsePresentedKey(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0].trim();
  return null;
}

function readKeyFromHeaders(req: any): string | null {
  // Support: X-API-Key: <key>
  const key = parsePresentedKey(req.headers['x-api-key']);
  if (key) return key;

  // Or: Authorization: ApiKey <key>
  const auth = parsePresentedKey(req.headers['authorization']);
  if (!auth) return null;
  const m = auth.match(/^ApiKey\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Optional key format (recommended):
 *   ak_live_<8charprefix>_<random>
 * If present, we’ll use the <8charprefix> to target a single row via `key_prefix`.
 */
function extractPrefix(apiKey: string): string | null {
  const m = apiKey.match(/^ak_[a-z]+_([A-Za-z0-9]{6,16})_/);
  return m ? m[1] : null;
}

export default fp(async function apiKeyPlugin(app) {
  // Resolve Knex from app
  const db: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);

  if (!db) {
    app.log.warn('apiKeyPlugin: no database bound to app.db; plugin loaded but will reject requests.');
  }

  app.decorate('requireApiKey', async (req, reply) => {
    const presented = readKeyFromHeaders(req);
    if (!presented) {
      return reply.code(401).send({ ok: false, error: 'missing_api_key' });
    }

    // Fast path: cache
    const cached = cacheGet(presented);
    if (cached) {
      req.apiKey = cached;
      return;
    }

    if (!db) {
      return reply.code(500).send({ ok: false, error: 'database_unavailable' });
    }

    try {
      // Prefer prefix lookup if schema supports it
      const prefix = extractPrefix(presented);
      let rows: any[];

      if (prefix) {
        // If you add a column `key_prefix` (varchar) + index, this becomes O(1)
        // Schema hint:
        //   ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix varchar(32);
        //   CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active ON api_keys(key_prefix, active);
        rows = await db('api_keys')
          .where({ active: true, key_prefix: prefix })
          .limit(5); // belt and suspenders in case of duplicates
      } else {
        // Fallback: limited scan of active keys (avoid full scan)
        rows = await db('api_keys')
          .select('*')
          .where({ active: true })
          .limit(500); // safety cap
      }

      // Constant-time hash check on the small candidate set
      let match: any | null = null;
      for (const row of rows) {
        if (!row?.key_hash) continue;
        const ok = await bcrypt.compare(presented, String(row.key_hash));
        if (ok) { match = row; break; }
      }

      if (!match) {
        return reply.code(401).send({ ok: false, error: 'invalid_api_key' });
      }

      const ctx: ApiKeyCtx = {
        user_id: match.user_id ?? null,
        store_id: match.store_id ?? null,
        key_id: match.id ?? null,
        scopes: Array.isArray(match.scopes) ? match.scopes : null,
        name: match.name ?? null,
      };

      // Attach to request
      req.apiKey = ctx;

      // Cache this key for a short period (avoid repeated bcrypt)
      cacheSet(presented, ctx);

      // Best-effort: update last used metadata (don’t await)
      Promise.resolve().then(async () => {
        try {
          await db('api_keys')
            .where({ id: match.id })
            .update({
              last_used_at: new Date(),
              last_used_ip: req.ip ?? null,
            });
        } catch (e) {
          app.log.debug({ e }, 'apiKey last_used update failed (ignored)');
        }
      });
    } catch (e) {
      req.log?.error?.(e, 'apiKey verification failed');
      return reply.code(500).send({ ok: false, error: 'internal' });
    }
  });
});
