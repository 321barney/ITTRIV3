// backend/src/api/seller.public.ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type ApiKeyCtx = { store_id: string };

// Dev-only fallback guard if app.requireApiKey isn't registered.
function devApiKeyFallback(_app: FastifyInstance) {
  return async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
    const storeId = (req.headers['x-store-id'] as string | undefined)?.trim();
    if (!storeId) {
      return reply
        .code(401)
        .send({
          ok: false,
          error: 'public_api_key_required',
          message: 'Missing X-API-Key or X-Store-Id header',
        });
    }
    (req as any).apiKey = { store_id: storeId } as ApiKeyCtx;
  };
}

// transaction-scoped elevation to app_admin + set current_seller GUC
async function withAdminForStore<T>(
  knex: any,
  storeId: string,
  fn: (trx: any, sellerId: string, store: any) => Promise<T>
): Promise<T> {
  return knex.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL ROLE app_admin');

    // fetch store (bypass RLS) and derive seller_id
    const store = await trx('stores').where({ id: storeId }).first();
    if (!store) {
      // bubble a typed signal; the caller will translate to 404
      throw Object.assign(new Error('store_not_found'), { code: 'STORE_404' });
    }

    const sellerId = String(store.seller_id);
    // set GUC for downstream code, logging, views, etc.
    await trx.raw(`SELECT set_config('app.current_seller', ?, true)`, [sellerId]);

    return fn(trx, sellerId, store);
  });
}

export default async function registerSellerPublicApi(app: FastifyInstance) {
  // Resolve Knex from app
  const baseDb: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);

  if (!baseDb) {
    app.log.warn('Seller public API: no database bound to app.db; skipping.');
    return;
  }

  // Use central API key guard if available, else a dev-only fallback
  const requireApiKey =
    (app as any).requireApiKey ??
    devApiKeyFallback(app);

  app.addHook('preHandler', requireApiKey);

  // POST /api/v1/products — create a product for the API key's store
  app.post('/api/v1/products', async (req, reply) => {
    try {
      const { store_id } = (req as any).apiKey || {};
      if (!store_id) {
        return reply.code(401).send({ ok: false, error: 'public_api_key_required' });
      }

      const body = (req.body as any) || {};
      const sku: string | undefined = body.sku?.toString().trim();
      const title: string | undefined = (body.title ?? body.name)?.toString().trim();
      const priceRaw = body.price;
      const currency: string = (body.currency ?? 'USD').toString().trim().toUpperCase();
      const attributes_json = body.metadata ?? body.attributes_json ?? null;
      const inventory = body.inventory ?? null;
      const status = body.status ?? 'active';

      if (!sku || !title || priceRaw == null || priceRaw === '') {
        return reply.code(400).send({
          ok: false,
          error: 'sku_title_price_required',
          details: { required: ['sku', 'title (or name)', 'price'] },
        });
      }

      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        return reply.code(400).send({ ok: false, error: 'invalid_price' });
      }

      const now = new Date();
      const payload = await withAdminForStore(baseDb, store_id, async (db, sellerId, store) => {
        const [product] = await db('products')
          .insert({
            store_id: store.id,
            seller_id: sellerId,
            sku,
            title,
            price,
            currency,
            attributes_json: attributes_json ?? null,
            inventory: inventory ?? null,
            status,
            created_at: now,
            updated_at: now,
          })
          .returning('*');

        return { code: 201 as const, body: { ok: true, product } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err: any) {
      if (err?.code === 'STORE_404') {
        return reply.code(404).send({ ok: false, error: 'store_not_found' });
      }
      // Unique SKU per store
      if (err?.code === '23505') {
        return reply.code(409).send({ ok: false, error: 'duplicate_sku' });
      }
      // Constraint violations
      if (err?.code === '23514') {
        return reply.code(400).send({
          ok: false,
          error: 'constraint_violation',
          details: err?.detail ?? err?.message,
        });
      }
      req.log?.error?.(err, 'public_product_create_failed');
      return reply.code(500).send({ ok: false, error: 'internal', message: 'Product creation failed' });
    }
  });

  // GET /api/v1/products — list products for the API key store (paginated)
  app.get('/api/v1/products', async (req, reply) => {
    try {
      const { store_id } = (req as any).apiKey || {};
      if (!store_id) {
        return reply.code(401).send({ ok: false, error: 'public_api_key_required' });
      }

      const q = (req.query as any) ?? {};
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      const payload = await withAdminForStore(baseDb, store_id, async (db, _sellerId, _store) => {
        const [items, totalRow] = await Promise.all([
          db('products')
            .where({ store_id })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset),
          db('products').where({ store_id }).count('id as count').first(),
        ]);

        const total = parseInt((totalRow?.count as any) ?? '0', 10);
        return {
          code: 200 as const,
          body: {
            ok: true,
            items,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
          },
        };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err: any) {
      if (err?.code === 'STORE_404') {
        return reply.code(404).send({ ok: false, error: 'store_not_found' });
      }
      req.log?.error?.(err, 'public_product_list_failed');
      return reply.code(500).send({ ok: false, error: 'internal' });
    }
  });
}
