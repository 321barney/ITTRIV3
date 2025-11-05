import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PUBLIC_TAG } from '../lib/routeTags';

function isPublic(req: FastifyRequest) {
  const tags = (req.routeOptions?.schema as any)?.tags as string[] | undefined;
  return Array.isArray(tags) && tags.includes(PUBLIC_TAG);
}

// Optional: quick header that FE can use to gate UI
function markLocked(reply: FastifyReply, reason?: string) {
  reply.header('x-account-locked', '1');
  if (reason) reply.header('x-lock-reason', reason);
}

export default fp(async function lockdown(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    // We assume you resolved sellerId in auth (JWT) or a header earlier.
    const sellerId = (req as any).user?.seller_id || (req.headers['x-seller-id'] as string | undefined);
    if (!sellerId || isPublic(req)) return;

    // Ask DB if locked (cheap, uses function; no row scans)
    const db = (app as any).db;
    try {
      const [{ locked }] = await db
        .select(db.raw('app.is_seller_locked(?) AS locked', [sellerId]));
      if (!locked) return;

      markLocked(reply);
      return reply.code(402).send({
        ok: false,
        error: 'account_locked',
        message: 'Your subscription is inactive. Please update billing to restore access.',
      });
    } catch (e) {
      // If DB is down, fail closed for safety (or swap to 503 if you prefer)
      markLocked(reply, 'db_error');
      return reply.code(402).send({
        ok: false,
        error: 'account_locked',
        message: 'Account locked or unavailable.',
      });
    }
  });
});
