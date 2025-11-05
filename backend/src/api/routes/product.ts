// backend/src/api/routes/product.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

type JwtUser = { id: string; role: 'seller' | 'admin' | string };

type PlanCaps = {
  canEditStore: boolean;
  canManageProducts: boolean;
  maxProducts: number | null;
};

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

/**
 * Protected call to the worker proxy (one choke point for all workers).
 * Requires:
 *  - process.env.WORKER_PROXY_URL (e.g. http://localhost:3000)
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

export default fp(async function registerProductRoutes(app: FastifyInstance) {
  const baseDb: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);

  if (!baseDb) {
    app.log.warn('Product routes: no database bound to app.db; skipping.');
    return;
  }

  const requireAuth =
    (app as any).requireAuth ?? ((_req: any, _rep: any, done: any) => done());
  const requireSeller =
    (app as any).requireRole
      ? (app as any).requireRole(['seller', 'admin'])
      : ((_req: any, _rep: any, done: any) => done());

  // -------- Helpers (run on the provided trx/db handle) --------
  async function getSellerRowByUserId(db: any, userId: string) {
    return db('sellers').where({ id: userId }).first().catch(() => null);
  }
  async function getMyStore(db: any, userId: string) {
    const seller = await getSellerRowByUserId(db, userId);
    if (!seller?.id) return null;
    return db('stores').where({ seller_id: seller.id }).orderBy('created_at', 'asc').first();
  }
  async function getMyCaps(db: any, userId: string): Promise<PlanCaps> {
    const seller = await getSellerRowByUserId(db, userId);
    const planCode =
      (seller?.plan_code as string | undefined) ??
      (await db('sellers').select('plan_code').where({ id: userId }).first().catch(() => null))?.plan_code ??
      'basic';
    return capsFor(planCode);
  }

  // ================== LIST ==================
  app.get('/api/v1/seller/products', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const store = await getMyStore(db, user.id);
        if (!store) return { code: 200 as const, body: { ok: true, items: [], hint: 'no_stores_yet' } };

        const items = await db('products')
          .where({ store_id: store.id })
          .orderBy('created_at', 'desc');

        return { code: 200 as const, body: { ok: true, items } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'products_list_failed' });
    }
  });

  // ================== CREATE (basic) ==================
  app.post('/api/v1/seller/products', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const [caps, store] = await Promise.all([getMyCaps(db, user.id), getMyStore(db, user.id)]);
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };
        if (!caps.canManageProducts)
          return { code: 403 as const, body: { ok: false, error: 'plan_forbids_product_manage' } };

        if (typeof caps.maxProducts === 'number') {
          const { count } =
            (await db('products')
              .where({ store_id: store.id })
              .count('id as count')
              .first()) ?? { count: 0 };
          if (parseInt(count as any, 10) >= caps.maxProducts) {
            return {
              code: 403 as const,
              body: { ok: false, error: 'product_limit_reached', limit: caps.maxProducts },
            };
          }
        }

        const { sku, title, price, currency, attributes_json, inventory, status } =
          ((req.body as any) ?? {}) as {
            sku?: string;
            title?: string;
            price?: number;
            currency?: string;
            attributes_json?: any;
            inventory?: number | null;
            status?: 'active' | 'inactive' | 'discontinued';
          };

        if (!sku || !title || price == null) {
          return { code: 400 as const, body: { ok: false, error: 'sku_title_price_required' } };
        }

        const seller = await getSellerRowByUserId(db, user.id);
        const now = new Date();
        const [product] = await db('products')
          .insert({
            store_id: store.id,
            seller_id: seller!.id,
            sku,
            title,
            price,
            currency: currency ?? 'USD',
            attributes_json: attributes_json ?? null,
            inventory: inventory ?? null,
            status: status ?? 'active',
            created_at: now,
            updated_at: now,
          })
          .returning('*');

        return { code: 201 as const, body: { ok: true, product } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'product_create_failed' });
    }
  });

  // ================== CREATE (with landing page) ==================
  app.post('/api/v1/seller/products/with-page', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    const {
      title,
      landing_url,
      sku,
      price,
      currency,
      attributes_json,
      inventory,
      status,
    } = ((req.body as any) ?? {}) as {
      title?: string;
      landing_url?: string;
      sku?: string;
      price?: number;
      currency?: string;
      attributes_json?: any;
      inventory?: number | null;
      status?: 'active' | 'inactive' | 'discontinued';
    };

    if (!title || !landing_url) {
      return reply.code(400).send({
        ok: false,
        error: 'missing_required_fields',
        details: { required: ['title', 'landing_url'] },
      });
    }
    try {
      const u = new URL(landing_url);
      if (!/^https?:$/i.test(u.protocol)) throw new Error('bad');
    } catch {
      return reply.code(400).send({ ok: false, error: 'invalid_landing_url' });
    }

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const [caps, store, seller] = await Promise.all([
          getMyCaps(db, user.id),
          getMyStore(db, user.id),
          getSellerRowByUserId(db, user.id),
        ]);
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };
        if (!caps.canManageProducts)
          return { code: 403 as const, body: { ok: false, error: 'plan_forbids_product_manage' } };

        if (typeof caps.maxProducts === 'number') {
          const { count } =
            (await db('products')
              .where({ store_id: store.id })
              .count('id as count')
              .first()) ?? { count: 0 };
          if (parseInt(count as any, 10) >= caps.maxProducts) {
            return {
              code: 403 as const,
              body: { ok: false, error: 'product_limit_reached', limit: caps.maxProducts },
            };
          }
        }

        const slugify = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
        const finalSku =
          (sku && sku.trim()) || `${slugify(title!)}-${Math.random().toString(36).slice(2, 8)}`;
        const finalPrice = (typeof price === 'number' && price >= 0) ? price : 0.0;

        const now = new Date();
        // nested transaction -> Knex will create a savepoint inside our outer txn
        const result = await db.transaction(async (trx: any) => {
          const [product] = await trx('products')
            .insert({
              store_id: store.id,
              seller_id: seller!.id,
              sku: finalSku,
              title: title!.trim(),
              price: finalPrice,
              currency: currency ?? 'USD',
              attributes_json: attributes_json ?? null,
              inventory: inventory ?? null,
              status: status ?? 'active',
              created_at: now,
              updated_at: now,
            })
            .returning('*');

          const [page] = await trx('product_pages')
            .insert({
              product_id: product.id,
              landing_url,
              html_cache: null,
              last_fetched_at: null,
              created_at: now,
            })
            .returning('*');

          return { product, page };
        });

        return { code: 201 as const, body: { ok: true, product: result.product, product_page: result.page } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'product_with_page_failed' });
    }
  });

  // ================== UPDATE ==================
  app.put('/api/v1/seller/products/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const caps = await getMyCaps(db, user.id);
        if (!caps.canManageProducts)
          return { code: 403 as const, body: { ok: false, error: 'plan_forbids_product_manage' } };

        const store = await getMyStore(db, user.id);
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };

        const id = String((req.params as any).id);
        const { sku, title, price, currency, attributes_json, inventory, status } =
          ((req.body as any) ?? {}) as {
            sku?: string;
            title?: string;
            price?: number;
            currency?: string;
            attributes_json?: any;
            inventory?: number | null;
            status?: 'active' | 'inactive' | 'discontinued';
          };

        const update: any = { updated_at: new Date() };
        if (sku !== undefined) update.sku = sku;
        if (title !== undefined) update.title = title;
        if (price !== undefined) update.price = price;
        if (currency !== undefined) update.currency = currency;
        if (attributes_json !== undefined) update.attributes_json = attributes_json;
        if (inventory !== undefined) update.inventory = inventory;
        if (status !== undefined) update.status = status;

        const [product] = await db('products')
          .where({ id, store_id: store.id })
          .update(update)
          .returning('*');

        if (!product) return { code: 404 as const, body: { ok: false, error: 'product_not_found' } };
        return { code: 200 as const, body: { ok: true, product } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'product_update_failed' });
    }
  });

  // ================== DELETE ==================
  app.delete('/api/v1/seller/products/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const caps = await getMyCaps(db, user.id);
        if (!caps.canManageProducts)
          return { code: 403 as const, body: { ok: false, error: 'plan_forbids_product_manage' } };

        const store = await getMyStore(db, user.id);
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };

        const id = String((req.params as any).id);
        const deleted = await db('products').where({ id, store_id: store.id }).delete();
        if (!deleted) return { code: 404 as const, body: { ok: false, error: 'product_not_found' } };
        return { code: 204 as const, body: undefined as any };
      });

      if (payload.code === 204) return reply.code(204).send();
      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'product_delete_failed' });
    }
  });

  // ================== NEW: AI (ITTRI) product assistant via proxy ==================
  app.post('/api/v1/seller/products/ai', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const store = await getMyStore(db, user.id);
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };

        const body = (req.body as any) ?? {};
        const entity = (body.entity as string) ?? (body.prompt ? 'chat' : 'product');
        const kind = (body.kind as string) ?? (body.prompt ? 'ask' : 'query');
        const requestPayload =
          body.prompt ? { prompt: String(body.prompt) } : (body.payload ?? {});

        const proxied = await callWorkerProxy('/proxy/ai', {
          seller_id: user.id,
          store_id: store.id,
          entity,
          kind,
          payload: requestPayload
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

  // ================== /api/v1 Aliases for Frontend ==================
  // Note: GET /api/v1/products and POST /api/v1/products already exist in seller.public.ts

  app.post('/api/v1/products/with-page', async (req, reply) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/seller/products/with-page', body: req.body, headers: req.headers });
    return reply.code(res.statusCode).headers(res.headers).send(res.body);
  });

  app.put('/api/v1/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await app.inject({ method: 'PUT', url: `/api/v1/seller/products/${id}`, body: req.body, headers: req.headers });
    return reply.code(res.statusCode).headers(res.headers).send(res.body);
  });

  app.delete('/api/v1/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/seller/products/${id}`, headers: req.headers });
    return reply.code(res.statusCode).headers(res.headers).send(res.body);
  });

  app.post('/api/v1/products/ai', async (req, reply) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/seller/products/ai', body: req.body, headers: req.headers });
    return reply.code(res.statusCode).headers(res.headers).send(res.body);
  });
}, {
  name: 'product-routes'
});
