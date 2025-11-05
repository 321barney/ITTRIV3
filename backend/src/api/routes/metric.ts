// backend/src/api/routes/metric.ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { importJWK, jwtVerify, JWK } from 'jose';
import { resolveDb } from '../_shared/rls.js';

declare module 'fastify' {
  interface FastifyInstance { requireAuth?: any; }
}

type QS = {
  from?: string;
  to?: string;
  period?: '7d' | '30d' | '90d';
  storeId?: string;
  withStores?: '0' | '1' | 'true' | 'false';
};

type JwtUser = { id: string; role?: string; email?: string | null };

type Overview = {
  range: { from: string; to: string; days: number; previous: { from: string; to: string } };
  filter: { storeId: string | null };
  totals: {
    revenue: number;
    revenue_prev: number;
    orders: number;
    orders_prev: number;
    impressions: number;
    impressions_prev: number;
    conversations: number;
    conversations_prev: number;
    ai_confirmations: number;
    ai_confirmations_prev: number;
  };
  trend: Array<{
    date: string;
    revenue: number;
    revenue_prev: number;
    orders: number;
    orders_prev: number;
    impressions: number;
    impressions_prev: number;
    conversations: number;
    conversations_prev: number;
    ai_confirmations: number;
    ai_confirmations_prev: number;
  }>;
};

function clampDate(d: Date) {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}
function fmt(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, delta: number) {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + delta);
  return c;
}
function span(from: Date, to: Date) {
  return Math.max(1, Math.floor((to.getTime() - from.getTime()) / 86400000) + 1);
}
const isTruthy = (v?: string) => v === '1' || v === 'true';
const isUuid = (s?: string) =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

function parseOrgIdentity(headerVal?: string | null): { sellerId?: string; email?: string } {
  if (!headerVal) return {};
  try {
    const j = JSON.parse(headerVal);
    const c = j?.context || j;
    const sellerId = c?.sellerId ?? j?.sellerId;
    const email    = c?.email    ?? j?.email;
    return { sellerId, email };
  } catch { return {}; }
}

/* ------------------------------------------------------------------ */
/* Seller-only inline auth (works even without global guards)         */
/* ------------------------------------------------------------------ */

let _verifyOrgCtx: null | ((t: string) => Promise<any>) = null;
async function getOrgCtxVerifier() {
  if (_verifyOrgCtx !== null) return _verifyOrgCtx;
  const raw = process.env.ORG_CONTEXT_PUBLIC_JWK;
  if (!raw) {
    _verifyOrgCtx = async () => { throw new Error('no_orgctx_key'); };
    return _verifyOrgCtx;
  }
  try {
    const jwk = JSON.parse(raw) as JWK;
    const key = await importJWK(jwk, 'EdDSA');
    _verifyOrgCtx = async (token: string) => {
      const res = await jwtVerify(token, key, { algorithms: ['EdDSA'] });
      return res.payload as any;
    };
    return _verifyOrgCtx;
  } catch {
    _verifyOrgCtx = async () => { throw new Error('bad_orgctx_key'); };
    return _verifyOrgCtx;
  }
}

const metricsPlugin = fp(async function registerMetrics(app: FastifyInstance) {
  const routeOpts = { /* place for preHandlers if needed */ } as any;

  app.get('/metric/overview', routeOpts, async (req: FastifyRequest<{ Querystring: QS }>, reply: FastifyReply) => {
    const q = (req.query || {}) as QS;

    // Resolve identity (JWT, or X-Org-Identity header)
    let sellerId: string | undefined;
    let email: string | undefined;

    // Try org context first (most reliable)
    const orgCtx = req.headers['x-org-context'] as string | undefined;
    if (orgCtx) {
      try {
        const verify = await getOrgCtxVerifier();
        const payload = await verify(orgCtx);
        sellerId = payload?.context?.sellerId;
        email    = payload?.context?.email;
      } catch {}
    }

    if (!sellerId || !email) {
      const auth = (req as any).user || {};
      let sid: string | undefined =
        auth.id || auth.sellerId || auth.seller_id || auth.seller || auth.orgId || auth.org_id;
      let em: string | undefined =
        auth.email || auth.user_email || auth.login || auth.username;

      if (!sid || !em) {
        const fromHeader = parseOrgIdentity(req.headers['x-org-identity'] as string);
        sid = sid || fromHeader.sellerId;
        em  = em  || fromHeader.email;
      }

      // Fallback: lookup by email
      if (!isUuid(sid) && em) {
        const db = await resolveDb(app);
        const row = await db('sellers').select('id').where('email', em).first().catch(() => null);
        if (row?.id) sid = row.id;
      }

      sellerId = sid;
      email    = em;
    }

    if (!sellerId || !isUuid(sellerId)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }

    // Parse dates
    const now = new Date();
    let from: Date, to: Date;
    if (q.from && q.to) {
      const f = clampDate(new Date(q.from));
      const t = clampDate(new Date(q.to));
      from = f <= t ? f : t;
      to   = f <= t ? t : f;
    } else {
      // default period
      const days = q.period === '90d' ? 90 : q.period === '30d' ? 30 : 7;
      to   = clampDate(now);
      from = addDays(to, -(days - 1));
    }

    const spanDays = span(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(spanDays - 1));

    const db = await resolveDb(app);
    // Set seller context (RLS aware)
    await db.raw('SET LOCAL ROLE app_admin');
    await db.raw(`SELECT set_config('app.current_seller', ?, true)`, [sellerId]);

    const currStoreFilter = isUuid(q.storeId) ? 'AND md.store_id = ?' : '';
    const prevStoreFilter = currStoreFilter;

    const paramsCurr: any[] = [fmt(from), fmt(to)];
    const paramsPrev: any[] = [fmt(prevFrom), fmt(prevTo)];
    if (isUuid(q.storeId)) { paramsCurr.push(q.storeId); paramsPrev.push(q.storeId); }

    // Totals
    const totalsRow = await db.raw(
      `
      WITH curr AS (
        SELECT
          SUM(revenue)::numeric(20,2)   AS revenue,
          SUM(orders_count)::bigint     AS orders,
          SUM(impressions)::bigint      AS impressions,
          SUM(conversations)::bigint    AS conversations,
          SUM(ai_confirmations)::bigint AS ai_confirmations
        FROM app.metrics_daily md
        WHERE md.seller_id = current_setting('app.current_seller')::uuid
          AND md.metric_date BETWEEN ? AND ?
          ${currStoreFilter}
      ),
      prev AS (
        SELECT
          SUM(revenue)::numeric(20,2)   AS revenue,
          SUM(orders_count)::bigint     AS orders,
          SUM(impressions)::bigint      AS impressions,
          SUM(conversations)::bigint    AS conversations,
          SUM(ai_confirmations)::bigint AS ai_confirmations
        FROM app.metrics_daily md
        WHERE md.seller_id = current_setting('app.current_seller')::uuid
          AND md.metric_date BETWEEN ? AND ?
          ${prevStoreFilter}
      )
      SELECT
        curr.revenue        AS revenue,
        prev.revenue        AS revenue_prev,
        curr.orders         AS orders,
        prev.orders         AS orders_prev,
        curr.impressions    AS impressions,
        prev.impressions    AS impressions_prev,
        curr.conversations  AS conversations,
        prev.conversations  AS conversations_prev,
        curr.ai_confirmations AS ai_confirmations,
        prev.ai_confirmations AS ai_confirmations_prev
      FROM curr, prev
      `,
      [...paramsCurr, ...paramsPrev]
    ).then((r: any) => r.rows?.[0] || null).catch(() => null);

    const dailyRows = await db.raw(
      `
      WITH dates AS (
        SELECT generate_series(?::date, ?::date, interval '1 day')::date AS d
      ),
      curr AS (
        SELECT metric_date AS d,
               SUM(revenue)::numeric(20,2)   AS revenue,
               SUM(orders_count)::bigint     AS orders,
               SUM(impressions)::bigint      AS impressions,
               SUM(conversations)::bigint    AS conversations,
               SUM(ai_confirmations)::bigint AS ai_confirmations
        FROM app.metrics_daily
        WHERE seller_id = current_setting('app.current_seller')::uuid
          AND metric_date BETWEEN ? AND ?
          ${currStoreFilter}
        GROUP BY metric_date
      ),
      prev AS (
        SELECT metric_date AS d,
               SUM(revenue)::numeric(20,2)   AS revenue,
               SUM(orders_count)::bigint     AS orders,
               SUM(impressions)::bigint      AS impressions,
               SUM(conversations)::bigint    AS conversations,
               SUM(ai_confirmations)::bigint AS ai_confirmations
        FROM app.metrics_daily
        WHERE seller_id = current_setting('app.current_seller')::uuid
          AND metric_date BETWEEN ? AND ?
          ${prevStoreFilter}
        GROUP BY metric_date
      )
      SELECT
        d.d::text                           AS date,
        COALESCE(curr.revenue, 0)::float8   AS revenue,
        0::float8                           AS revenue_prev, -- filled later
        COALESCE(curr.orders, 0)            AS orders,
        0                                   AS orders_prev,
        COALESCE(curr.impressions, 0)       AS impressions,
        0                                   AS impressions_prev,
        COALESCE(curr.conversations, 0)     AS conversations,
        0                                   AS conversations_prev,
        COALESCE(curr.ai_confirmations, 0)  AS ai_confirmations,
        0                                   AS ai_confirmations_prev
      FROM dates d
      LEFT JOIN curr  ON curr.d = d.d
      ORDER BY d.d ASC
      `,
      [fmt(from), fmt(to), fmt(from), fmt(to)]
    ).then((r: any) => r.rows || []).catch(() => []);

    // Fill prev arrays aligned by index
    const prevRows = await db.raw(
      `
      SELECT metric_date::text AS date,
             SUM(revenue)::numeric(20,2)   AS revenue,
             SUM(orders_count)::bigint     AS orders,
             SUM(impressions)::bigint      AS impressions,
             SUM(conversations)::bigint    AS conversations,
             SUM(ai_confirmations)::bigint AS ai_confirmations
      FROM app.metrics_daily
      WHERE seller_id = current_setting('app.current_seller')::uuid
        AND metric_date BETWEEN ? AND ?
        ${prevStoreFilter}
      GROUP BY metric_date
      ORDER BY metric_date ASC
      `,
      [fmt(prevFrom), fmt(prevTo), ...(isUuid(q.storeId) ? [q.storeId] : [])]
    ).then((r: any) => r.rows || []).catch(() => []);

    // Map prev into the same-length array
    const prevMap = new Map(prevRows.map((r: any) => [r.date, r]));
    for (const row of dailyRows) {
      const prev = prevMap.get(row.date);
      if (prev) {
        row.revenue_prev = Number(prev.revenue);
        row.orders_prev = Number(prev.orders);
        row.impressions_prev = Number(prev.impressions);
        row.conversations_prev = Number(prev.conversations);
        row.ai_confirmations_prev = Number(prev.ai_confirmations);
      }
    }

    const toNum = (x: any) => (x == null ? 0 : Number(x));
    const result: Overview = {
      range: { from: fmt(from), to: fmt(to), days: spanDays, previous: { from: fmt(prevFrom), to: fmt(prevTo) } },
      filter: { storeId: q.storeId ?? null },
      totals: {
        revenue: toNum(totalsRow?.revenue),
        revenue_prev: toNum(totalsRow?.revenue_prev),
        orders: toNum(totalsRow?.orders),
        orders_prev: toNum(totalsRow?.orders_prev),
        impressions: toNum(totalsRow?.impressions),
        impressions_prev: toNum(totalsRow?.impressions_prev),
        conversations: toNum(totalsRow?.conversations),
        conversations_prev: toNum(totalsRow?.conversations_prev),
        ai_confirmations: toNum(totalsRow?.ai_confirmations),
        ai_confirmations_prev: toNum(totalsRow?.ai_confirmations_prev),
      },
      trend: dailyRows.map((r: any) => ({
        date: r.date,
        revenue: toNum(r.revenue),
        revenue_prev: toNum(r.revenue_prev),
        orders: toNum(r.orders),
        orders_prev: toNum(r.orders_prev),
        impressions: toNum(r.impressions),
        impressions_prev: toNum(r.impressions_prev),
        conversations: toNum(r.conversations),
        conversations_prev: toNum(r.conversations_prev),
        ai_confirmations: toNum(r.ai_confirmations),
        ai_confirmations_prev: toNum(r.ai_confirmations_prev),
      })),
    };

    return reply.send({ ok: true, data: result });
  });

  // --- compatibility alias for frontend expecting /api/v1 prefix (non-redirect) ---
  app.get('/api/v1/metric/overview', routeOpts, async (req: FastifyRequest<{ Querystring: QS }>, reply: FastifyReply) => {
    try {
      const qs = (req.raw?.url && req.raw.url.includes('?')) ? req.raw.url.substring(req.raw.url.indexOf('?')) : '';
      const injected = await (app as any).inject({
        method: 'GET',
        url: `/metric/overview${qs}`,
        headers: Object.fromEntries(Object.entries(req.headers))
      });
      reply.code(injected.statusCode);
      reply.header('content-type', injected.headers['content-type'] || 'application/json');
      return reply.send(injected.body);
    } catch (e) {
      req.log?.error?.(e, 'metric_overview_alias_failed');
      return reply.code(500).send({ ok: false, error: 'metric_overview_alias_failed' });
    }
  });
}, { name: 'metric-routes' });

export default metricsPlugin;
