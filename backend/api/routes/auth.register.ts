// backend/src/api/routes/auth.register.ts
// Account creation with optional Stripe integration (toggle via STRIPE_ENABLED).
// - Validates basics
// - Uses scrypt for sellers, bcrypt for users
// - Creates Stripe customer when STRIPE_ENABLED=true
// - Provides /refresh (via refresh_token cookie) and /logout

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as crypto from 'node:crypto';
import type { Knex } from 'knex';
import { getDb } from '../../db/index.js';

// ───── Types ───────────────────────────────────────────────────────────────────
type Role = 'buyer' | 'seller' | 'admin';
type Tier  = 'starter' | 'pro' | 'enterprise';

interface JwtPayload {
  sub: string;
  role: Role;
  tier: Tier;
  iat: number;
  exp: number;
  ver: number; // token version for rotation
}

type RegisterBody = {
  email: string;
  password: string;
  role?: Role;
  tier?: Tier;
  company_name?: string;
  plan?: string; // plan code, e.g. basic/starter/pro/enterprise
};

// ───── Config / Flags ─────────────────────────────────────────────────────────
const STRIPE_ENABLED =
  (process.env.STRIPE_ENABLED ?? process.env.ENABLE_STRIPE ?? 'false')
    .toString()
    .toLowerCase() === 'true';

const ACCESS_TTL_SEC  = 60 * 60 * 24 * 7;  // 7 days
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

// ───── Small utils ────────────────────────────────────────────────────────────
function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function signAccess(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string) {
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TTL_SEC });
}

function cookieString(
  name: string, value: string, {
  domain, secure, maxAge, path = '/', sameSite = 'lax', httpOnly = true,
}: {
  domain?: string; secure?: boolean; maxAge?: number; path?: string;
  sameSite?: 'lax' | 'strict' | 'none' | 'Lax' | 'Strict' | 'None'; httpOnly?: boolean;
} = {}
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (path) parts.push(`Path=${path}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${maxAge}`);
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

// scrypt helpers for sellers
const scryptAsync = (pwd: string, salt: Buffer, keylen = 64) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(pwd, salt, keylen, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
  });

async function hashPasswordScrypt(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const dk   = await scryptAsync(password, salt, 64);
  // matches DB CHECK (password_hash LIKE 'scrypt$%$%')
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

// Scoped admin elevation (no role leaks)
async function withAdmin<T>(knex: Knex, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  // NOTE: Using a transaction and `SET LOCAL ROLE` ensures scope is limited to this txn.
  return knex.transaction(async (trx) => {
    await trx.raw('SET LOCAL ROLE app_admin');
    return fn(trx);
  });
}

// ───── Stripe helper (loaded only if enabled) ─────────────────────────────────
async function getStripe() {
  if (!STRIPE_ENABLED) return null;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_ENABLED=true but STRIPE_SECRET_KEY is missing');
  const mod = await import('stripe');
  return new mod.default(key, { apiVersion: '2024-06-20' as any });
}

// ───── Route module ───────────────────────────────────────────────────────────
export default async function registerAuthRoutes(app: FastifyInstance) {
  const JWT_SECRET    = process.env.JWT_SECRET || 'dev';
  const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? undefined;
  const COOKIE_SECURE = (process.env.NODE_ENV ?? 'development') !== 'development';

  // Prefer an already-attached db on app; else fallback to getDb()
  const getKnex = (): Knex | undefined => ((app as any).db ?? getDb?.());

  // Health check (auth service)
  app.get('/health', async () => ({ ok: true }));

  // REGISTER: creates user or seller ACCOUNT ONLY (no stores here)
  app.post('/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    const knex = getKnex();
    if (!knex) return reply.code(500).send({ ok: false, error: 'database_unavailable' });

    const {
      email,
      password,
      role = 'seller',
      tier  = 'starter',
      company_name,
      plan,
    } = req.body || {};

    // Basic validation
    if (!email || !isEmail(email)) {
      return reply.code(400).send({ ok: false, error: 'invalid_email' });
    }
    if (!password || password.length < 6) {
      return reply.code(400).send({ ok: false, error: 'weak_password', message: 'Password must be at least 6 characters.' });
    }
    if (!['buyer', 'seller', 'admin'].includes(role)) {
      return reply.code(400).send({ ok: false, error: 'invalid_role' });
    }
    if (!['starter', 'pro', 'enterprise'].includes(tier)) {
      return reply.code(400).send({ ok: false, error: 'invalid_tier' });
    }

    const emailNorm = email.trim();
    const plan_code = (plan ?? 'basic').toLowerCase();

    try {
      if (role === 'seller') {
        // SELLER ACCOUNT CREATION (under admin to bypass RLS on sellers/plans)
        return await withAdmin(knex, async (db) => {
          // Validate plan FK
          const planRow = await db('plans').where({ code: plan_code }).first();
          if (!planRow) {
            return reply.code(400).send({ ok: false, error: 'invalid_plan', message: `Unknown plan: ${plan_code}` });
          }

          // Unique email (CI)
          const exists = await db('sellers').whereRaw('LOWER(user_email) = LOWER(?)', [emailNorm]).first();
          if (exists) return reply.code(409).send({ ok: false, error: 'email_in_use' });

          // Hash password (scrypt)
          const password_hash = await hashPasswordScrypt(password);
          const now = new Date();

          const [seller] = await db('sellers')
            .insert({
              user_email: emailNorm,
              company_name: company_name ?? null,
              plan_code,
              password_hash,
              created_at: now,
              updated_at: now,
            })
            .returning(['id', 'user_email', 'company_name', 'plan_code', 'billing_cycle_start']);

          // Stripe (optional)
          if (!STRIPE_ENABLED) {
            return reply.send({
              ok: true,
              mode: 'no_stripe',
              user_type: 'seller',
              seller: {
                id: seller.id,
                email: seller.user_email,
                company_name: seller.company_name,
                plan: seller.plan_code,
                billing_cycle_start: seller.billing_cycle_start,
              },
              message: 'Stripe disabled via STRIPE_ENABLED=false',
              next_action: 'create_store',
            });
          }

          const stripe = await getStripe(); // throws if misconfigured
          const customer = await stripe!.customers.create({
            email: emailNorm,
            name: company_name || emailNorm,
            metadata: { seller_id: String(seller.id) },
          });

          // Optional: map plan_code -> price id via env
          const priceIdMap: Record<string, string | undefined> = {
            basic:       process.env.STRIPE_PRICE_BASIC,
            starter:     process.env.STRIPE_PRICE_STARTER,
            pro:         process.env.STRIPE_PRICE_PRO,
            enterprise:  process.env.STRIPE_PRICE_ENTERPRISE,
          };
          const priceId = priceIdMap[plan_code];

          let checkoutUrl: string | undefined;
          if (priceId) {
            const session = await stripe!.checkout.sessions.create({
              mode: 'subscription',
              customer: customer.id,
              line_items: [{ price: priceId, quantity: 1 }],
              success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/success',
              cancel_url:  process.env.STRIPE_CANCEL_URL  || 'http://localhost:3000/cancel',
              metadata: { seller_id: String(seller.id) },
            });
            checkoutUrl = session.url ?? undefined;
          }

          return reply.send({
            ok: true,
            mode: 'stripe',
            user_type: 'seller',
            seller: {
              id: seller.id,
              email: seller.user_email,
              company_name: seller.company_name,
              plan: seller.plan_code,
              billing_cycle_start: seller.billing_cycle_start,
            },
            stripe: { customerId: customer.id, ...(checkoutUrl ? { checkoutUrl } : {}) },
            next_action: 'create_store',
          });
        });
      }

      // REGULAR USER (buyer/admin)
      return await withAdmin(knex, async (db) => {
        const exists = await db('users').whereRaw('LOWER(email) = LOWER(?)', [emailNorm]).first();
        if (exists) return reply.code(409).send({ ok: false, error: 'email_in_use' });

        const password_hash = await bcrypt.hash(password, 12);
        const [user] = await db('users')
          .insert({ email: emailNorm, password_hash, role, tier, token_ver: 1 })
          .returning(['id', 'role', 'tier']);

        return reply.send({
          ok: true,
          user_type: 'user',
          user_id: user.id,
          role: user.role,
          tier: user.tier,
          next_action: role === 'seller' ? 'contact_support' : 'none',
        });
      });
    } catch (err: any) {
      req.log?.error?.(err);
      if (err?.code === '42P01') return reply.code(500).send({ ok: false, error: 'schema_missing', message: 'Missing required database tables.' });
      if (err?.code === '23503') return reply.code(400).send({ ok: false, error: 'invalid_plan', message: 'Unknown plan_code' });
      if (err?.code === '23505') return reply.code(409).send({ ok: false, error: 'email_in_use' });
      return reply.code(500).send({ ok: false, error: 'internal', message: err?.message ?? 'Internal Server Error' });
    }
  });

  // POST /auth/refresh — mints a new access token from HttpOnly refresh cookie
  app.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const knex = getKnex();
    if (!knex) return reply.code(500).send({ ok: false, error: 'database_unavailable' });

    // Works even without @fastify/cookie: fall back to manual header parse
    const cookieHeader = (req.headers['cookie'] || req.headers['Cookie']) as string | undefined;
    const cookies = Object.fromEntries(
      (cookieHeader || '')
        .split(/;\s*/)
        .filter(Boolean)
        .map(p => {
          const i = p.indexOf('=');
          return i === -1 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
        })
    );
    const token = cookies['refresh_token'];
    if (!token) return reply.code(401).send({ ok: false, error: 'no_refresh' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

      return await withAdmin(knex, async (db) => {
        if (decoded.role === 'seller') {
          const seller = await db('sellers').where({ id: decoded.sub }).first();
          if (!seller) return reply.code(401).send({ ok: false, error: 'revoked' });

          const tier: Tier =
            seller.plan_code === 'enterprise' ? 'enterprise' :
            seller.plan_code === 'pro'        ? 'pro'        : 'starter';

          const newAccess = signAccess({ sub: String(seller.id), role: 'seller', tier, ver: 1 }, JWT_SECRET);
          return reply.send({ ok: true, access_token: newAccess });
        }

        const user = await db('users').where({ id: decoded.sub }).first();
        if (!user || user.token_ver !== decoded.ver) {
          return reply.code(401).send({ ok: false, error: 'revoked' });
        }

        const newAccess = signAccess({ sub: String(user.id), role: user.role, tier: user.tier, ver: user.token_ver }, JWT_SECRET);
        return reply.send({ ok: true, access_token: newAccess });
      });
    } catch {
      return reply.code(401).send({ ok: false, error: 'invalid_refresh' });
    }
  });

  // POST /auth/logout — clears refresh cookie (works even without @fastify/cookie)
  app.post('/logout', async (_req: FastifyRequest, reply: FastifyReply) => {
    // If @fastify/cookie is installed, you can use reply.clearCookie('refresh_token', { path: '/' });
    // This manual header works regardless:
    reply.header('set-cookie', [
      cookieString('refresh_token', '', {
        path: '/',
        domain: COOKIE_DOMAIN,
        secure: COOKIE_SECURE,
        httpOnly: true,
        maxAge: 0, // expire immediately
        sameSite: 'lax',
      }),
    ]);
    return reply.send({ ok: true });
  });
}
