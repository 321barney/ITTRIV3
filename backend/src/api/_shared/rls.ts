// src/api/_shared/rls.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export function resolveDb(app: FastifyInstance) {
  const base: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);
  if (!base) throw new Error('db_not_bound');
  return base;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOrgIdentity(headerVal?: string | null): { sellerId?: string; email?: string } {
  if (!headerVal) return {};
  try {
    const j = JSON.parse(headerVal as string);
    const c = j?.context || j;
    return { sellerId: c?.sellerId ?? j?.sellerId, email: c?.email ?? j?.email };
  } catch {
    return {};
  }
}

/** ---------- Hook factories (return actual hook functions) ---------- */
export function rlsOnRequest(app: FastifyInstance) {
  const db = resolveDb(app);

  return async function onRequestHook(req: FastifyRequest, _reply: FastifyReply) {
    try {
      const u: any = (req as any).user || {};
      let sellerId: string | undefined = u.id || u.sellerId || u.seller_id || u.sub;

      if (!sellerId) {
        const fromHeader = parseOrgIdentity(req.headers['x-org-identity'] as any);
        sellerId = fromHeader.sellerId;
      }

      if (!sellerId || !UUID_RE.test(sellerId)) {
        req.log?.debug({ hasUser: !!u, keys: Object.keys(u || {}) }, 'rls_skip_no_valid_seller');
        return;
      }

      try {
        await db.raw('SET search_path = app, public');
        await db.raw('SELECT app.set_current_seller(?::uuid)', [sellerId]);
        (req as any)._rlsSet = true;
      } catch (inner) {
        req.log?.error(inner, 'rls_on_request_failed');
      }
    } catch (err) {
      req.log?.error({ err: String(err) }, 'rls_on_request_failed_outer');
    }
  };
}

export function rlsOnSend(app: FastifyInstance) {
  const db = resolveDb(app);

  return async function onSendHook(req: FastifyRequest, _reply: FastifyReply, payload: any) {
    if (!(req as any)._rlsSet) return payload;
    try {
      await db.raw('SELECT app.set_current_seller(NULL)');
    } catch (e) {
      req.log?.warn({ err: String(e) }, 'rls_clear_failed');
    } finally {
      (req as any)._rlsSet = false;
    }
    return payload;
  };
}

/** ---------- Convenience: one-call registrar ---------- */
export function registerRls(app: FastifyInstance) {
  app.addHook('onRequest', rlsOnRequest(app));
  app.addHook('onSend', rlsOnSend(app));
}

export default registerRls;
