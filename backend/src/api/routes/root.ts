// src/api/routes/root.ts
import type { FastifyInstance, FastifyReply } from 'fastify';

export default async function root(app: FastifyInstance) {
  // --- Basic service info (lightweight) ---
  app.get('/', async () => ({
    ok: true,
    name: 'ittri-backend',
    mode: process.env.MODE ?? 'all',
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? 'dev',
    time: new Date().toISOString(),
  }));

  // Stable info endpoint (same content as '/', but explicit path)
  app.get('/info', async () => ({
    ok: true,
    name: 'ittri-backend',
    mode: process.env.MODE ?? 'all',
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? 'dev',
    time: new Date().toISOString(),
  }));

  // --- Health endpoints (scoped under /api/v1) ---
  // NOTE: This does not conflict with server.ts' top-level /healthz
  app.head('/healthz', async (_req, reply: FastifyReply) => reply.code(204).send());

  app.get('/healthz', async (req, reply) => {
    const db: any = (app as any).db;
    const redis: any = (app as any).redis; // if you attach redis on app elsewhere

    // Defaults
    let dbOk = false;
    let redisOk = true; // treat as optional unless present

    // DB check (best-effort, fast)
    try {
      if (db?.raw) {
        await db.raw('select 1');
        dbOk = true;
      }
    } catch {
      dbOk = false;
    }

    // Redis check (optional)
    try {
      if (redis?.ping) {
        const pong = await redis.ping();
        redisOk = pong === 'PONG' || pong === 'OK' || pong === true;
      }
    } catch {
      redisOk = false;
    }

    const ok = dbOk && redisOk;
    const body = {
      ok,
      checks: {
        db: dbOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
      },
      time: new Date().toISOString(),
      // helpful for routing diagnostics
      instance: {
        pid: process.pid,
        host: process.env.HOST || '0.0.0.0',
        port: Number(process.env.PORT || 8000),
      },
    };

    // If anything is down, return 503 to signal probes
    return reply.code(ok ? 200 : 503).send(body);
  });
}
