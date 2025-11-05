import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Simple admin guard – adapt to your API key or role check.
function isAdmin(req: FastifyRequest) {
  const key = (req.headers['x-admin-key'] || req.headers['X-Admin-Key']) as string | undefined;
  return key && key === process.env.ADMIN_API_KEY;
}

export default async function subscriptionAdmin(app: FastifyInstance) {
  const db = (app as any).db;

  app.post('/admin/subscription/set', async (req: FastifyRequest<{
    Body: { seller_id: string; status: 'active'|'trialing'|'past_due'|'canceled'|'locked';
            expires_at?: string | null; grace_days?: number | null }
  }>, reply: FastifyReply) => {
    if (!isAdmin(req)) return reply.code(403).send({ ok: false, error: 'forbidden' });

    const { seller_id, status, expires_at, grace_days } = req.body || ({} as any);
    if (!seller_id || !status) return reply.code(400).send({ ok: false, error: 'missing_fields' });

    await db.raw(
      'SELECT app.set_subscription_state(?, ?, ?, ?)',
      [seller_id, status, expires_at ?? null, grace_days ?? null]
    );

    const [row] = await db.withSchema('app').from('seller_lock_state').where({ seller_id }).limit(1);
    return reply.send({ ok: true, state: row });
  });

  app.get('/admin/subscription/state', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ ok: false, error: 'forbidden' });
    const seller_id = (req.query as any)?.seller_id as string | undefined;
    if (!seller_id) return reply.code(400).send({ ok: false, error: 'seller_id_required' });
    const [row] = await db.withSchema('app').from('seller_lock_state').where({ seller_id }).limit(1);
    return reply.send({ ok: true, state: row || null });
  });
}
