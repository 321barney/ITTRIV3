// src/api/server.ts
import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

import v1 from './v1/index';

import { getDb, initializeDatabase } from '../db/index';
import authContext from './plugin/auth-context';

// ⚙️ conversation worker + flags + bus
import conversation from '../worker/conversation';
import {
  addScanJob,
  scheduleRecurringScan,
  waitConvoReady,
} from '../utils/worker-bus-conversation';
import {
  RUN_WORKERS,
  CONVO_ENABLED,
  CONVO_SCAN_ON_BOOT,
  CONVO_SCAN_INTERVAL_MS,
  WHATSAPP_ENABLED,
  WHATSAPP_ENV_AVAILABLE,
} from '../utils/flags';

const app = Fastify({ logger: true });

// Global plugins
await app.register(helmet, { global: true, contentSecurityPolicy: false });

await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  timeWindow: process.env.RATE_LIMIT_TTL_MS
    ? Number(process.env.RATE_LIMIT_TTL_MS)
    : '1 minute',
});

await app.register(cookie, { hook: 'onRequest' });

await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret',
  cookie: { cookieName: 'access_token' },
});

// Auth context before routes
await app.register(authContext);

// Database boot
await initializeDatabase({
  info: app.log.info.bind(app.log),
  error: app.log.error.bind(app.log),
} as any);
(app as any).db = getDb();

// Root + health
app.get('/', async (_req, reply) => reply.redirect('/api/v1/__routes', 302));
app.get('/healthz', async () => ({ ok: true, data: { ping: 'pong' } }));

// Mount v1 (only)
try {
  await app.register(v1);
  app.log.info('v1 plugin mounted');
} catch (err) {
  app.log.error({ err }, 'failed_to_mount_v1');
  throw err;
}

/* =========================
   Conversation worker boot
   ========================= */
try {
  app.log.info(
    {
      CONVO_ENABLED,
      RUN_WORKERS,
      CONVO_SCAN_ON_BOOT,
      CONVO_SCAN_INTERVAL_MS,
      WHATSAPP_ENABLED,
      WHATSAPP_ENV_AVAILABLE,
    },
    '[conversation] flags_snapshot'
  );

  if (!CONVO_ENABLED) {
    app.log.info('[conversation] disabled via CONVO_ENABLED=0');
  } else {
    // Install worker (it internally checks RUN_WORKERS)
    const apiDb = (app as any).db;
    const convApi = conversation.installConversationWorker(apiDb, app.log);
    (app as any).conversation = convApi;

    if (!RUN_WORKERS) {
      app.log.warn(
        '[conversation] RUN_WORKERS is false; worker installed in noop mode. Remove RUN_WORKERS from .env or set RUN_WORKERS=1 for dev.'
      );
    } else {
      // Wait for BullMQ queue ready then schedule scans
      const ready = await waitConvoReady(2500);
      if (!ready) {
        app.log.warn('[conversation] queue not ready within timeout, continuing…');
      }

      if (CONVO_SCAN_ON_BOOT) {
        await addScanJob('boot');
        app.log.info('[conversation] boot scan enqueued');
      }

      await scheduleRecurringScan(CONVO_SCAN_INTERVAL_MS);
      app.log.info(
        { every_ms: CONVO_SCAN_INTERVAL_MS },
        '[conversation] recurring scan scheduled'
      );
    }
  }
} catch (err: any) {
  app.log.error({ err }, '[conversation] failed_to_boot_worker');
}

// 404 handler
app.setNotFoundHandler((req, reply) =>
  reply.code(404).send({
    ok: false,
    error: 'route_not_found',
    message: `No route ${req.method} ${req.url}`,
    hint: 'See /api/v1/__routes',
  }),
);

// Startup
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '0.0.0.0';

app
  .listen({ port, host })
  .then(() => app.log.info(`API listening on http://${host}:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

export default app;
