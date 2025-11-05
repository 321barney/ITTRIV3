// backend/src/queues/index.ts
import { Queue, QueueOptions, JobsOptions } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

// ---------- Env / helpers ----------
const QUEUE_PREFIX_RAW = process.env.QUEUE_PREFIX ?? process.env.NODE_ENV ?? 'dev';
const QUEUE_PREFIX = String(QUEUE_PREFIX_RAW).replace(/:/g, '-');
const MAX_JOB_PAYLOAD_BYTES = Number(process.env.MAX_JOB_PAYLOAD_BYTES ?? 256 * 1024); // 256KB

function cleanUrl(url?: string): string | undefined {
  if (!url) return url;
  let s = url.replace(/^["']|["']$/g, '').replace(/^%22|%22$/g, '');
  try { s = decodeURIComponent(s); } catch {}
  return s.replace(/^["']|["']$/g, '');
}

// ---------- Redis connection ----------
function createRedisConnection(): any /* Redis client or options */ {
  const redisUrl = cleanUrl(process.env.REDIS_URL);

  if (redisUrl && redisUrl !== 'redis://127.0.0.1:6379') {
    console.log('[queues] Using Redis URL:', redisUrl);
    const Ctor: any = Redis as any;          // avoid construct-signature typing issue
    return new Ctor(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      reconnectOnError: (err: Error) =>
        /READONLY|ECONNRESET|ETIMEDOUT/i.test(err.message) ? 2 : false
    });
  }

  const connection: RedisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false
  };

  console.log('[queues] Using Redis params:', {
    host: connection.host, port: connection.port,
    hasPassword: Boolean(connection.password), db: connection.db
  });
  return connection;
}

export const connection = createRedisConnection();

// ---------- Queue names (NO COLONS) ----------
export const QUEUE_NAMES = {
  ORDERS_NEW: 'orders-new',
  AI_INBOUND: 'ai-inbound',
  AI_OUTBOUND: 'ai-outbound',
  COMMS_OUTBOUND: 'comms-outbound',
  WA_OUTBOUND: 'wa-outbound',
  WORKFLOW_CONTROL: 'workflow-control',
  METRICS: 'metrics',
  TRAINING: 'training',
  N8N_CONTROL: 'n8n-control',
  ITTRI_TASKS: 'ittri-tasks'
} as const;
type QueueNameStr = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function prefixed(name: QueueNameStr): string { return `${QUEUE_PREFIX}-${name}`; }

const defaultOpts: QueueOptions = {
  connection: connection as any,  // BullMQ accepts client or options
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  }
};

export const queues = {
  ordersNew:       new Queue(prefixed(QUEUE_NAMES.ORDERS_NEW), defaultOpts),
  aiInbound:       new Queue(prefixed(QUEUE_NAMES.AI_INBOUND), defaultOpts),
  aiOutbound:      new Queue(prefixed(QUEUE_NAMES.AI_OUTBOUND), defaultOpts),
  commsOutbound:   new Queue(prefixed(QUEUE_NAMES.COMMS_OUTBOUND), defaultOpts),
  waOutbound:      new Queue(prefixed(QUEUE_NAMES.WA_OUTBOUND), defaultOpts),
  workflowControl: new Queue(prefixed(QUEUE_NAMES.WORKFLOW_CONTROL), defaultOpts),
  metrics:         new Queue(prefixed(QUEUE_NAMES.METRICS), defaultOpts),
  training:        new Queue(prefixed(QUEUE_NAMES.TRAINING), defaultOpts),
  n8nControl:      new Queue(prefixed(QUEUE_NAMES.N8N_CONTROL), defaultOpts),
  ittriTasks:      new Queue(prefixed(QUEUE_NAMES.ITTRI_TASKS), defaultOpts),
};

export const queuesByName: Record<string, Queue> = {
  [QUEUE_NAMES.ORDERS_NEW]: queues.ordersNew,
  [QUEUE_NAMES.AI_INBOUND]: queues.aiInbound,
  [QUEUE_NAMES.AI_OUTBOUND]: queues.aiOutbound,
  [QUEUE_NAMES.COMMS_OUTBOUND]: queues.commsOutbound,
  [QUEUE_NAMES.WA_OUTBOUND]: queues.waOutbound,
  [QUEUE_NAMES.WORKFLOW_CONTROL]: queues.workflowControl,
  [QUEUE_NAMES.METRICS]: queues.metrics,
  [QUEUE_NAMES.TRAINING]: queues.training,
  [QUEUE_NAMES.N8N_CONTROL]: queues.n8nControl,
  [QUEUE_NAMES.ITTRI_TASKS]: queues.ittriTasks
};

export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3, backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 10, removeOnFail: 5
};

export async function addJob(
  queueName: keyof typeof queues | string,
  jobType: string,
  payload: any,
  opts: JobsOptions = DEFAULT_JOB_OPTS
) {
  let queue: Queue | undefined;
  if (typeof queueName === 'string' && queueName in queues)
    queue = queues[queueName as keyof typeof queues];
  if (!queue && typeof queueName === 'string' && queueName in queuesByName)
    queue = queuesByName[queueName];
  if (!queue) throw new Error(`Queue "${queueName}" not found.`);

  try {
    const size = Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8');
    if (size > MAX_JOB_PAYLOAD_BYTES)
      throw new Error(`Job payload too large (${size} > ${MAX_JOB_PAYLOAD_BYTES}).`);
  } catch {}
  return queue.add(jobType, payload, opts);
}

export async function getQueueStats() {
  const stats: Record<string, any> = {};
  await Promise.all(Object.entries(queues).map(async ([name, q]) => {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        q.getWaitingCount(), q.getActiveCount(), q.getCompletedCount(),
        q.getFailedCount(), q.getDelayedCount()
      ]);
      stats[name] = { waiting, active, completed, failed, delayed };
    } catch (err: any) {
      console.error(`[queues] Stats error for ${name}:`, err?.message || err);
      stats[name] = { error: String(err?.message || err) };
    }
  }));
  return stats;
}

export async function shutdownQueues() {
  console.log('[queues] Shutting down queues…');
  await Promise.all(Object.values(queues).map(q => q.close().catch(err => {
    console.error('[queues] Error closing queue:', err);
  })));
  const conn: any = connection as any;
  if (conn && typeof conn.quit === 'function') {
    try { await conn.quit(); } catch (err) { console.error('[queues] Error closing Redis:', err); }
  }
  console.log('[queues] Queues shutdown complete');
}

export const bullBoardAdapter = null;
