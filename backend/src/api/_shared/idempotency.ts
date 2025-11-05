
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { resolveDb } from './rls.js';
export function idempotencyMiddleware(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) return;
    const db = resolveDb(app);
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const kvKey = `idem:${hash}`;
    const { rows: [stored] } = await db.raw(`SELECT value FROM app.app_kv WHERE key = ?`, [kvKey]);
    if (stored?.value) {
      const val = stored.value;
      return reply.code(val.status ?? 200).send(val.body ?? val);
    }
    (req as any).__idem = { kvKey };
  };
}
export async function storeIdempotent(app: FastifyInstance, req: FastifyRequest, status: number, body: any) {
  const idem = (req as any).__idem as { kvKey: string } | undefined;
  if (!idem) return;
  const db = resolveDb(app);
  await db.raw(`INSERT INTO app.app_kv (key, value) VALUES (?, ?::jsonb) ON CONFLICT (key) DO NOTHING`, [idem.kvKey, JSON.stringify({ status, body })]);
}
