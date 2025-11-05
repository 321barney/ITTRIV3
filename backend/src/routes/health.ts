import type { FastifyInstance } from 'fastify';
import { redis } from '../lib/redis';

export default async function routes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async () => {
    if ((app as any).db?.raw) {
      await (app as any).db.raw('select 1');
    }
    await redis.ping();
    return { ok: true };
  });
}
