// src/api/_shared/ensureSellerId.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveDb } from './rls';
import { importJWK, jwtVerify, JWK } from 'jose';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOrgIdentity(headerVal?: string | null) {
  if (!headerVal) return {} as { sellerId?: string; email?: string };
  try {
    const j = JSON.parse(headerVal);
    const c = j?.context || j;
    return { sellerId: c?.sellerId ?? j?.sellerId, email: c?.email ?? j?.email };
  } catch {
    return {};
  }
}

let _verifyOrgCtx: null | ((t: string) => Promise<any>) = null;
async function getOrgCtxVerifier() {
  if (_verifyOrgCtx !== null) return _verifyOrgCtx;
  const raw = process.env.ORG_CONTEXT_PUBLIC_JWK;
  if (!raw) {
    _verifyOrgCtx = async () => { throw new Error('no_orgctx_key'); };
    return _verifyOrgCtx;
  }
  const jwk: JWK = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
  const key = await importJWK(jwk, 'EdDSA');
  _verifyOrgCtx = async (token: string) =>
    (await jwtVerify(token, key, {
      issuer: process.env.ORG_CONTEXT_ISSUER,
      audience: process.env.ORG_CONTEXT_AUDIENCE,
    })).payload;
  return _verifyOrgCtx;
}

export function ensureSellerIdHook(app: FastifyInstance) {
  const db = resolveDb(app);

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const u: any = (req as any).user ?? {};
    let sellerId: string | undefined =
      u.id || u.sellerId || u.seller_id || u.sub || undefined;
    let email: string | undefined =
      u.email || u.user_email || u.preferred_username || u.upn || undefined;

    // 1) Prefer signed X-Org-Context if present
    const orgCtx = (req.headers['x-org-context'] as string | undefined)?.trim();
    if ((!sellerId || !email) && orgCtx) {
      try {
        const verify = await getOrgCtxVerifier();
        const p: any = await verify(orgCtx);
        const s = p?.context?.sellerId;
        const e = p?.context?.email;
        if (s && e) { sellerId = sellerId || s; email = email || e; }
      } catch { /* ignore, continue */ }
    }

    // 2) Unsigned identity (dev) only if BOTH provided
    if (!sellerId || !email) {
      const idFromHeader = parseOrgIdentity(req.headers['x-org-identity'] as any);
      if (idFromHeader.sellerId && idFromHeader.email) {
        sellerId = sellerId || idFromHeader.sellerId;
        email    = email    || idFromHeader.email;
      }
    }

    // 3) Last resort: lookup by email (skip obviously fake placeholder)
    if ((!sellerId || !UUID_RE.test(sellerId)) && email && !/example\.local$/i.test(email)) {
      try {
        // Try app.sellers, then public.sellers
        let row: any;
        try {
          const r1 = await (db as any).raw(
            `SELECT id FROM app.sellers WHERE user_email = ? LIMIT 1`,
            [email],
          );
          row = r1?.rows?.[0];
        } catch {
          const r2 = await (db as any).raw(
            `SELECT id FROM public.sellers WHERE user_email = ? LIMIT 1`,
            [email],
          );
          row = r2?.rows?.[0];
        }
        sellerId = row?.id ?? sellerId;
      } catch (e) {
        req.log?.warn({ err: String(e) }, 'ensureSeller_lookup_failed');
      }
    }

    if (!sellerId || !UUID_RE.test(sellerId)) {
      return reply
        .code(401)
        .send({ ok: false, error: 'unauthorized', hint: 'missing sellerId' });
    }

    (req as any).user = { ...(u || {}), id: sellerId, email, method: u?.method || 'resolved' };
  };
}
