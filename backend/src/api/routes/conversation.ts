// backend/src/api/routes/conversation.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { conversationsForOrder, listRecentStoreConversationsLinkedToOrders } from '../../utils/conversations.js';

type JwtUser = { id: string; role: 'seller' | 'admin' | string };

async function withAdmin<T>(knex: any, sellerId: string, fn: (trx: any) => Promise<T>): Promise<T> {
  return knex.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL ROLE app_admin');
    await trx.raw(`SELECT set_config('app.current_seller', ?, true)`, [sellerId]);
    return fn(trx);
  });
}

export default fp(async function registerConversationRoutes(app: FastifyInstance) {
  const baseDb: any =
    typeof (app as any).db === 'function'
      ? (app as any).db
      : ((app as any).db?.knex ?? (app as any).db);

  if (!baseDb) {
    app.log.warn('Conversation routes: no database bound to app.db; skipping.');
    return;
  }

  // Authentication already handled by v1 scope, no need to re-apply hooks

  // ================== LIST CONVERSATIONS ==================
  // GET /conversations?store_id=&page=&limit=
  app.get('/api/v1/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const q = (req.query as any) ?? {};
        const page = Math.max(1, parseInt(q.page ?? '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10)));
        const offset = (page - 1) * limit;

        // pick store (explicit or first) - fallback gracefully if store_id doesn't match
        let store = null as any;
        if (q.store_id) {
          store = await db('stores').where({ id: q.store_id, seller_id: seller.id }).first();
        }
        // If no store found (no store_id provided or store_id didn't match), use seller's first store
        if (!store) {
          store = await db('stores').where({ seller_id: seller.id }).orderBy('created_at', 'asc').first();
        }
        if (!store) return { code: 200 as const, body: { ok: true, conversations: [], total: 0, page, limit, hint: 'no_stores_yet' } };

        const conversations = await listRecentStoreConversationsLinkedToOrders(db, store.id, limit, offset);

        const totalRow = await db('conversations')
          .where({ store_id: store.id })
          .count('id as count')
          .first();
        const total = parseInt((totalRow?.count as any) ?? '0', 10);

        return {
          code: 200 as const,
          body: {
            ok: true,
            conversations,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
          },
        };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'conversations_list_failed' });
    }
  });

  // ================== GET CONVERSATION DETAIL ==================
  // GET /conversations/:id
  app.get('/api/v1/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const conversation = await db('conversations').where({ id }).first();
        if (!conversation) return { code: 404 as const, body: { ok: false, error: 'conversation_not_found' } };

        const store = await db('stores').where({ id: conversation.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const messages = await db('messages')
          .where({ conversation_id: id })
          .orderBy('created_at', 'asc')
          .catch(() => []);

        return {
          code: 200 as const,
          body: {
            ok: true,
            conversation: {
              ...conversation,
              messages: messages ?? [],
            },
          },
        };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'conversation_detail_failed' });
    }
  });

  // ================== CREATE CONVERSATION ==================
  // POST /conversations
  app.post('/api/v1/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const { store_id, customer_id, origin, status, order_id, meta_json } = (req.body as any) ?? {};

        let store = null as any;
        if (store_id) {
          store = await db('stores').where({ id: store_id, seller_id: seller.id }).first();
        } else {
          store = await db('stores').where({ seller_id: seller.id }).orderBy('created_at', 'asc').first();
        }
        if (!store) return { code: 400 as const, body: { ok: false, error: 'store_required', hint: 'create_store_first' } };

        const now = new Date();
        const [conversation] = await db('conversations')
          .insert({
            store_id: store.id,
            customer_id: customer_id ?? null,
            origin: origin ?? 'manual',
            status: status ?? 'active',
            order_id: order_id ?? null,
            meta_json: meta_json ?? null,
            created_at: now,
            updated_at: now,
          })
          .returning('*');

        return { code: 201 as const, body: { ok: true, conversation } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'conversation_create_failed' });
    }
  });

  // ================== UPDATE CONVERSATION ==================
  // PATCH /conversations/:id
  app.patch('/api/v1/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtUser;
    if (!user?.id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    try {
      const payload = await withAdmin(baseDb, user.id, async (db) => {
        const seller = await db('sellers').where({ id: user.id }).first().catch(() => null);
        if (!seller) return { code: 403 as const, body: { ok: false, error: 'not_seller' } };

        const id = String((req.params as any).id);
        const conversation = await db('conversations').where({ id }).first();
        if (!conversation) return { code: 404 as const, body: { ok: false, error: 'conversation_not_found' } };

        const store = await db('stores').where({ id: conversation.store_id, seller_id: seller.id }).first();
        if (!store) return { code: 403 as const, body: { ok: false, error: 'forbidden' } };

        const { status, order_id, meta_json } = (req.body as any) ?? {};

        const update: any = { updated_at: new Date() };
        if (status !== undefined) update.status = status;
        if (order_id !== undefined) update.order_id = order_id;
        if (meta_json !== undefined) update.meta_json = meta_json;

        const [updated] = await db('conversations')
          .where({ id })
          .update(update)
          .returning('*');

        return { code: 200 as const, body: { ok: true, conversation: updated } };
      });

      return reply.code(payload.code).send(payload.body);
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ ok: false, error: 'internal', message: 'conversation_update_failed' });
    }
  });
}, {
  name: 'conversation-routes'
});
