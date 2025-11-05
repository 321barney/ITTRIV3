import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { err } from './http';

export type JwtUser = { id: string; sub?: string; role?: string; scopes?: string[] } & Record<string, any>;

function pickToken(req: FastifyRequest): string | null {
  const auth = (req.headers.authorization ?? (req.headers as any).Authorization) as string | undefined;
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  const x = (req.headers as any)['x-access-token'];
  if (typeof x === 'string' && x.split('.').length === 3) return x.trim() || null;
  const raw = req.headers.cookie || '';
  for (const p of raw.split(';')) {
    const [k, ...rest] = p.trim().split('=');
    if (k === 'access_token') return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

function normalizeUser(u: any | undefined): JwtUser | undefined {
  if (!u) return undefined;
  const id = u.id || u.sub;
  if (!id) return undefined;
  return { ...u, id };
}

function parseOrgIdentity(headerVal?: string | null) {
  if (!headerVal) return {} as { sellerId?: string; email?: string };
  try {
    const j = JSON.parse(headerVal as string);
    const c = (j as any)?.context || j;
    return { sellerId: c?.sellerId ?? (j as any)?.sellerId, email: c?.email ?? (j as any)?.email };
  } catch {
    return {};
  }
}

/**
 * Pure seller-friendly auth that DOES NOT delegate to app.requireAuth.
 * - Verifies JWT when present
 * - Allows proxy identity headers (X-Org-Identity / X-Org-Context) for non-admin routes
 */
export function requireAuth(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Try JWT
    const token = pickToken(req);
    try {
      if (token) await (req as any).jwtVerify({ token });
      else await (req as any).jwtVerify();
    } catch (e) {
      // ignore, we may succeed via proxy identity
    }

    let user = normalizeUser((req as any).user);

    // Allow proxy identity
    if (!user) {
      const orgCtx = parseOrgIdentity(req.headers['x-org-context'] as any);
      const orgId  = parseOrgIdentity(req.headers['x-org-identity'] as any);
      const sellerId = orgCtx.sellerId || orgId.sellerId;
      const email    = orgCtx.email    || orgId.email;
      if (sellerId) user = { id: sellerId, email, role: 'seller' } as any;
    }

    if (!user) return reply.code(401).send(err('unauthorized', 'missing user id'));
    (req as any).user = user;
  };
}

export function requireAdmin(_app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = normalizeUser((req as any).user);
    const scopes: string[] = (user?.scopes ?? []) as any;
    const isAdmin = (user?.role ?? '') === 'admin' || scopes.includes('admin') || scopes.includes('admin:all');
    if (!user || !isAdmin) {
      return reply.code(403).send({ ok: false, error: 'forbidden', hint: 'admin_required' });
    }
  };
}

export function requireScopes(...scopes: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = normalizeUser((req as any).user);
    const ok = !!user && scopes.every(s => (user.scopes ?? []).includes(s));
    if (!ok) return reply.code(403).send(err('insufficient_scope'));
  };
}
