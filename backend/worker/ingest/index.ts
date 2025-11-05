// backend/src/worker/ingest/index.ts
import 'dotenv/config';
import knex from 'knex';
import pino from 'pino';

import { installIngestWorker } from '../ingest';
import {
  INGEST_ENABLED,
  SCAN_ON_BOOT,
  SCAN_INTERVAL_MS,
  RUN_WORKERS,
} from '../../utils/flags';

// DB (Knex) — requires DATABASE_URL
const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: Number(process.env.DB_POOL_MAX || 10) },
  searchPath: ['public'],
});

// Logger
const logger = pino({ name: 'ingest', level: process.env.LOG_LEVEL || 'info' });

(async () => {
  console.log('[ingest] booting…', {
    NODE_ENV: process.env.NODE_ENV,
    RUN_WORKERS,
    INGEST_ENABLED,
    SCAN_ON_BOOT,
    SCAN_INTERVAL_MS,
  });

  if (!RUN_WORKERS || !INGEST_ENABLED) {
    console.log('[ingest] worker disabled by flags');
    return;
  }

  // ✅ Pass db + logger
  await installIngestWorker(db, logger);

  console.log('[ingest] worker ready');
})().catch((err) => {
  console.error('[ingest] fatal error during boot:', err);
  process.exit(1);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    try { await db.destroy(); } catch {}
    process.exit(0);
  });
}
