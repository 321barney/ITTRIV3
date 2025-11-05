import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { addIngestJob, getIngestQueue } from '../../utils/worker-bus-ingest';
import { INGEST_ACCEPT_UPLOAD, INGEST_ACCEPT_URL } from '../../utils/flags';
import { getLastRedisError } from '../../utils/redis';
import { installIngestWorker } from '../../worker/ingest';

type KickUrlBody = {
  storeId?: string;
  entity?: 'products' | 'orders';
  source?: { type: 'url'; url: string; filenameHint?: string; contentType?: string };
  mapping?: {
    entity?: 'products' | 'orders';
    uniqueKey?: string;
    fields?: Record<string, string | string[]>;
    maxRows?: number;
    dryRun?: boolean;
  };
};

export default fp(async function registerWorkerIngest(app: FastifyInstance) {
  const db: any =
    (app as any).db?.raw ? (app as any).db : (app as any).db?.knex ?? (app as any).db;

  await app.register(multipart);

  // Install the ingest worker here ONLY if explicitly enabled.
  const RUN_WORKERS = String(process.env.RUN_WORKERS).toLowerCase() === 'true';
  if (RUN_WORKERS) {
    app.log.info({ RUN_WORKERS }, 'ingest_worker_enabled_in_api');
    installIngestWorker(db, app.log);
  } else {
    app.log.info({ RUN_WORKERS }, 'ingest_worker_skipped_in_api');
  }

  // Health
  app.get('/api/v1/worker/ingest/health', { preHandler: app.requireAuth! }, async () => {
    try {
      const q = getIngestQueue();
      const counts = await q.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused'
      );
      return {
        ok: true,
        queue: { name: q.name, ...counts },
        run_workers_in_api: RUN_WORKERS,
        last_redis_error: getLastRedisError(),
      };
    } catch (e: any) {
      return {
        ok: false,
        error: 'queue_unavailable',
        detail: String(e?.message || e),
        run_workers_in_api: RUN_WORKERS,
        last_redis_error: getLastRedisError(),
      };
    }
  });

  // Warm (no-op for now; just returns ok)
  app.get('/api/v1/worker/ingest/warm', { preHandler: app.requireAuth! }, async () => ({
    ok: true,
    warmed: true,
  }));

  // Kick via URL (JSON)
  app.post(
    '/api/v1/worker/ingest/kick',
    { preHandler: app.requireAuth! },
    async (req: FastifyRequest<{ Body: KickUrlBody }>, reply: FastifyReply) => {
      if (!INGEST_ACCEPT_URL)
        return reply.code(403).send({ ok: false, error: 'ingest_url_disabled' });

      const user: any = (req as any).user || {};
      const seller_id: string = user.id || user.sub;
      if (!seller_id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

      const body = (req.body || {}) as KickUrlBody;
      const entity = body.entity || body.mapping?.entity || 'products';

      // resolve store
      const store = body.storeId
        ? await db('public.stores').where({ id: body.storeId, seller_id }).first()
        : await db('public.stores').where({ seller_id }).first();
      if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });

      if (!body.source || body.source.type !== 'url' || !body.source.url) {
        return reply.code(400).send({ ok: false, error: 'missing_source_url' });
      }

      const job = await addIngestJob({
        kind: 'ingest',
        store_id: store.id,
        seller_id,
        source: {
          type: 'url',
          url: body.source.url,
          filenameHint: body.source.filenameHint,
          contentType: body.source.contentType,
        },
        mapping: { entity, ...(body.mapping || {}) },
      });

      return reply.send({ ok: true, jobId: job.id, store_id: store.id, entity, source: 'url' });
    }
  );

  // Kick via upload (multipart/form-data; field "file")
  app.post(
    '/api/v1/worker/ingest/upload',
    { preHandler: app.requireAuth! },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!INGEST_ACCEPT_UPLOAD)
        return reply.code(403).send({ ok: false, error: 'ingest_upload_disabled' });

      const user: any = (req as any).user || {};
      const seller_id: string = user.id || user.sub;
      if (!seller_id) return reply.code(401).send({ ok: false, error: 'unauthorized' });

      // parse multipart
      const parts = req.parts();
      let filePart: any = null;
      let entity: 'products' | 'orders' = 'products';
      let storeId: string | undefined;
      let mappingJson: any;

      for await (const p of parts) {
        if (p.type === 'file' && p.fieldname === 'file') {
          filePart = p;
        } else if (p.type === 'field' && p.fieldname === 'entity') {
          entity = p.value === 'orders' ? 'orders' : 'products';
        } else if (p.type === 'field' && p.fieldname === 'storeId') {
          storeId = p.value;
        } else if (p.type === 'field' && p.fieldname === 'mapping') {
          try {
            mappingJson = JSON.parse(p.value);
          } catch {
            /* ignore */
          }
        }
      }

      if (!filePart) return reply.code(400).send({ ok: false, error: 'missing_file' });

      const store = storeId
        ? await db('public.stores').where({ id: storeId, seller_id }).first()
        : await db('public.stores').where({ seller_id }).first();
      if (!store) return reply.code(404).send({ ok: false, error: 'store_not_found' });

      // save file to tmp
      const tmpDir = path.join(process.cwd(), 'tmp', 'ingest');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ext = path.extname(filePart.filename || '') || '';
      const tmpPath = path.join(tmpDir, `${randomUUID()}${ext}`);
      const ws = fs.createWriteStream(tmpPath);
      await filePart.file.pipe(ws);
      await new Promise((r) => ws.on('finish', r));

      const job = await addIngestJob({
        kind: 'ingest',
        store_id: store.id,
        seller_id,
        source: {
          type: 'upload',
          path: tmpPath,
          originalName: filePart.filename,
          contentType: filePart.mimetype,
        },
        mapping: { entity, ...(mappingJson || {}) },
      });

      return reply.send({ ok: true, jobId: job.id, store_id: store.id, entity, source: 'upload' });
    }
  );
});
