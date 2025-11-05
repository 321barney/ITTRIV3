import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

type PageQ = { page?: string; limit?: string };
type OrdersQ = PageQ & { store_id?: string; status?: string; seller_id?: string };
type PeriodQ = { period?: string; seller_id?: string };

const HDR_IMPERSONATE = 'x-impersonate-seller-id';

function maskPII(input: string): string {
  if (!input) return input;
  let s = input;
  s = s.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)\.([A-Za-z]{2,})/g, (_, a, b, c) => `${a}***@${b}.${c}`);
  s = s.replace(/\bhttps?:\/\/[^\s)]+/g, (m) => m.replace(/([^:\/]{3})[^\/]*/g, '$1***'));
  s = s.replace(/\b\d{6,}\b/g, (m) => m.slice(0, 3) + '***' + m.slice(-2));
  return s;
}

function isEmailInAllowlist(email?: string | null) {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || '';
  if (!raw.trim()) return false;
  const list = raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const u: any = (req as any).user || {};
  const roles: string[] = Array.isArray(u.roles) ? u.roles.map((r: any) => String(r).toLowerCase()) : [];
  const isAdminFlag = u.is_admin === true || roles.includes('admin') || isEmailInAllowlist(u.email || u.user_email);
  if (!isAdminFlag) {
    return reply.code(403).send({ ok: false, error: 'forbidden', hint: 'admin_required' });
  }
}

function isUuid(s?: string | null) {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function withAdmin<T>(
  baseDb: any,
  req: FastifyRequest,
  fn: (trx: any, currentSellerId: string | null) => Promise<T>
): Promise<T> {
  const headerSeller = (req.headers[HDR_IMPERSONATE] as string | undefined)?.trim() || null;
  const querySeller = (req.query as any)?.seller_id || null;
  const sellerId = headerSeller || querySeller || null;

  return baseDb.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL search_path = app, public');
    await trx.raw('SET LOCAL ROLE app_admin');

    let effective: string | null = null;
    if (sellerId && isUuid(sellerId)) {
      await trx.raw('SELECT app.set_current_seller($1)', [sellerId]);
      effective = sellerId;
    } else {
      await trx.raw('SELECT app.set_current_seller(NULL)');
    }

    try {
      const result = await fn(trx, effective);
      await trx.raw('SELECT app.set_current_seller(NULL)');
      return result;
    } catch (e) {
      try { await trx.raw('SELECT app.set_current_seller(NULL)'); } catch {}
      throw e;
    }
  });
}

async function conversationsForOrder(trx: any, orderId: string) {
  try {
    const rows = await trx.withSchema('app')('conversations')
      .select('*')
      .whereRaw(`metadata->>'order_id' = ?`, [orderId])
      .orderBy('created_at', 'desc')
      .limit(50);
    return rows ?? [];
  } catch {
    return [];
  }
}

export default fp(async function adminRoutes(app: FastifyInstance) {
  const db: any = (app as any).db;

  if ((app as any).requireAuth) app.addHook('onRequest', (app as any).requireAuth);
  app.addHook('onRequest', requireAdmin);

  // ===== ORDERS =====
  app.get('/admin/orders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as OrdersQ;
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const payload = await withAdmin(db, request, async (trx) => {
        const T = (t: string) => trx.withSchema('app')(t);

        let base = T('orders')
          .select('orders.*', trx.raw('stores.name as store_name'), trx.raw('stores.seller_id'))
          .leftJoin('stores', 'orders.store_id', 'stores.id');

        if (q.store_id) base = base.where('orders.store_id', q.store_id);
        if (q.status)   base = base.where('orders.status', q.status);
        if (q.seller_id && isUuid(q.seller_id)) base = base.where('stores.seller_id', q.seller_id);

        const [rows, totalRow] = await Promise.all([
          base.clone().orderBy('orders.created_at', 'desc').limit(limit).offset(offset),
          base.clone().count<{ count: string }>('orders.id as count').first(),
        ]);

        const total = parseInt(totalRow?.count || '0', 10);

        return {
          ok: true,
          orders: (rows ?? []).map((order: any) => ({
            ...order,
            decision_reason: order.decision_reason ? maskPII(order.decision_reason) : null,
          })),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
      });

      return reply.send(payload);
    } catch (error) {
      request.log.error({ error }, 'orders_fetch_failed');
      return reply.code(500).send({ ok: false, error: 'orders_fetch_failed' });
    }
  });

  app.get('/admin/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) return reply.code(400).send({ ok: false, error: 'invalid_order_id' });

      const payload = await withAdmin(db, request, async (trx) => {
        const T = (t: string) => trx.withSchema('app')(t);

        const order = await T('orders')
          .select('orders.*', trx.raw('stores.name as store_name'), trx.raw('stores.seller_id'))
          .leftJoin('stores', 'orders.store_id', 'stores.id')
          .where('orders.id', id)
          .first();

        if (!order) return { ok: false, error: 'order_not_found' };

        const conversations = await conversationsForOrder(trx, id).catch(() => []);

        return {
          ok: true,
          order: {
            ...order,
            decision_reason: order.decision_reason ? maskPII(order.decision_reason) : null,
            conversations,
          },
        };
      });

      const status = (payload as any).error ? 404 : 200;
      return reply.code(status).send(payload);
    } catch (error) {
      request.log.error({ error }, 'order_fetch_failed');
      return reply.code(500).send({ ok: false, error: 'order_fetch_failed' });
    }
  });

  app.patch('/admin/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { status, decision_reason } = request.body as { status?: string; decision_reason?: string };

      const allowed = new Set(['new', 'processing', 'completed', 'cancelled', 'refunded']);
      if (!isUuid(id)) return reply.code(400).send({ ok: false, error: 'invalid_order_id' });
      if (!status || !allowed.has(status)) {
        return reply.code(400).send({ ok: false, error: 'invalid_status' });
      }

      const payload = await withAdmin(db, request, async (trx) => {
        const T = (t: string) => trx.withSchema('app')(t);

        const [updated] = await T('orders')
          .where('id', id)
          .update({
            status,
            decision_reason: decision_reason ?? null,
            decision_by: 'admin',
            updated_at: trx.fn.now(),
          })
          .returning('*');

        if (!updated) return { ok: false, error: 'order_not_found' };

        await trx.withSchema('app')('admin_actions')
          .insert({
            admin_user_id: (request as any).user?.id || null,
            action_type: 'order_status_change',
            resource_type: 'order',
            resource_id: id,
            old_value: null,
            new_value: status,
            reason: decision_reason ?? null,
            created_at: trx.fn.now(),
          })
          .catch(() => {});

        return {
          ok: true,
          order: {
            ...updated,
            decision_reason: updated.decision_reason ? maskPII(updated.decision_reason) : null,
          },
        };
      });

      const code = (payload as any).error ? 404 : 200;
      return reply.code(code).send(payload);
    } catch (error) {
      request.log.error({ error }, 'order_update_failed');
      return reply.code(500).send({ ok: false, error: 'order_update_failed' });
    }
  });

  // ===== SYSTEM CONFIG =====
  app.get('/admin/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await withAdmin(db, request, async (trx) => {
        const rows = await trx.withSchema('app')('app_kv')
          .select('key', 'value')
          .whereIn('key', ['google_sheets_url', 'system_settings', 'notification_settings', 'ai_settings']);

        const config = (rows ?? []).reduce((acc: Record<string, any>, r: any) => {
          let value = r.value;
          if (r.key === 'google_sheets_url' && value?.url) value = { ...value, url: maskPII(value.url) };
          acc[r.key] = value;
          return acc;
        }, {} as Record<string, any>);
        return { ok: true, config };
      });

      return reply.send(payload);
    } catch (error) {
      request.log.error({ error }, 'config_fetch_failed');
      return reply.code(500).send({ ok: false, error: 'config_fetch_failed' });
    }
  });

  app.put('/admin/config/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { key } = request.params as { key: string };
      const { value } = request.body as { value: any };

      const allowedKeys = ['google_sheets_url', 'system_settings', 'notification_settings', 'ai_settings'];
      if (!key || value === undefined) return reply.code(400).send({ ok: false, error: 'key_and_value_required' });
      if (!allowedKeys.includes(key)) return reply.code(400).send({ ok: false, error: 'invalid_config_key' });

      const payload = await withAdmin(db, request, async (trx) => {
        const KV = trx.withSchema('app')('app_kv');
        const now = trx.fn.now();

        await KV.insert({ key, value, created_at: now, updated_at: now })
          .onConflict('key')
          .merge({ value, updated_at: now });

        await trx.withSchema('app')('admin_actions')
          .insert({
            admin_user_id: (request as any).user?.id || null,
            action_type: 'config_update',
            resource_type: 'config',
            resource_id: key,
            old_value: null,
            new_value: JSON.stringify(value),
            created_at: now,
          })
          .catch(() => {});

        return { ok: true, message: 'Config updated successfully' };
      });

      return reply.send(payload);
    } catch (error) {
      request.log.error({ error }, 'config_update_failed');
      return reply.code(500).send({ ok: false, error: 'config_update_failed' });
    }
  });

  // ===== SYSTEM METRICS (aligns with your schema) =====
  app.get('/admin/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as PeriodQ;
      const hours = q.period === '24h' ? 24 : q.period === '7d' ? 168 : q.period === '1h' ? 1 : 1;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const payload = await withAdmin(db, request, async (trx, currentSellerId) => {
        const T = (t: string) => trx.withSchema('app')(t);

        // error_logs
        const errorLogs = await T('error_logs')
          .select('*')
          .modify((qb: any) => {
            if (currentSellerId && isUuid(currentSellerId)) qb.where('seller_id', currentSellerId);
          })
          .andWhere('created_at', '>=', since)
          .orderBy('created_at', 'desc')
          .limit(100)
          .catch(() => []);

        // performance_logs (avg duration & counts by operation)
        const perfAgg = await T('performance_logs')
          .select('operation')
          .avg<{ avg_duration: string }>('duration_ms as avg_duration')
          .count<{ count: string }>('id as count')
          .modify((qb: any) => {
            if (currentSellerId && isUuid(currentSellerId)) qb.where('seller_id', currentSellerId);
          })
          .where('created_at', '>=', since)
          .groupBy('operation')
          .catch(() => []);

        return {
          ok: true,
          metrics: {
            errors: (errorLogs ?? []).map((e: any) => ({
              ...e,
              error_message: maskPII(e.error_message || ''),
              context: e.context ? maskPII(JSON.stringify(e.context)) : null,
            })),
            performance: perfAgg,
            period: `${hours}h`,
            seller_filter: currentSellerId || null,
          },
        };
      });

      return reply.send(payload);
    } catch (error) {
      request.log.error({ error }, 'metrics_fetch_failed');
      return reply.code(500).send({ ok: false, error: 'metrics_fetch_failed' });
    }
  });

  // ===== ADMIN ACTION LOG (best-effort if table exists) =====
  app.get('/admin/actions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as PageQ;
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const payload = await withAdmin(db, request, async (trx) => {
        const T = (t: string) => trx.withSchema('app')(t);

        const [actions, countRow] = await Promise.all([
          T('admin_actions')
            .select('*')
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset)
            .catch(() => []),
          T('admin_actions').count<{ count: string }>('id as count').first().catch(() => ({ count: '0' })),
        ]);

        const total = parseInt(countRow?.count || '0', 10);

        return {
          ok: true,
          actions: (actions ?? []).map((a: any) => ({
            ...a,
            old_value: a.old_value ? maskPII(a.old_value) : null,
            new_value: a.new_value ? maskPII(a.new_value) : null,
            reason: a.reason ? maskPII(a.reason) : null,
          })),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
      });

      return reply.send(payload);
    } catch (error) {
      request.log.error({ error }, 'actions_fetch_failed');
      return reply.code(500).send({ ok: false, error: 'actions_fetch_failed' });
    }
  });
});
