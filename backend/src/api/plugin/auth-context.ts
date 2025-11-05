import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

type JwtUser = { id?: string; sub?: string; email?: string; role?: string; scopes?: string[]; [k: string]: any };

function pickToken(req: FastifyRequest): string | null {
  const auth = (req.headers.authorization ?? (req.headers as any).Authorization) as string | undefined;
  if (auth) { const m = /^Bearer\s+(.+)$/i.exec(auth.trim()); if (m) return m[1]; }
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

function isAdminRoute(req: FastifyRequest): boolean {
  const url = req.url || '';
  return url.startsWith('/api/v1/admin') || url.startsWith('/admin');
}

function parseOrgIdentity(headerVal?: string | null): { sellerId?: string; email?: string } {
  if (!headerVal) return {};
  try {
    const j = JSON.parse(headerVal as string);
    const c = (j as any)?.context || j;
    return { sellerId: c?.sellerId ?? (j as any)?.sellerId, email: c?.email ?? (j as any)?.email };
  } catch { return {}; }
}

export default fp(async function authContext(app: FastifyInstance) {
  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const adminOnly = isAdminRoute(req);

    // First try JWT (Authorization header or cookie)
    let token = pickToken(req);
    try {
      if (token) await (req as any).jwtVerify({ token });
      else await (req as any).jwtVerify();
    } catch (e) {
      // If admin route, JWT is mandatory.
      if (adminOnly) {
        req.log?.warn({ e, path: req.url }, 'jwt_verify_failed_admin');
        reply.header('X-Auth-Admin-Only', '1');
        return reply.code(401).send({ ok: false, error: 'unauthorized' });
      }
      // For seller routes, we'll allow proxy identity fallback below.
    }

    let user = normalizeUser((req as any).user);

    // For non-admin routes only, accept the proxy identity if JWT user was not present.
    if (!user && !adminOnly) {
      const orgCtx = parseOrgIdentity(req.headers['x-org-context'] as string);
      const orgId  = parseOrgIdentity(req.headers['x-org-identity'] as string);
      const sellerId = orgCtx.sellerId || orgId.sellerId;
      const email    = orgCtx.email    || orgId.email;
      if (sellerId) user = { id: sellerId, email, role: 'seller', method: orgCtx.sellerId ? 'orgctx' : 'orgid' };
    }

    if (!user) {
      reply.header('X-Auth-Admin-Only', adminOnly ? '1' : '0');
      return reply.code(401).send({ ok: false, error: 'unauthorized', hint: 'missing user id' });
    }

    const role = (user.role || '').toLowerCase();
    if (adminOnly && role !== 'admin') {
      reply.header('X-Auth-Admin-Only', '1');
      return reply.code(403).send({ ok: false, error: 'forbidden', hint: 'admin_required' });
    }

    // Debug headers (handy when hitting via proxy)
    reply.header('X-Auth-Admin-Only', '0');
    reply.header('X-Auth-Plugin', '1');
    reply.header('X-Auth-User-Id', user.id as any);
    reply.header('X-Auth-User-Role', role);
    reply.header('X-Auth-User-Method', (user as any).method || (token ? 'jwt' : 'orgid'));

    (req as any).user = user;
  });
});
