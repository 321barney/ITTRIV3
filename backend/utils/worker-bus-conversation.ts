import { Queue, Worker, QueueEvents, JobsOptions, WorkerOptions, Job } from 'bullmq';
import { bullConnection, isRedisEnabled } from './redis';

export type ConvoJob =
  | { kind: 'scan'; label?: string }
  | { kind: 'init'; order_id: string; store_id: string }
  | { kind: 'incoming'; conversation_id: string; store_id: string; from: string; text?: string; payload?: any }
  | { kind: 'followup'; conversation_id: string };

type AnyJob = ConvoJob;

/**
 * Handler return contract:
 * - 'remove' | true  → explicitly remove this job after successful handling
 * - 'keep' | false | void → keep the job record (no auto-removal)
 */
export type ConvoHandlerResult = 'remove' | 'keep' | boolean | void;

let _queue: Queue<AnyJob> | null = null;
let _worker: Worker<AnyJob> | null = null;
let _events: QueueEvents | null = null;

function _getQueue(): Queue<AnyJob> {
  if (_queue) return _queue;
  if (!isRedisEnabled()) {
    throw new Error('[conversation] Redis is not enabled. Set REDIS_URL or related env.');
  }
  _queue = new Queue<AnyJob>('conversation', { ...(bullConnection as any) });
  _events = new QueueEvents('conversation', { ...(bullConnection as any) });
  return _queue;
}

export function getConversationQueue() {
  return _getQueue();
}

function safeId(s: string) { return s.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120); }

// KEEP convo jobs by default. Worker will call job.remove() only on clear outcome.
export async function addConvoJob(job: Extract<AnyJob, { kind: 'init' }>, opts: JobsOptions = {}) {
  const q = _getQueue();
  const id = safeId(`convo_${job.store_id}_${job.order_id}`);
  return q.add('conversation.init', job, {
    jobId: id,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: false,
    removeOnFail: false,
    ...opts,
  });
}

export async function addIncomingJob(job: Extract<AnyJob, { kind: 'incoming' }>, opts: JobsOptions = {}) {
  const q = _getQueue();
  const id = safeId(`incoming_${job.store_id}_${job.conversation_id}_${Date.now()}`);
  return q.add('conversation.incoming', job, {
    jobId: id,
    attempts: 2,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: false,
    removeOnFail: false,
    ...opts,
  });
}

export async function addFollowupJob(job: Extract<AnyJob, { kind: 'followup' }>, opts: JobsOptions = {}) {
  const q = _getQueue();
  const id = safeId(`followup_${job.store_id}_${job.conversation_id}_${Date.now()}`);
  return q.add('conversation.followup', job, {
    jobId: id,
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: false,
    removeOnFail: false,
    ...opts,
  });
}

// SCAN jobs: dedupe boot; repeat is idempotent and starts after the first interval
export async function addScanJob(label = 'scan') {
  const q = _getQueue();
  const name = label === 'boot' ? 'scan_boot' : `scan_${Date.now()}`;

  const opts: JobsOptions =
    label === 'boot'
      ? { jobId: 'scan_boot_once', removeOnComplete: 50, removeOnFail: 50 }
      : { removeOnComplete: 50, removeOnFail: 50 };

  try {
    return await q.add(name, { kind: 'scan', label }, opts);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (label === 'boot' && /jobId.*exists/i.test(msg)) return null as any;
    throw e;
  }
}

export async function scheduleRecurringScan(everyMs: number) {
  const q = _getQueue();
  const interval = Math.max(15_000, everyMs);
  const jobId = `scan_repeat_every_${interval}`;
  const startDate = Date.now() + interval; // avoid double-run at boot

  try {
    await q.add(
      'scan',
      { kind: 'scan', label: 'interval' },
      {
        jobId,                      // idempotent across restarts
        repeat: { every: interval, startDate },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/jobId.*exists/i.test(msg)) return; // already scheduled
    throw e;
  }
}

/** Remove any legacy repeatable 'scan' jobs and keep only our canonical one. */
export async function ensureSingleRepeatScan(everyMs: number) {
  const q = _getQueue();
  const jobs = await q.getRepeatableJobs();
  for (const j of jobs) {
    if (j.name === 'scan') {
      try { await q.removeRepeatableByKey(j.key); } catch {}
    }
  }
  await scheduleRecurringScan(everyMs);
}

/** Robust readiness: QueueEvents + Redis poll to avoid false negatives. */
export async function waitConvoReady(timeoutMs = 10000): Promise<boolean> {
  try {
    if (!_events || !_queue) _getQueue();
    const qe = _events!;
    const q = _queue!;

    // Fast path
    try { await q.getJobCounts(); return true; } catch {}

    const start = Date.now();
    let resolved = false;

    const eventPromise = new Promise<void>((resolve) => {
      const onReady = () => {
        qe.off('ready', onReady);
        resolved = true;
        resolve();
      };
      qe.on('ready', onReady);
    });

    const pollPromise = (async () => {
      while (Date.now() - start < timeoutMs && !resolved) {
        try { await q.getJobCounts(); resolved = true; return; } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    );

    await Promise.race([eventPromise, pollPromise, timeoutPromise]);
    return true;
  } catch {
    return false;
  }
}

export function ensureInProcessConversationWorker(
  handler: (job: AnyJob) => Promise<ConvoHandlerResult>,
  opts: WorkerOptions = {}
): Worker<AnyJob> {
  if (!isRedisEnabled()) throw new Error('[conversation] Redis not configured');
  if (_worker) return _worker;

  const CONCURRENCY = Math.max(1, Number(process.env.CONVO_CONCURRENCY || '6'));

  const workerOpts: WorkerOptions = {
    ...(bullConnection as WorkerOptions),
    concurrency: CONCURRENCY,
    ...opts,
  };

  _worker = new Worker<AnyJob>('conversation', async (job: Job<AnyJob>) => {
    if (job.name.startsWith('scan')) {
      await handler({ kind: 'scan', label: job.name });
      try { await job.remove(); } catch {}
      return;
    }
    const data: AnyJob = job.data as AnyJob;
    const decision = await handler(data);
    if (decision === 'remove' || decision === true) {
      try { await job.remove(); } catch {}
    }
    // otherwise keep job record
  }, workerOpts);

  return _worker;
}

export default {
  getConversationQueue,
  addConvoJob,
  addIncomingJob,
  addFollowupJob,
  addScanJob,
  scheduleRecurringScan,
  ensureSingleRepeatScan,
  waitConvoReady,
  ensureInProcessConversationWorker,
};
