import fp from 'fastify-plugin';
import client from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      registry: client.Registry;
      aiRequestTotal: client.Counter<'provider' | 'model'>;
    };
  }
}

const metricsPlugin = fp(async (fastify) => {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const aiRequestTotal = new client.Counter({
    name: 'ai_request_total',
    help: 'Total AI requests by provider and model',
    labelNames: ['provider', 'model'] as const,
    registers: [registry],
  });

  fastify.decorate('metrics', { registry, aiRequestTotal });

  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}, { name: 'metrics' });

export default metricsPlugin;
