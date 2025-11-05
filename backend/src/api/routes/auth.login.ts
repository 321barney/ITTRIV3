// src/api/routes/auth.login.ts
// Security: no dynamic code exec; Zod validation; Redis-based login throttling; safe cookies.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as crypto from 'node:crypto';

import { redis } from '../../lib/redis';
import { checkAuthThrottle, resetAuthThrottle } from '../../lib/authThrottle';
import * as Schemas from '../../schemas';
import { getDb } from '../../db/index.js';

type Role = 'buyer' | 'seller' | 'admin';
type Tier = 'starter' | 'pro' | 'enterprise';

interface JwtPayload {
  sub: string;
  role: Role;
  tier: Tier;
  iat: number;
  exp: number;
  ver: number;
}

const ACCESS_TTL_SEC = 60 * 60 * 24 * 7;   // 7 days
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function signAccess(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string) {
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TTL_SEC });
}
function signRefresh(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string) {
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TTL_SEC });
}

const scryptAsync = (pwd: string, salt: Buffer, keylen = 64) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(pwd, salt, keylen, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
  });

async function verifyPasswordScrypt(password: string, stored: string): Promise<boolean> {
  try {
    const [method, saltHex, hashHex] = String(stored).split('$');
    if (method !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const dk = await scryptAsync(password, salt, 64);
    const got = Buffer.from(hashHex, 'hex');
    if (dk.length !== got.length) return false;
    return crypto.timingSafeEqual(dk, got);
  } catch {
    return false;
  }
}

type LoginBody = { email: string; password: string; login_type?: 'user' | 'seller' };
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('invalid_password', 10);

function buildSetCookie(
  name: string,
  value: string,
  {
    domain,
    secure,
    maxAge,
    path = '/',
    sameSite = 'lax',
    httpOnly = true,
  }: {
    domain?: string;
    secure?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: 'lax' | 'strict' | 'none' | 'Lax' | 'Strict' | 'None';
    httpOnly?: boolean;
  } = {}
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (path) parts.push(`Path=${path}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${maxAge}`);
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push(`Secure`);
  if (httpOnly) parts.push(`HttpOnly`);
  return parts.join('; ');
}

async function withBypass<T>(knex: any, fn: (trx: any) => Promise<T>): Promise<T> {
  return knex.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL ROLE app_admin');
    return fn(trx);
  });
}

export default async function registerLoginRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
  const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? undefined;
  const COOKIE_SECURE = (process.env.NODE_ENV ?? 'development') !== 'development';

  const getKnex = () => ((app as any).db ?? getDb?.());

  function readBearer(req: FastifyRequest): string | null {
    const h =
      (req.headers['authorization'] as string | undefined) ||
      (req.headers['Authorization'] as string | undefined);
    if (!h) return null;
    const m = /^Bearer\s+(.+)$/.exec(h.trim());
    return m ? m[1] : null;
  }

  // PUBLIC: GET /auth/me
  app.get('/me', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = readBearer(req);
      if (!token) return reply.code(401).send({ ok: false, error: 'missing_token' });

      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      } catch {
        return reply.code(401).send({ ok: false, error: 'invalid_token' });
      }

      const knex = getKnex();
      if (!knex) return reply.code(500).send({ ok: false, error: 'database_unavailable' });

      if (payload.role === 'seller') {
        const seller = await knex('sellers').where({ id: payload.sub }).first().catch(() => null);
        if (!seller) return reply.code(404).send({ ok: false, error: 'seller_not_found' });

        const store = await knex('stores')
          .select('id', 'name', 'status', 'has_gsheet', 'has_whatsapp', 'created_at', 'updated_at')
          .where({ seller_id: seller.id })
          .orderBy('created_at', 'asc')
          .first()
          .catch(() => null);

        const tier: Tier =
          seller.plan_code === 'enterprise' ? 'enterprise' :
          seller.plan_code === 'pro' ? 'pro' : 'starter';

        return reply.send({
          ok: true,
          user_type: 'seller',
          user: {
            id: seller.id,
            email: seller.user_email,
            company_name: seller.company_name,
            role: 'seller',
            tier,
            plan: seller.plan_code ?? 'basic',
          },
          default_store: store
            ? {
                id: store.id,
                name: store.name,
                status: store.status,
                has_gsheet: !!store.has_gsheet,
                has_whatsapp: !!store.has_whatsapp,
                created_at: store.created_at,
                updated_at: store.updated_at,
              }
            : null,
        });
      }

      const user = await knex('users').where({ id: payload.sub }).first().catch(() => null);
      if (!user) return reply.code(404).send({ ok: false, error: 'user_not_found' });

      return reply.send({
        ok: true,
        user_type: 'user',
        user: { id: user.id, email: user.email, role: user.role, tier: user.tier },
      });
    } catch (e) {
      req.log?.error?.(e);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'whoami_failed' });
    }
  });

  // PUBLIC: POST /auth/login
  app.post('/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const knex = getKnex();
    if (!knex) return reply.code(500).send({ ok: false, error: 'database_unavailable' });

    // Zod validation
    const parsed = Schemas.LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(parsed.error.flatten());
    }
    const { email, password, login_type = 'user' } = parsed.data;
    const emailNorm = email.trim();

    // Throttle check BEFORE any DB lookup
    const throttleKey = `auth:fail:${emailNorm.toLowerCase()}`;
    const thr = await checkAuthThrottle(redis as any, throttleKey);
    if (thr && (thr as any).blocked) {
      return reply.code(429).send({ ok: false, error: 'too_many_attempts', retry_after: (thr as any).retryAfter });
    }

    try {
      if (login_type === 'seller') {
        const result = await withBypass(knex, async (db) => {
          const seller = await db('sellers')
            .whereRaw('LOWER(user_email) = LOWER(?)', [emailNorm])
            .first();

          if (!seller || !seller.password_hash) {
            await verifyPasswordScrypt(
              password,
              'scrypt$' + crypto.randomBytes(16).toString('hex') + '$' + crypto.randomBytes(64).toString('hex')
            );
            return { ok: false as const, code: 401 as const, err: 'invalid_credentials' as const };
          }

          const ok = await verifyPasswordScrypt(password, seller.password_hash);
          if (!ok) return { ok: false as const, code: 401 as const, err: 'invalid_credentials' as const };

          const tier: Tier =
            seller.plan_code === 'enterprise' ? 'enterprise' :
            seller.plan_code === 'pro' ? 'pro' : 'starter';

          const ver = 1;
          const access = signAccess({ sub: String(seller.id), role: 'seller', tier, ver }, JWT_SECRET);
          const refresh = signRefresh({ sub: String(seller.id), role: 'seller', tier, ver }, JWT_SECRET);

          // Select store with most orders, fallback to first created
          const storeWithOrders = await db.raw(`
            SELECT s.id, s.name, s.status, s.has_gsheet, s.has_whatsapp, s.created_at, s.updated_at,
                   COUNT(o.id) as order_count
            FROM stores s
            LEFT JOIN orders o ON o.store_id = s.id
            WHERE s.seller_id = ?
            GROUP BY s.id, s.name, s.status, s.has_gsheet, s.has_whatsapp, s.created_at, s.updated_at
            ORDER BY order_count DESC, s.created_at ASC
            LIMIT 1
          `, [seller.id]).then(r => r.rows?.[0] || null).catch(() => null);
          
          const store = storeWithOrders;

          return {
            ok: true as const,
            code: 200 as const,
            body: {
              ok: true,
              access_token: access,
              user_type: 'seller',
              user: {
                id: seller.id,
                email: seller.user_email,
                company_name: seller.company_name,
                role: 'seller',
                tier,
                plan: seller.plan_code,
              },
              default_store: store
                ? {
                    id: store.id,
                    name: store.name,
                    status: store.status,
                    has_gsheet: !!store.has_gsheet,
                    has_whatsapp: !!store.has_whatsapp,
                    created_at: store.created_at,
                    updated_at: store.updated_at,
                  }
                : null,
              refresh_token: refresh,
            },
          };
        });

        if (!result.ok) {
          return reply.code(result.code).send({ ok: false, error: result.err });
        }

        const setCk = buildSetCookie('refresh_token', result.body.refresh_token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: COOKIE_SECURE,
          path: '/',
          domain: COOKIE_DOMAIN,
          maxAge: REFRESH_TTL_SEC,
        });
        reply.header('set-cookie', setCk);

        await resetAuthThrottle(redis as any, throttleKey);
        // Keep refresh_token in JSON response for frontend to handle cookie forwarding
        return reply.code(result.code).send(result.body);
      }

      // user login (bcrypt)
      const user = await knex('users')
        .whereRaw('LOWER(email) = LOWER(?)', [emailNorm])
        .first()
        .catch(() => null);

      if (!user) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH); // uniform timing
        return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
      }

      const hash = String(user.password_hash || '');
      if (!hash.startsWith('$2')) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
      }

      const ok = await bcrypt.compare(password, hash);
      if (!ok) return reply.code(401).send({ ok: false, error: 'invalid_credentials' });

      const ver = Number.isFinite(user.token_ver) ? Number(user.token_ver) : 1;
      const access = signAccess({ sub: String(user.id), role: user.role as Role, tier: user.tier as Tier, ver }, JWT_SECRET);
      const refresh = signRefresh({ sub: String(user.id), role: user.role as Role, tier: user.tier as Tier, ver }, JWT_SECRET);

      const setCk = buildSetCookie('refresh_token', refresh, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        path: '/',
        domain: COOKIE_DOMAIN,
        maxAge: REFRESH_TTL_SEC,
      });
      reply.header('set-cookie', setCk);

      await resetAuthThrottle(redis as any, throttleKey);
      return reply.send({
        ok: true,
        access_token: access,
        user_type: 'user',
        user: { id: user.id, email: user.email, role: user.role, tier: user.tier },
      });
    } catch (e) {
      req.log?.error?.(e);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'Login failed' });
    }
  });
}
