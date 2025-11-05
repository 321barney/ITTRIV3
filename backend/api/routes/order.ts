// backend/src/api/routes/order.ts (UPDATED)
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { maskPII } from '../../utils/pii.js';
import { conversationsForOrder } from '../../utils/conversations.js';

/**
 * Minimal JWT user shape injected by upstream auth hook.
 */
 type JwtUser = { id: string; role: 'seller' | 'admin' | string };

/**
 * Protected call to the worker proxy (single choke point).
 * Requires:
 *  - process.env.WORKER_PROXY_URL (e.g., http://localhost:3000)
 *  - process.env.PROXY_TOKEN
 */
async function callWorkerProxy(path: string, body: any) {
  const base = process.env.WORKER_PROXY_URL || '';
  const token = process.env.PROXY_TOKEN || '';
  if (!base || !token) {
    const err: any = new Error('proxy_not_configured');
    err.statusCode = 503;
    throw err;
  }
  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let json: any;
    try { json = JSON.parse(text); } catch {}
    const err: any = new Error(json?.error || `proxy_error_${res.status}`);
    err.statusCode = res.status;
    err.details = json ?? text;
    throw err;
  }
  try { return JSON.parse(text); } catch { return text; }
}

// --- helper: transaction-scoped elevation to app_admin + current_seller GUC ---
async function withAdmin<T>(knex: any, sellerId: string, fn: (trx: any) => Promise<T>): Promise<T> {
  return knex.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL ROLE app_admin');
    await trx.raw(`SELECT set_config('app.current_seller', ?, true)`, [sellerId]);
    return fn(trx);
  });
}

// --- helpers: shape whitelists ---
const pick = (src: any, keys: string[]) => keys.reduce((acc, k) => {
  if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) acc[k] = src[k];
  return acc;
}, {} as any);

function sanitizeOrderInsert(raw: any) {
  const base = pick(raw, [
    'status',
    'customer_name',
    'customer_phone',
    'customer_email',
    'shipping_address',
    'billing_address',
    'currency',
    'total_amount',
    'decision_reason',
    // add more allowed columns here as needed
  ]);
  if (!base.status) base.status = 'pending';
  if (!base.total_amount) base.total_amount = 0;
  return base;
}

function sanitizeOrderUpdate(raw: any) {
  return pick(raw, [
    'status',
    'customer_name',
    'customer_phone',
    'customer_email',
    'shipping_address',
    'billing_address',
    'currency',
    'total_amount',
    'decision_reason',
  ]);
}

export default fp(async function registerOrderRoutes(app: FastifyInstance) {
  const baseDb: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);

  if (!baseDb) {
    app.log.warn('Order routes: no database bound to app.db; skipping.');
    return;
  }

  // Authentication already handled by v1 scope, no need to re-apply hooks

  /**
   * LIST: GET /api/v1/orders?storeId=&status=&from_date=&to_date=&page=&limit=
   * - Strict storeId behavior: if provided and not owned, 404 store_not_found_for_seller
   * - Count query mirrors filters
   */
  app.get('/api/v1/orders', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        // confirm seller exists
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const q = (req.query as any) ?? {};
        const page = Math.max(1, parseInt(q.page ?? '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10)));
        const offset = (page - 1) * limit;

        // pick store (explicit or first) - now STRICT when storeId is passed
        let store = null as any;
        if (q.storeId) {
          store = await db('stores').where({ id: q.storeId, seller_id: seller.id }).first();
          if (!store) return { code: 404 as const, body: { ok: false, error: 'store_not_found_for_seller' } };
        } else {
          store = await db('stores').where({ seller_id: seller.id }).orderBy('created_at', 'asc').first();
          if (!store) return { code: 200 as const, body: { ok: true, orders: [], pagination: { page, limit, total: 0, pages: 0 }, hint: 'no_stores_yet' } };
        }

        let ordersQ = db('orders')
          .select('orders.*')
          .where({ store_id: store.id })
          .orderBy('created_at', 'desc');

        if (q.status)    ordersQ = ordersQ.where('status', q.status);
        if (q.from_date) ordersQ = ordersQ.where('created_at', '>=', q.from_date);
        if (q.to_date)   ordersQ = ordersQ.where('created_at', '<=', q.to_date);

        // mirror filters for count
        const countQ = ordersQ.clone().clearSelect().clearOrder().count<{ count: string }>('id as count').first();

        const [orders, totalRow] = await Promise.all([
          ordersQ.limit(limit).offset(offset),
          countQ,
        ]);

        const total = parseInt((totalRow?.count as any) ?? '0', 10);

        const orderIds = (orders ?? []).map((o: any) => o.id).filter(Boolean);
        const customerIds = (orders ?? [])
          .map((o: any) => o.customer_id)
          .filter((v: any) => !!v);

        // Batch-load related rows
        const [itemsRows, customerRows] = orderIds.length
          ? await Promise.all([
              db('order_items').whereIn('order_id', orderIds).orderBy('created_at', 'asc').catch(() => []),
              customerIds.length ? db('customers').whereIn('id', customerIds).catch(() => []) : Promise.resolve([]),
            ])
          : [[], []];

        const orderIdToItems = new Map<string, any[]>();
        for (const it of itemsRows as any[]) {
          const arr = orderIdToItems.get(it.order_id) || [];
          arr.push({ id: it.id, order_id: it.order_id, product_id: it.product_id, sku: it.sku, qty: it.qty, price: it.price, name: it.name });
          orderIdToItems.set(it.order_id, arr);
        }

        const customerIdToRow = new Map<string, any>();
        for (const c of customerRows as any[]) customerIdToRow.set(c.id, c);

        const safe = (o: any) => ({
          ...o,
          decision_reason: o.decision_reason ? maskPII(o.decision_reason) : null,
          items: orderIdToItems.get(o.id) || [],
          customer: o.customer_id ? customerIdToRow.get(o.customer_id) || null : null,
        });

        return {
          code: 200 as const,
          body: {
            ok: true,
            orders: (orders ?? []).map(safe),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            store: { id: store.id, name: store.name },
          },
        };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'orders_list_failed' });
    }
  });

  /**
   * CREATE: POST /api/v1/orders
   * Body: { store_id | storeId, status?, total_amount?, currency?, customer_*, items?[] }
   */
  app.post('/api/v1/orders', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first();
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const body = (req.body as any) ?? {};
        const storeId = body.store_id || body.storeId;
        if (!storeId) return { code: 400 as const, body: { ok:false, error:'missing_store_id' } };

        const store = await db('stores').where({ id: storeId, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok:false, error:'forbidden' } };

        const insert = { ...sanitizeOrderInsert(body), store_id: store.id };

        const [order] = await db('orders').insert(insert).returning('*');

        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length) {
          const rows = items.map((it: any) => ({
            order_id: order.id,
            sku: it.sku ?? null,
            name: it.name ?? null,
            qty: Number(it.qty ?? 1),
            price: Number(it.price ?? 0),
          }));
          await db('order_items').insert(rows);
        }

        return { code: 201 as const, body: { ok: true, order } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'order_create_failed' });
    }
  });

  /**
   * DETAIL: GET /api/v1/orders/:id
   */
  app.get('/api/v1/orders/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const order = await db('orders').where({ id }).first();
        if (!order) return { code: 404 as const, body: { ok: false, error: 'order_not_found' } };

        // ensure belongs to seller
        const store = await db('stores').where({ id: order.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const items =
          (await db('order_items').where({ order_id: id }).orderBy('created_at', 'asc').catch(() => [])) ?? [];

        // conversations/messages (may be empty until loaded after creation)
        const conversations = await conversationsForOrder(db, order.store_id, id).catch(() => []);

        return {
          code: 200 as const,
          body: {
            ok: true,
            order: {
              ...order,
              decision_reason: order.decision_reason ? maskPII(order.decision_reason) : null,
            },
            items,
            conversations,
          },
        };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'order_detail_failed' });
    }
  });

  /**
   * UPDATE (partial): PATCH /api/v1/orders/:id
   */
  app.patch('/api/v1/orders/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first();
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const order = await db('orders').where({ id }).first();
        if (!order) return { code: 404 as const, body: { ok: false, error: 'order_not_found' } };

        // ensure order belongs to this seller
        const store = await db('stores').where({ id: order.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const updates = sanitizeOrderUpdate((req.body as any) ?? {});
        if (!Object.keys(updates).length) return { code: 400 as const, body: { ok:false, error:'no_fields_to_update' } };

        const [updated] = await db('orders').where({ id }).update(updates).returning('*');

        return { code: 200 as const, body: { ok: true, order: updated } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'order_update_failed' });
    }
  });

  // ================== Order-scoped AI (ITTRI) via proxy ==================
  // POST /api/v1/orders/:id/ai
  app.post('/api/v1/orders/:id/ai', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const order = await db('orders').where({ id }).first();
        if (!order) return { code: 404 as const, body: { ok: false, error: 'order_not_found' } };

        // ensure the order belongs to this seller
        const store = await db('stores').where({ id: order.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const body = (req.body as any) ?? {};
        const entity = (body.entity as string) ?? (body.prompt ? 'chat' : 'order');
        const kind = (body.kind as string) ?? (body.prompt ? 'ask' : 'query');
        const payload = body.prompt ? { prompt: String(body.prompt) } : (body.payload ?? {});

        const proxied = await callWorkerProxy('/proxy/ai', {
          seller_id: seller.id,
          store_id: store.id,
          entity,
          kind,
          payload: { ...payload, order_id: id }
        });

        return { code: 200 as const, body: { ok: true, result: proxied?.data ?? proxied } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      const code = err?.message === 'proxy_not_configured' ? 'ai_proxy_unavailable' : 'ai_proxy_error';
      return reply.code(status).send({ ok: false, error: code, details: err?.details ?? err?.message ?? 'unknown' });
    }
  });

  // ================== Order outbound (WhatsApp) via proxy ==================
  // POST /api/v1/orders/:id/outbound
  app.post('/api/v1/orders/:id/outbound', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const order = await db('orders').where({ id }).first();
        if (!order) return { code: 404 as const, body: { ok: false, error: 'order_not_found' } };

        // ensure the order belongs to this seller
        const store = await db('stores').where({ id: order.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const { to, text, template, locale, vars, conversation_id } = (req.body as any) ?? {};
        if (!to || (!text && !template)) {
          return {
            code: 400 as const,
            body: {
              ok: false,
              error: 'missing_required_fields',
              details: { required: ['to', 'text OR template'] },
            },
          };
        }

        const out = await callWorkerProxy('/proxy/outbound', {
          order_id: id,
          store_id: store.id,
          to,
          text,
          template,
          locale,
          vars,
          conversation_id
        });

        return { code: 200 as const, body: { ok: true, result: out } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      const code = err?.message === 'proxy_not_configured' ? 'outbound_proxy_unavailable' : 'outbound_proxy_error';
      return reply.code(status).send({ ok: false, error: code, details: err?.details ?? err?.message ?? 'unknown' });
    }
  });
}, {
  name: 'order-routes'
});
