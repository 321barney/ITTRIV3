// src/utils/worker-bus-ingest.ts
import { Queue, Worker, QueueEvents, JobsOptions, WorkerOptions } from 'bullmq';
import { bullConnection, isRedisEnabled } from './redis';

/* ----------------------------- Job type shapes ----------------------------- */

export type IngestSource =
  | { type: 'upload'; path: string; originalName?: string; contentType?: string }
  | { type: 'url'; url: string; filenameHint?: string; contentType?: string };

export type IngestMapping = {
  entity: 'products' | 'orders';
  uniqueKey?: string;
  fields?: Record<string, string | string[]>;
  maxRows?: number;
  dryRun?: boolean;
  validateOnly?: boolean;
};

export type IngestJob = {
  kind: 'ingest';
  store_id: string;
  seller_id?: string;
  source?: IngestSource;
  mapping?: IngestMapping;
  start_at?: number;
};

export type ScanJob = {
  kind: 'scan';
  label?: string;
};

export type AnyJob = IngestJob | ScanJob;

/* --------------------------------- Queue ---------------------------------- */

let _queue: Queue<AnyJob> | null = null;

function _getQueue(): Queue<AnyJob> {
  if (!isRedisEnabled()) {
    throw new Error('Redis disabled (REDIS_ENABLED=false) — queue unavailable');
  }
  if (_queue) return _queue;
  _queue = new Queue<AnyJob>('ingest', bullConnection!);
  return _queue;
}

/** Re-exposed for routes that want to do health checks etc. */
export function getIngestQueue(): Queue<AnyJob> {
  return _getQueue();
}

function safeId(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
}

export async function addIngestJob(job: IngestJob, opts: JobsOptions = {}) {
  const q = _getQueue();
  const id = safeId(`ingest_${job.store_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  return q.add('ingest.run', job, {
    jobId: id,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
    ...opts,
  });
}

export async function addScanJob(label = 'scan') {
  const q = _getQueue();
  return q.add(label === 'boot' ? 'scan_boot' : `scan_${Date.now()}`, { kind: 'scan', label }, {
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}

export async function scheduleRecurringScan(everyMs: number) {
  const q = _getQueue();
  await q.add('scan', { kind: 'scan', label: 'interval' }, {
    repeat: { every: Math.max(15_000, everyMs) },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/** Wait briefly until any ingest queue activity shows up (best-effort). */
export async function waitIngestReady(ms = 500): Promise<void> {
  if (!isRedisEnabled()) return;
  try {
    const ev = new QueueEvents('ingest', bullConnection!);
    await Promise.race([
      new Promise<void>((resolve) => {
        ev.on('waiting', resolve);
        ev.on('active', resolve);
        ev.on('completed', resolve);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ]);
    await ev.close();
  } catch {
    /* noop */
  }
}

/* -------------------------------- Worker ---------------------------------- */

let _worker: Worker<AnyJob> | null = null;

/**
 * Start one in-process worker for both "scan*" and "ingest.run".
 * Safe when RUN_WORKERS/Redis disabled — it will no-op.
 */
export function ensureInProcessIngestWorker(
  ingestProcessor: (job: IngestJob) => Promise<void>,
  scanProcessor?: (name: string, data: ScanJob) => Promise<void>,
) {
  const run = (process.env.RUN_WORKERS ?? '1') !== '0' && (process.env.RUN_WORKERS ?? '1') !== 'false';
  if (!run) return null;
  if (!isRedisEnabled()) {
    console.log('[ingest] Redis disabled; worker not started');
    return null;
  }
  if (_worker) return _worker;

  const CONCURRENCY = Math.max(1, Number(process.env.INGEST_CONCURRENCY || '2'));

  const workerOpts: WorkerOptions = {
    ...(bullConnection as WorkerOptions), // provides { connection }
    concurrency: CONCURRENCY,
  };

  _worker = new Worker<AnyJob>(
    'ingest',
    async (job) => {
      if (job.name === 'ingest.run') {
        await ingestProcessor(job.data as IngestJob);
        return;
      }
      if (job.name.startsWith('scan') && scanProcessor) {
        await scanProcessor(job.name, job.data as ScanJob);
      }
    },
    workerOpts
  );

  const ev = new QueueEvents('ingest', bullConnection!);
  ev.on('waiting',   (e) => console.log('[ingest] waiting', e.jobId));
  ev.on('active',    (e) => console.log('[ingest] active', e.jobId, e.prev ?? 'waiting'));
  ev.on('completed', (e) => console.log('[ingest] done', e.jobId));
  ev.on('failed',    (e) => console.error('[ingest] failed', e.jobId, e.failedReason));
  ev.on('error',     (e) => console.error('[ingest] error', e));

  const shutdown = async () => {
    try { await _worker?.close(); } catch {}
    try { await ev?.close(); } catch {}
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return _worker;
}

/* ------------------------------- Default export --------------------------- */

export default {
  getIngestQueue,
  addIngestJob,
  addScanJob,
  scheduleRecurringScan,
  waitIngestReady,
  ensureInProcessIngestWorker,
};
