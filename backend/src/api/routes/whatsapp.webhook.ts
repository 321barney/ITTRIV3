import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { addIncomingJob } from '../../utils/worker-bus-conversation';

type VerifyQuery = { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };

export default fp(async function whatsappWebhook(app: FastifyInstance) {
  // Verification (GET)
  app.get('/webhooks/whatsapp', async (req: FastifyRequest<{ Querystring: VerifyQuery }>, reply: FastifyReply) => {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === (process.env.WHATSAPP_VERIFY_TOKEN || 'verify_me')) {
      reply.header('content-type', 'text/plain').send(q['hub.challenge'] || '');
      return;
    }
    reply.code(403).send('forbidden');
  });

  // Incoming events (POST)
  app.post('/webhooks/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const body: any = (req as any).body || {};
    try {
      const entries = body.entry || [];
      for (const e of entries) {
        const changes = e.changes || [];
        for (const c of changes) {
          const value = c.value || {};
          const messages = value.messages || [];
          const metadata = value.metadata || {};
          const store_id = (req.headers['x-store-id'] as string) || ''; // in multi-tenant, inject mapping
          for (const m of messages) {
            if (m.type === 'text') {
              const conversation_id = (m.context && m.context.id) || (m.from + ':' + (value.metadata?.phone_number_id || ''));
              await addIncomingJob({
                kind: 'incoming',
                conversation_id,
                store_id,
                from: m.from,
                text: m.text?.body || '',
                payload: m
              });
            } else if (m.type === 'button') {
              const conversation_id = (m.from + ':' + (value.metadata?.phone_number_id || ''));
              await addIncomingJob({
                kind: 'incoming',
                conversation_id,
                store_id,
                from: m.from,
                text: (m.button?.text || m.button?.payload || ''),
                payload: m
              });
            } else if (m.type === 'location') {
              const conversation_id = (m.from + ':' + (value.metadata?.phone_number_id || ''));
              await addIncomingJob({
                kind: 'incoming',
                conversation_id,
                store_id,
                from: m.from,
                text: `LOCATION ${m.location?.latitude},${m.location?.longitude}`,
                payload: m
              });
            }
          }
        }
      }
      reply.send({ ok: true });
    } catch (e: any) {
      app.log.error({ err: e, body }, 'whatsapp_webhook_error');
      reply.code(400).send({ ok: false });
    }
  });
});
