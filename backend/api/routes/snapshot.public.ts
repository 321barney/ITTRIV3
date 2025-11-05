import type { FastifyInstance } from 'fastify';
import { PUBLIC_TAG } from '../../lib/routeTags';
import { loadSellerSnapshot } from '../../lib/snapshot';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
  }
}

export default async function snapshotPublic(app: FastifyInstance) {
  // Build route options with auth
  const routeOpts: any = { schema: { tags: [PUBLIC_TAG] } };
  if (app.requireAuth) {
    routeOpts.preHandler = app.requireAuth;
  }

  app.get('/snapshot', routeOpts, async (req, reply) => {
    const sellerId = (req as any).user?.seller_id || (req.headers['x-seller-id'] as string);
    if (!sellerId) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    const snap = await loadSellerSnapshot(String(sellerId));
    if (!snap) return reply.code(404).send({ ok: false, error: 'no_snapshot' });

    return reply.send({ ok: true, snapshot_at: snap.at, data: snap.data });
  });
}
