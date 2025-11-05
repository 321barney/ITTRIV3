// src/api/routes/metric.ts
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

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function parseISO(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00.000Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
function defaultRange() {
  const to = new Date(); const from = new Date(to.getTime() - 29 * 86400000);
  return { from: iso(from), to: iso(to) };
}
function resolveRange(q: QS) {
  if (q.period) {
    const n = q.period === '7d' ? 7 : q.period === '90d' ? 90 : 30;
    const to = new Date(); const from = new Date(to.getTime() - (n - 1) * 86400000);
    return { from: iso(from), to: iso(to) };
  }
  const def = defaultRange();
  return {
    from: q.from && parseISO(q.from) ? q.from : def.from,
    to:   q.to && parseISO(q.to) ? q.to : def.to,
  };
}
function daysBetweenInclusive(fromISO: string, toISO: string) {
  const from = parseISO(fromISO)!; const to = parseISO(toISO)!;
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
  const jwk: JWK = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
  const key = await importJWK(jwk, 'EdDSA');
  _verifyOrgCtx = async (token: string) =>
    (await jwtVerify(token, key, {
      issuer: process.env.ORG_CONTEXT_ISSUER,
      audience: process.env.ORG_CONTEXT_AUDIENCE,
    })).payload;
  return _verifyOrgCtx;
}

/** Populate req.user with { id, email } via:
 *  1) X-Org-Context (signed), 2) X-Org-Identity (dev), 3) backend JWT
 */
async function ensureSeller(req: FastifyRequest, reply: FastifyReply) {
  // 1) Signed org context
  const orgCtx = (req.headers['x-org-context'] as string | undefined)?.trim();
  if (orgCtx) {
    try {
      const verify = await getOrgCtxVerifier();
      const p: any = await verify(orgCtx);
      const sellerId = p?.context?.sellerId;
      const email = p?.context?.email;
      if (sellerId && email) {
        (req as any).user = { id: sellerId, email, method: 'orgctx' };
        return;
      }
    } catch { /* fall through */ }
  }

  // 2) Unsigned identity (dev)
  try {
    const raw = (req.headers['x-org-identity'] as string | undefined) || '';
    if (raw) {
      const j = JSON.parse(raw);
      if (j?.sellerId || j?.email) {
        (req as any).user = { id: j?.sellerId ?? null, email: j?.email ?? null, method: 'orgid' };
        return;
      }
    }
  } catch { /* ignore */ }

  // 3) Backend JWT
  try {
    await (req as any).jwtVerify();
    const u = (req as any).user || {};
    const id = u.id || u.sub;
    const email = u.email || u.user_email || u.preferred_username || u.upn;
    if (id && email) { (req as any).user = { id, email, method: 'jwt' }; return; }
  } catch { /* ignore */ }

  return reply.code(401).send({ ok: false, error: 'unauthorized', hint: 'no valid seller identity' });
}

export default fp(async function metric(app: FastifyInstance) {
  const db = resolveDb(app);

  // Resolve seller id for RLS (no admin requirement here)
  async function resolveSellerId(req: FastifyRequest): Promise<{ sellerId?: string; email?: string }> {
    const auth = (req as any).user || {};
    let sellerId: string | undefined =
      auth.id || auth.sellerId || auth.seller_id || auth.seller || auth.orgId || auth.org_id;
    let email: string | undefined =
      auth.email || auth.user_email || auth.login || auth.username;

    if (!sellerId || !email) {
      const fromHeader = parseOrgIdentity(req.headers['x-org-identity'] as string);
      sellerId = sellerId || fromHeader.sellerId;
      email    = email    || fromHeader.email;
    }

    // Fallback: lookup by email
    if (!isUuid(sellerId) && email) {
      try {
        const res = await (db as any).raw('SELECT id FROM app.sellers WHERE user_email = ? LIMIT 1', [email]);
        const row = res?.rows?.[0];
        sellerId = row?.id;
      } catch (e) {
        req.log?.warn({ err: String(e) }, 'seller_lookup_by_email_failed');
      }
    }
    return { sellerId, email };
  }

  // ---- Common schema & guards for /metric/overview
  const routeOpts: Record<string, any> = {
    preHandler: ensureSeller,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          period: { type: 'string', enum: ['7d', '30d', '90d'] },
          storeId: { type: 'string', format: 'uuid' },
          withStores: { type: 'string', enum: ['0','1','true','false'] },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, data: { type: 'object' } },
          required: ['ok','data'],
        },
      },
    },
  };

  /* --------------------- SELLER DASHBOARD --------------------- */
  app.get('/seller/dashboard', { preHandler: ensureSeller }, async (req, reply) => {
    try {
      const { sellerId } = await resolveSellerId(req);
      if (!isUuid(sellerId)) {
        return reply.code(401).send({ ok: false, error: 'unauthorized', hint: 'missing sellerId' });
      }

      const since7d = new Date(Date.now() - 7 * 86400000);
      const since30d = new Date(Date.now() - 30 * 86400000);

      const payload = await (db as any).transaction(async (trx: any) => {
        await trx.raw('SET search_path = app, public');
        await trx.raw('SELECT app.set_current_seller(?::uuid)', [sellerId]);

        // KPIs
        const kpisSql = `
          WITH o_all AS (
            SELECT o.status
            FROM app.orders o
            JOIN app.stores s ON s.id = o.store_id
            WHERE s.seller_id = current_setting('app.current_seller')::uuid
          ),
          o_7d AS (
            SELECT SUM(CASE WHEN o.created_at >= ? THEN 1 ELSE 0 END)::bigint AS orders_7d,
                   SUM(CASE WHEN o.created_at >= ? THEN COALESCE(o.total_amount,0) ELSE 0 END)::numeric(20,2) AS revenue_7d
            FROM app.orders o
            JOIN app.stores s ON s.id = o.store_id
            WHERE s.seller_id = current_setting('app.current_seller')::uuid
          ),
          totals AS (
            SELECT COUNT(*)::bigint AS orders_total
            FROM o_all
          ),
          by_status AS (
            SELECT status, COUNT(*)::bigint AS c
            FROM o_all
            GROUP BY status
          )
          SELECT
            (SELECT orders_total FROM totals) AS orders_total,
            (SELECT orders_7d     FROM o_7d)  AS orders_7d,
            (SELECT revenue_7d    FROM o_7d)  AS revenue_7d,
            (SELECT json_object_agg(status, c) FROM by_status) AS orders_by_status
        `;
        const { rows: [krow] } = await trx.raw(kpisSql, [since7d, since7d]);

        // Recent orders (last 30d, up to 100)
        const { rows: recent_orders } = await trx.raw(
          `
          SELECT o.id, o.status, o.created_at, o.total_amount
          FROM app.orders o
          JOIN app.stores s ON s.id = o.store_id
          WHERE s.seller_id = current_setting('app.current_seller')::uuid
            AND o.created_at >= ?
          ORDER BY o.created_at DESC
          LIMIT 100
          `,
          [since30d]
        );

        // Recent conversations (last 30d, up to 100)
        const { rows: recent_conversations } = await trx.raw(
          `
          SELECT id, status, updated_at
          FROM app.conversations
          WHERE seller_id = current_setting('app.current_seller')::uuid
            AND updated_at >= ?
          ORDER BY updated_at DESC
          LIMIT 100
          `,
          [since30d]
        );

        await trx.raw('SELECT app.set_current_seller(NULL)');

        return {
          ok: true,
          kpis: {
            orders_total: Number(krow?.orders_total ?? 0),
            orders_7d: Number(krow?.orders_7d ?? 0),
            revenue_7d: Number(krow?.revenue_7d ?? 0),
            orders_by_status: krow?.orders_by_status ?? {},
          },
          recent_orders,
          recent_conversations,
        };
      });

      reply.header('Cache-Control', 'private, max-age=15');
      return reply.send(payload);
    } catch (error: any) {
      req.log?.error({ error: String(error) }, 'seller_dashboard_failed');
      return reply.code(500).send({ ok: false, error: 'seller_dashboard_failed' });
    }
  });

  /* --------------------- METRIC OVERVIEW ---------------------- */
  app.get('/metric/overview', routeOpts, async (req: FastifyRequest<{ Querystring: QS }>, reply: FastifyReply) => {
    const q = req.query || {};
    const { from, to } = resolveRange(q);
    const spanDays = daysBetweenInclusive(from, to);
    const prevTo = iso(new Date(parseISO(from)!.getTime() - 86400000));
    const prevFrom = iso(new Date(parseISO(prevTo)!.getTime() - (spanDays - 1) * 86400000));

    const currStoreFilter   = q.storeId ? ' AND md.store_id = ? ' : '';
    const prevStoreFilter   = q.storeId ? ' AND md.store_id = ? ' : '';
    const seriesStoreFilter = q.storeId ? ' AND md.store_id = ? ' : '';

    const sql = `
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
      ),
      series AS (
        SELECT
          md.metric_date::date                   AS date,
          SUM(md.revenue)::numeric(20,2)         AS revenue,
          SUM(md.orders_count)::bigint           AS orders,
          SUM(md.impressions)::bigint            AS impressions,
          SUM(md.conversations)::bigint          AS conversations,
          SUM(md.ai_confirmations)::bigint       AS ai_confirmations
        FROM app.metrics_daily md
        WHERE md.seller_id = current_setting('app.current_seller')::uuid
          AND md.metric_date BETWEEN ? AND ?
          ${seriesStoreFilter}
        GROUP BY md.metric_date
        ORDER BY md.metric_date ASC
      )
      SELECT
        (SELECT row_to_json(curr)  FROM curr)  AS curr,
        (SELECT row_to_json(prev)  FROM prev)  AS prev,
        (SELECT COALESCE(json_agg(series), '[]'::json) FROM series) AS series
    `;

    const bindings: any[] = [from, to];
    if (q.storeId) bindings.push(q.storeId);
    bindings.push(prevFrom, prevTo);
    if (q.storeId) bindings.push(q.storeId);
    bindings.push(from, to);
    if (q.storeId) bindings.push(q.storeId);

    const sqlStores =
      !q.storeId && isTruthy(q.withStores)
        ? `
          SELECT
            md.store_id,
            s.name AS store_name,
            SUM(md.revenue)::numeric(20,2)   AS revenue,
            SUM(md.orders_count)::bigint     AS orders,
            SUM(md.impressions)::bigint      AS impressions,
            SUM(md.conversations)::bigint    AS conversations,
            SUM(md.ai_confirmations)::bigint AS ai_confirmations
          FROM app.metrics_daily md
          LEFT JOIN app.stores s ON s.id = md.store_id
          WHERE md.seller_id = current_setting('app.current_seller')::uuid
            AND md.metric_date BETWEEN ? AND ?
          GROUP BY md.store_id, s.name
          ORDER BY SUM(md.revenue) DESC NULLS LAST
          LIMIT 5
        `
        : null;

    // Seller for this request
    const { sellerId } = await resolveSellerId(req);
    if (!isUuid(sellerId)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized', hint: 'missing sellerId' });
    }

    try {
      const result = await (db as any).transaction(async (trx: any) => {
        await trx.raw('SET search_path = app, public');
        await trx.raw('SELECT app.set_current_seller(?::uuid)', [sellerId]);

        const { rows: [row] } = await trx.raw(sql, bindings);
        const curr = row?.curr || { revenue: 0, orders: 0, impressions: 0, conversations: 0, ai_confirmations: 0 };
        const prev = row?.prev || { revenue: 0, orders: 0, impressions: 0, conversations: 0, ai_confirmations: 0 };
        const series = row?.series || [];

        const toNum = (x: any) => (x === null || x === undefined ? 0 : Number(x));
        const totals = {
          revenue: toNum(curr.revenue),
          orders: toNum(curr.orders),
          impressions: toNum(curr.impressions),
          conversations: toNum(curr.conversations),
          ai_confirmations: toNum(curr.ai_confirmations),
        };
        const deltas = {
          revenue: totals.revenue - toNum(prev.revenue),
          orders: totals.orders - toNum(prev.orders),
          impressions: totals.impressions - toNum(prev.impressions),
          conversations: totals.conversations - toNum(prev.conversations),
          ai_confirmations: totals.ai_confirmations - toNum(prev.ai_confirmations),
        };

        let by_store: any[] | undefined;
        if (sqlStores) {
          const { rows } = await trx.raw(sqlStores, [from, to]);
          by_store = rows ?? [];
        }

        await trx.raw('SELECT app.set_current_seller(NULL)');

        return { totals, deltas, series, by_store };
      });

      reply.header('Cache-Control', 'private, max-age=15');
      return reply.send({
        ok: true,
        data: {
          range: { from, to, days: spanDays, previous: { from: prevFrom, to: prevTo } },
          filter: { storeId: q.storeId ?? null },
          ...result,
        },
      });
    } catch (error: any) {
      req.log?.error(
        { error: String(error), code: error?.code, detail: error?.detail, hint: error?.hint },
        'metrics_overview_failed'
      );
      return reply.code(500).send({ ok: false, error: 'metrics_overview_failed' });
    }
  });
});
