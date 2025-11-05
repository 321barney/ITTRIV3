import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export default fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
    ban: 0,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'retry-after': true
    },
    keyGenerator: (req) => {
      const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      return auth || req.ip;
    }
  });
});
