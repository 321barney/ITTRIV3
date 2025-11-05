import fp from 'fastify-plugin';
import cors from '@fastify/cors';

const parseOrigins = (s?: string) =>
  (s ?? '').split(',').map(v => v.trim()).filter(Boolean);

export default fp(async (app) => {
  // If CORS already set, skip to avoid "decorator already added" error
  const already = typeof (app as any).hasRequestDecorator === 'function'
    && app.hasRequestDecorator('corsPreflightEnabled');
  if (already) return;

  const origins = parseOrigins(process.env.CORS_ORIGINS);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl/healthchecks
      cb(null, origins.length ? origins.includes(origin) : true);
    },
    credentials: true
  });
});
