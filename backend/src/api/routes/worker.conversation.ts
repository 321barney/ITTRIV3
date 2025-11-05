import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getConversationQueue, addScanJob } from '../../utils/worker-bus-conversation';
import { RUN_WORKERS, CONVO_ENABLED } from '../../utils/flags';
import { installConversationWorker } from '../../worker/conversation';

type KickBody = { label?: string };

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
  }
}

export default fp(async function conversationWorkerRoutes(app: FastifyInstance) {
  // Ensure worker handlers are installed when API runs in-process workers
  if (RUN_WORKERS && CONVO_ENABLED) {
    installConversationWorker((app as any).knex || (app as any).db, app.log);
  }

  // Build route options with auth if available
  const routeOpts: any = {};
  if (app.requireAuth) {
    routeOpts.preHandler = app.requireAuth;
  }

  app.get('/worker/conversation/queue', routeOpts, async (req, reply) => {
    try {
      const q = getConversationQueue();
      const counts = await q.getJobCounts('waiting','active','completed','failed','delayed','paused');
      return { ok: true, queue: { name: q.name, ...counts }, run_workers_in_api: RUN_WORKERS };
    } catch (e: any) {
      return { ok: false, error: 'queue_unavailable', detail: e?.message || String(e) };
    }
  });

  app.post('/worker/conversation/kick', routeOpts, async (req: FastifyRequest<{ Body: KickBody }>, reply: FastifyReply) => {
    try {
      const label = (req.body?.label || 'manual');
      const j = await addScanJob(label);
      return { ok: true, job: { id: j.id, name: j.name } };
    } catch (e: any) {
      return { ok: false, error: 'enqueue_failed', detail: e?.message || String(e) };
    }
  });
});
