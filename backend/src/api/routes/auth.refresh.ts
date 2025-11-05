import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import fp from 'fastify-plugin';

type Body = { refresh_token?: string };

function readCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const p of raw.split(';')) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

const ACCESS_TTL_SEC = 60 * 60 * 24 * 7; // 7 days - must match login
export default fp(async function registerAuthRefresh(app: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

  const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? undefined;
  const COOKIE_SECURE = (process.env.NODE_ENV ?? 'development') !== 'development';

  const buildSetCookie = (
    name: string, value: string,
    { maxAge, path = '/', sameSite = 'lax', httpOnly = true }: {
      maxAge: number; path?: string; sameSite?: 'lax'|'strict'|'none'|'Lax'|'Strict'|'None'; httpOnly?: boolean
    }
  ) =>
    `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}; ${COOKIE_SECURE ? 'Secure; ' : ''}HttpOnly` +
    (COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : '');

  app.post('/refresh', async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
    // accept from cookie OR JSON body
    const incoming = readCookie(req, 'refresh_token') || req.body?.refresh_token || null;
    if (!incoming) return reply.code(401).send({ ok:false, error:'no_refresh_token' });

    let payload: any;
    try { payload = jwt.verify(incoming, JWT_SECRET); }
    catch { return reply.code(401).send({ ok:false, error:'invalid_refresh' }); }

    const sub = payload?.sub || payload?.id;
    if (!sub) return reply.code(401).send({ ok:false, error:'invalid_refresh' });

    // (Optional) check a token version / revocation list in DB/Redis here.

    // issue fresh access
    const access = jwt.sign(
      { sub, role: payload?.role ?? 'seller', tier: payload?.tier ?? 'starter', ver: payload?.ver ?? 1 },
      JWT_SECRET,
      { expiresIn: ACCESS_TTL_SEC }
    );

    // Set (HttpOnly) access cookie to make cookie-only requests work too
    reply.header('set-cookie', buildSetCookie('access_token', access, { maxAge: ACCESS_TTL_SEC }));

    return reply.send({ ok:true, access_token: access });
  });
});
