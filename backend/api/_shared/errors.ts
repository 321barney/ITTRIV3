
import type { FastifyError, FastifyInstance } from 'fastify';
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const code = (error as any)?.code;
    if (code === '23505') return reply.code(409).send({ ok:false, error:'unique_violation' });
    if (code === '23503') return reply.code(409).send({ ok:false, error:'foreign_key_violation' });
    if ((error as any)?.validation) return reply.code(400).send({ ok:false, error:'validation_error', details:(error as any).validation });
    app.log.error(error);
    return reply.code(500).send({ ok:false, error:'internal_error' });
  });
}
