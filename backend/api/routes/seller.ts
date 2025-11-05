// backend/src/api/routes/seller.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { importJWK, jwtVerify, JWK } from 'jose';
import { maskPII } from '../../utils/pii.js';
import { resolveStoreLimit } from '../../utils/plan.js';
import { listRecentStoreConversationsLinkedToOrders } from '../../utils/conversations.js';

/* =========================================================================================
   Types & small utils
========================================================================================= */

type JwtUser = {
  id: string;
  role?: string;
  email?: string;
  user_email?: string;
  preferred_username?: string;
  upn?: string;
  method?: 'orgctx' | 'orgid' | 'jwt';
};

type PlanCaps = {
  canEditStore: boolean;
  canManageProducts: boolean;
  maxProducts: number | null;
};

const genId = () => randomUUID();

function capsFor(plan: string | null | undefined): PlanCaps {
  const p = (plan ?? '').toLowerCase();
  switch (p) {
    case 'enterprise':
    case 'pro':
    case 'premium':
      return { canEditStore: true, canManageProducts: true, maxProducts: null };
    case 'starter':
    case 'basic':
      return { canEditStore: true, canManageProducts: true, maxProducts: 200 };
    case 'free':
    default:
      return { canEditStore: true, canManageProducts: true, maxProducts: 50 };
  }
}

function getEmailFromUser(u: Partial<JwtUser> | undefined | null): string | undefined {
  const e = u?.email || u?.user_email || u?.preferred_username || u?.upn;
  return typeof e === 'string' && e.includes('@') ? e : undefined;
}

const isUuid = (s?: string) =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

/* =========================================================================================
   AUTH/IDENTITY  (same precedence as other routes)
========================================================================================= */

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

async function ensureSellerInline(req: FastifyRequest, reply: FastifyReply) {
  // 1) Signed org context
  const orgCtx = (req.headers['x-org-context'] as string | undefined)?.trim();
  if (orgCtx) {
    try {
      const verify = await getOrgCtxVerifier();
      const p: any = await verify(orgCtx);
      const sellerId = p?.context?.sellerId;
      const email = p?.context?.email;
      if (sellerId && email) { (req as any).user = { id: sellerId, email, method: 'orgctx' } as JwtUser; return; }
    } catch { /* fallthrough */ }
  }

  // 2) Unsigned identity (dev)
  try {
    const raw = (req.headers['x-org-identity'] as string | undefined) || '';
    if (raw) {
      const j = JSON.parse(raw);
      const sellerId = j?.sellerId;
      const email = j?.email;
      if (sellerId || email) { (req as any).user = { id: sellerId ?? '', email: email ?? '', method: 'orgid' } as JwtUser; return; }
    }
  } catch { /* fallthrough */ }

  // 3) Backend JWT cookie/header
  try {
    await (req as any).jwtVerify?.();
    const u = (req as any).user || {};
    const id = u.id || u.sub;
    const email = u.email || u.user_email || u.preferred_username || u.upn;
    if (id && email) { (req as any).user = { id, email, method: 'jwt' } as JwtUser; return; }
  } catch { /* fallthrough */ }

  return reply.code(401).send({ ok: false, error: 'unauthorized', hint: 'missing user id' });
}

/* =========================================================================================
   DB helpers (schema = public, minimal)
========================================================================================= */

async function ensureCoreSchema(db: any, log: FastifyInstance['log']) {
  try {
    await db.raw(`SET LOCAL search_path = public`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS public.sellers (
        id uuid PRIMARY KEY,
        user_email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        plan_code text NOT NULL DEFAULT 'basic',
        subscription_status text,
        billing_cycle_start date,
        billing_period text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.plans (
        code text PRIMARY KEY,
        max_stores integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.stores (
        id uuid PRIMARY KEY,
        seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'inactive',
        gsheet_url text,
        has_gsheet boolean NOT NULL DEFAULT false,
        has_whatsapp boolean NOT NULL DEFAULT false,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT check_store_active_requires_integrations
          CHECK (status <> 'active' OR (has_gsheet = true AND gsheet_url IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS public.store_sheets (
        id uuid PRIMARY KEY,
        store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
        seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
        gsheet_url text NOT NULL,
        sheet_tab text,
        enabled boolean NOT NULL DEFAULT true,
        last_processed_row integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // unique per store + url + (tab coerced)
    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'store_sheets_unique' AND n.nspname = 'public'
        ) THEN
          EXECUTE 'CREATE UNIQUE INDEX store_sheets_unique
                   ON public.store_sheets (store_id, gsheet_url, (COALESCE(sheet_tab, ''default'')))';
        END IF;
      END$$;
    `);

    const basic = await db('public.plans').where({ code: 'basic' }).first().catch(() => null);
    if (!basic) await db('public.plans').insert({ code: 'basic', max_stores: 1 }).catch(() => {});
  } catch (e: any) {
    log.error({ err: String(e) }, 'ensureCoreSchema failed');
    throw e;
  }
}

async function getSellerRowByUserId(db: any, log: FastifyInstance['log'], userId: string) {
  try { return await db('public.sellers').where({ id: userId }).first(); }
  catch (e: any) {
    if (e?.code === '42P01') { await ensureCoreSchema(db, log); return db('public.sellers').where({ id: userId }).first(); }
    throw e;
  }
}

async function ensureSeller(db: any, log: FastifyInstance['log'], userId: string, emailHint?: string) {
  try {
    return await db.transaction(async (trx: any) => {
      await trx.raw(`SET LOCAL search_path = public`);
      const existing = await trx('public.sellers').where({ id: userId }).first();
      if (existing) return existing;

      const safeEmail = emailHint && emailHint.includes('@') ? emailHint : `user-${userId}@example.local`;
      const now = new Date();

      const inserted = await trx('public.sellers')
        .insert({
          id: userId,
          user_email: safeEmail,
          password_hash: 'scrypt$jwt$external',
          plan_code: 'basic',
          subscription_status: 'active',
          billing_cycle_start: trx.raw('CURRENT_DATE'),
          billing_period: 'monthly',
          created_at: now,
          updated_at: now,
          metadata: {},
        })
        .onConflict('id')
        .ignore()
        .returning('*');

      if (inserted[0]) return inserted[0];
      return trx('public.sellers').where({ id: userId }).first();
    });
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === '42703') {
      await ensureCoreSchema(db, log);
      return ensureSeller(db, log, userId, emailHint);
    }
    throw e;
  }
}

async function setRlsContext(db: any, _userId: string) {
  try { await db.raw('SET LOCAL search_path = public'); } catch {}
}

/* =========================================================================================
   Sheets helpers (ALWAYS touch store_sheets on updates)
========================================================================================= */

const SHEET_RE = /^https:\/\/docs\.google\.com\/spreadsheets\//i;
const isValidSheetUrl = (v?: string | null): v is string =>
  !!v && typeof v === 'string' && SHEET_RE.test(v.trim());

/** Disable all enabled sheets for a store, then enable (or insert) exactly one row for the given URL. */
async function upsertSingleEnabledSheet(
  trx: any,
  storeId: string,
  sellerId: string,
  url: string,
  tab?: string | null
) {
  const now = new Date();

  // disable all current enabled
  await trx('public.store_sheets')
    .where({ store_id: storeId, enabled: true })
    .update({ enabled: false, updated_at: now });

  // look for existing with same URL (+ tab is NOT part of identity for upsert — we keep/overwrite)
  const existing = await trx('public.store_sheets')
    .where({ store_id: storeId, gsheet_url: url })
    .first();

  let chosen;
  if (existing) {
    [chosen] = await trx('public.store_sheets')
      .where({ id: existing.id })
      .update(
        {
          sheet_tab: tab ?? existing.sheet_tab ?? null,
          enabled: true,
          updated_at: now,
        },
        '*'
      );
  } else {
    [chosen] = await trx('public.store_sheets').insert(
      {
        id: randomUUID(),
        store_id: storeId,
        seller_id: sellerId,
        gsheet_url: url,
        sheet_tab: tab ?? null,
        enabled: true,
        last_processed_row: 0,
        created_at: now,
        updated_at: now,
      },
      '*'
    );
  }

  return chosen;
}

/** Return the single enabled sheet row if present, otherwise null. */
async function getSingleEnabledSheet(trx: any, storeId: string) {
  const rows = await trx('public.store_sheets')
    .where({ store_id: storeId, enabled: true })
    .orderBy([{ column: 'enabled', order: 'desc' }, { column: 'updated_at', order: 'desc' }]);

  const enabled = rows.filter((r: any) => !!r.enabled);
  if (enabled.length === 1) return enabled[0];
  return null;
}

/* =========================================================================================
   Shared update handler (used by 3 routes)
========================================================================================= */

type UpdatePayload = {
  name?: string;
  status?: 'active' | 'inactive' | 'suspended';
  gsheet_url?: string | null;
  sheet_tab?: string | null;
};

async function updateStoreFlexible(db: any, app: FastifyInstance, userId: string, paramId: string | null, body: UpdatePayload) {
  const wantStatus = body.status;
  const wantName = typeof body.name === 'string' ? body.name.trim() : undefined;
  const wantSheetProvided = Object.prototype.hasOwnProperty.call(body, 'gsheet_url');
  const wantSheetUrl = wantSheetProvided ? (body.gsheet_url ?? '') : undefined;
  const wantTab = typeof body.sheet_tab === 'string' ? body.sheet_tab!.trim() : undefined;

  if (wantSheetProvided && wantSheetUrl) {
    if (!isValidSheetUrl(String(wantSheetUrl))) {
      return { http: 400, payload: { ok: false, error: 'invalid_gsheet_url' } };
    }
  }

  // plan → single-store?
  const seller = await getSellerRowByUserId(db, app.log, userId);
  const plan_code = (seller?.plan_code ?? 'basic').toLowerCase();
  const rawPlanRow = await db('public.plans').where({ code: plan_code }).first().catch(() => null);
  const normalizedPlanRow = rawPlanRow
    ? { max_stores: (rawPlanRow as any).max_stores ?? (rawPlanRow as any).store_limit ?? (rawPlanRow as any).storeLimit }
    : undefined;
  const store_limit = resolveStoreLimit(plan_code, normalizedPlanRow);

  try {
    return await db.transaction(async (trx: any) => {
      await trx.raw('SET LOCAL search_path = public');

      // Decide target store
      let target = null as any;
      if (store_limit === 1) {
        target = await trx('public.stores')
          .where({ seller_id: userId })
          .orderBy('created_at', 'asc')
          .first();

        if (!target) {
          const now = new Date();
          const newId = paramId && isUuid(paramId) ? paramId : randomUUID();
          [target] = await trx('public.stores')
            .insert({
              id: newId,
              seller_id: userId,
              name: (wantName && wantName.length ? wantName : `store-${newId.slice(0, 6)}`).slice(0, 80),
              status: 'inactive',
              gsheet_url: null,
              has_gsheet: false,
              created_at: now,
              updated_at: now,
            })
            .returning('*');
        }
      } else {
        if (!paramId) return { http: 400, payload: { ok: false, error: 'store_id_required' } };
        target = await trx('public.stores').where({ id: paramId, seller_id: userId }).first();
        if (!target) return { http: 404, payload: { ok: false, error: 'store_not_found' } };
      }

      // lock row
      target = await trx('public.stores').where({ id: target.id, seller_id: userId }).forUpdate().first();
      const storeId = target.id;

      const baseUpdate: any = { updated_at: new Date() };
      if (wantName) baseUpdate.name = wantName;

      // **Important**: if we are explicitly deactivating, do it first to avoid transient CHECK violations
      if (wantStatus === 'inactive' && target.status !== 'inactive') {
        await trx('public.stores')
          .where({ id: storeId, seller_id: userId })
          .update({ status: 'inactive', updated_at: new Date() });
        // refresh target after change
        target = await trx('public.stores').where({ id: storeId, seller_id: userId }).first();
      }

      let chosenSheet: any | null = null;

      if (wantSheetProvided) {
        if (wantSheetUrl) {
          // upsert store_sheets (ALWAYS)
          chosenSheet = await upsertSingleEnabledSheet(trx, storeId, userId, String(wantSheetUrl), wantTab ?? null);
          baseUpdate.gsheet_url = chosenSheet.gsheet_url;
          baseUpdate.has_gsheet = true;
        } else {
          // clear
          baseUpdate.gsheet_url = null;
          baseUpdate.has_gsheet = false;
          await trx('public.store_sheets')
            .where({ store_id: storeId, enabled: true })
            .update({ enabled: false, updated_at: new Date() });
          if (!wantStatus && target.status !== 'inactive') baseUpdate.status = 'inactive';
        }
      }

      // apply base update, then re-read
      if (Object.keys(baseUpdate).length) {
        await trx('public.stores')
          .where({ id: storeId, seller_id: userId })
          .update(baseUpdate);
      }
      let store = await trx('public.stores').where({ id: storeId, seller_id: userId }).first();

      // Activation
      if (wantStatus === 'active') {
        if (!chosenSheet) {
          chosenSheet = await getSingleEnabledSheet(trx, storeId);
        }

        // backfill from store.gsheet_url if no enabled sheet exists but URL present
        if (!chosenSheet && isValidSheetUrl(store.gsheet_url)) {
          chosenSheet = await upsertSingleEnabledSheet(trx, storeId, userId, store.gsheet_url!, wantTab ?? null);
        }

        const finalUrl =
          (chosenSheet?.gsheet_url as string | undefined) ??
          (store.gsheet_url as string | undefined) ??
          (wantSheetProvided && wantSheetUrl ? String(wantSheetUrl) : undefined);

        if (!finalUrl) {
          return {
            http: 409,
            payload: {
              ok: false,
              error: 'integrations_missing',
              message: 'Active store requires Google Sheet.',
              missing: ['google_sheet'],
              constraint: 'check_store_active_requires_integrations',
              debug: {
                store_id: storeId,
                has_body_sheet: !!(wantSheetProvided && wantSheetUrl),
                store_has_url: !!store.gsheet_url,
                enabled_sheet_found: !!chosenSheet,
              }
            },
          };
        }

        [store] = await trx('public.stores')
          .where({ id: storeId, seller_id: userId })
          .update({
            status: 'active',
            has_gsheet: true,
            gsheet_url: finalUrl,
            updated_at: new Date(),
          })
          .returning('*');

        return { http: 200, payload: { ok: true, store } };
      }

      // Non-active explicit status updates (suspended, etc)
      if (wantStatus && wantStatus !== store.status) {
        [store] = await trx('public.stores')
          .where({ id: storeId, seller_id: userId })
          .update({ status: wantStatus, updated_at: new Date() })
          .returning('*');
      }

      return { http: 200, payload: { ok: true, store } };
    });
  } catch (e: any) {
    // Map CHECK violations to 409 so the UI gets a meaningful error
    if (e?.code === '23514') {
      return {
        http: 409,
        payload: {
          ok: false,
          error: 'constraint_violation',
          constraint: e?.constraint || 'unknown_check',
          detail: e?.detail || String(e?.message || e),
        },
      };
    }
    throw e;
  }
}

/* =========================================================================================
   ROUTES
   NOTE: Dashboard route removed — it is now owned by metric.ts to avoid duplication.
========================================================================================= */

export default async function registerSellerRoutes(app: FastifyInstance) {
  if ((app as any).__sellerRoutesMounted__) {
    app.log.warn('seller routes already mounted – skipping');
    return;
  }
  (app as any).__sellerRoutesMounted__ = true;

  const db: any =
    (app as any).db?.raw
      ? (app as any).db
      : (app as any).db?.knex ?? (app as any).db;

  if (!db) {
    app.log.warn('Seller routes: no database bound to app.db; skipping.');
    return;
  }

  /* ================== STORES: create (plan-capped, idempotent reuse) ================== */
  app.post('/seller/stores', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    const seller = await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    if (!seller) return reply.code(403).send({ ok: false, error: 'not_seller' });

    const plan_code = (seller.plan_code ?? 'basic').toLowerCase();
    const rawPlanRow = await db('public.plans').where({ code: plan_code }).first().catch(() => null);
    const normalizedPlanRow = rawPlanRow
      ? { max_stores: (rawPlanRow as any).max_stores ?? (rawPlanRow as any).store_limit ?? (rawPlanRow as any).storeLimit }
      : undefined;
    const store_limit = resolveStoreLimit(plan_code, normalizedPlanRow);

    const [{ count }] = await db('public.stores').where({ seller_id: seller.id }).count('* as count');
    const current = Number(count) || 0;

    const { name } = ((req.body as any) ?? {}) as { name?: string };
    const desiredName = (name ?? '').trim();

    if (current >= store_limit) {
      const existing = await db('public.stores').where({ seller_id: seller.id }).orderBy('created_at', 'asc').first();
      if (existing) {
        let store = existing;
        if (desiredName && desiredName !== existing.name) {
          [store] = await db('public.stores')
            .where({ id: existing.id })
            .update({ name: desiredName.slice(0, 80), updated_at: new Date() })
            .returning('*');
        }
        return reply.code(200).send({
          ok: true,
          reused_existing: true,
          store,
          store_limit,
          stores_remaining: Math.max(0, store_limit - current),
          note: 'Plan limit reached; reused your existing store. Name updated if provided.',
        });
      }

      return reply.code(403).send({
        ok: false,
        error: 'store_limit_reached',
        limit: store_limit,
        message: 'Your plan limit for number of stores has been reached.',
      });
    }

    const storeName = (desiredName || `store-${current + 1}`).slice(0, 80);
    const now = new Date();
    const [store] = await db('public.stores')
      .insert({ id: genId(), seller_id: seller.id, name: storeName, status: 'inactive', created_at: now, updated_at: now })
      .returning('*');

    return reply.code(201).send({
      ok: true,
      store,
      store_limit,
      stores_remaining: Math.max(0, store_limit - (current + 1)),
      note: 'Store created as inactive. Activate once a Google Sheet is connected.',
    });
  });

  /* ================== STORE SETTINGS (rename, set gsheet) ================== */
  app.patch('/seller/store/settings', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const store = await db('public.stores').where({ seller_id: userId }).first();
    if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });

    const payload = (req.body as any) ?? {};
    const res = await updateStoreFlexible(db, app, userId!, store.id, {
      name: payload.name,
      gsheet_url: payload.gsheet_url,
      sheet_tab: payload.sheet_tab,
      status: payload.status,
    });
    return reply.code(res.http).send(res.payload);
  });

  /* ================== STORE (own only) ================== */
  app.get('/seller/store', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const store = await db('public.stores').where({ seller_id: userId }).first();
    if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });
    return reply.send({ ok: true, store });
  });

  // ======= PUT own store (same engine; respects single-store + store_sheets) =======
  app.put('/seller/store', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const store = await db('public.stores').where({ seller_id: userId }).first();
    if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });

    const payload = (req.body as any) ?? {};
    const res = await updateStoreFlexible(db, app, userId!, store.id, {
      name: payload.name,
      gsheet_url: payload.gsheet_url,
      sheet_tab: payload.sheet_tab,
      status: payload.status,
    });
    return reply.code(res.http).send(res.payload);
  });

  /* ================== STORE by ID (single) ================== */

  // GET /api/v1/seller/stores/:id
  app.get('/seller/stores/:id', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;
    const { id } = (req.params as any);

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const store = await db('public.stores').where({ id, seller_id: userId }).first();
    if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });
    return reply.send({ ok: true, store });
  });

  // PUT /seller/stores/:id  (flexible, always updates store_sheets)
  app.put('/seller/stores/:id', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;
    const { id } = (req.params as any);

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const payload = (req.body as any) ?? {};
    const res = await updateStoreFlexible(db, app, userId!, id, {
      name: payload.name,
      gsheet_url: payload.gsheet_url,
      sheet_tab: payload.sheet_tab,
      status: payload.status,
    });
    return reply.code(res.http).send(res.payload);
  });

  // Alias for the v1 path (used by frontend)
  app.put('/api/v1/seller/stores/:id', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;
    const { id } = (req.params as any);

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const payload = (req.body as any) ?? {};
    const res = await updateStoreFlexible(db, app, userId!, id, {
      name: payload.name,
      gsheet_url: payload.gsheet_url,
      sheet_tab: payload.sheet_tab,
      status: payload.status,
    });
    return reply.code(res.http).send(res.payload);
  });

  /* ================== DASHBOARD alias (same behavior) ================== */
  // Note: this is NOT the primary dashboard route; the canonical dashboard lives in metric.ts
  app.put('/dashboard/stores/:id', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;
    const { id } = (req.params as any);

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const payload = (req.body as any) ?? {};
    const res = await updateStoreFlexible(db, app, userId!, id, {
      name: payload.name,
      gsheet_url: payload.gsheet_url,
      sheet_tab: payload.sheet_tab,
      status: payload.status,
    });
    return reply.code(res.http).send(res.payload);
  });

  /* ================== STORES (list all for current seller) ================== */
  app.get('/seller/stores', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const q = (req.query as any) ?? {};
    const status = typeof q.status === 'string' && q.status.length ? q.status : undefined;

    let query = db('public.stores').where({ seller_id: userId });
    if (status) query = query.andWhere({ status });

    const stores = await query.orderBy('created_at', 'asc');
    return reply.send({ ok: true, stores, count: stores.length });
  });

  // Alias for the v1 path the Next proxy tries first
  app.get('/api/v1/seller/stores', { preHandler: ensureSellerInline }, async (req, reply) => {
    const user = (req as any).user as JwtUser;
    const userId = user?.id;

    await ensureCoreSchema(db, app.log);
    await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
    await setRlsContext(db, userId!);

    const q = (req.query as any) ?? {};
    const status = typeof q.status === 'string' && q.status.length ? q.status : undefined;

    let query = db('public.stores').where({ seller_id: userId });
    if (status) query = query.andWhere({ status });

    const stores = await query.orderBy('created_at', 'asc');
    return reply.send({ ok: true, stores, count: stores.length });
  });

  /* ================== AI (via proxy; unchanged) ================== */
  app.post('/seller/ai', { preHandler: ensureSellerInline }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (req as any).user as JwtUser;
      const userId = user?.id;

      await ensureCoreSchema(db, app.log);
      await ensureSeller(db, app.log, userId!, getEmailFromUser(user));
      await setRlsContext(db, userId!);

      const store = await db('public.stores').where({ seller_id: userId }).first();
      if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });

      const body = (req.body as any) ?? {};
      const entity = (body.entity as string) ?? 'chat';
      const kind = (body.kind as string) ?? 'ask';
      const payload = body.prompt ? { prompt: String(body.prompt) } : body.payload ?? {};

      // Optional proxy loader
      async function callWorkerProxySafe(path: string, payload: any) {
        try {
          const mod = await import('../../utils/worker-proxy.js');
          if (typeof (mod as any).callWorkerProxy !== 'function') {
            const err: any = new Error('proxy_not_configured'); err.statusCode = 503; throw err;
          }
          return await (mod as any).callWorkerProxy(path, payload);
        } catch (e: any) {
          const err: any = new Error('proxy_not_configured');
          err.statusCode = 503; err.details = e?.message ?? e; throw err;
        }
      }

      const proxied = await callWorkerProxySafe('/proxy/ai', {
        seller_id: userId, store_id: store.id, entity, kind, payload,
      });

      return reply.send({ ok: true, result: (proxied as any)?.data ?? proxied });
    } catch (err: any) {
      const status = err?.message === 'proxy_not_configured' ? 503 : err?.statusCode ?? 500;
      const code = err?.message === 'proxy_not_configured' ? 'proxy_not_configured' : 'ai_proxy_error';
      return reply.code(status).send({ ok: false, error: code, details: err?.details ?? err?.message ?? 'unknown' });
    }
  });
}
