import '../../utils/hush-tty'; // prevent TTY EIO crashes during watch restarts
import 'dotenv/config';
import knex from 'knex';
import pino from 'pino';

import { installConversationWorker } from '../conversation';
import { CONVO_ENABLED, CONVO_SCAN_ON_BOOT, CONVO_SCAN_INTERVAL_MS } from '../../utils/flags';
import { addScanJob, ensureSingleRepeatScan, waitConvoReady } from '../../utils/worker-bus-conversation';

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 3 },
});

async function waitAndLogQueueReady(log: pino.Logger) {
  const ok = await waitConvoReady(12000);
  log.info({ name: 'conversation-worker', ready: ok }, 'conversation_queue_ready');
}

(async () => {
  const log = pino({ name: 'conversation-worker', level: process.env.LOG_LEVEL || 'info' });

  installConversationWorker(db as any, log as any);

  if (!CONVO_ENABLED) {
    log.info('conversation worker disabled via env');
    return;
  }

  await waitAndLogQueueReady(log);

  // Single boot scan (idempotent)
  if (CONVO_SCAN_ON_BOOT) {
    await addScanJob('boot');
  }

  // Ensure only ONE repeat scan exists (and delay the first tick by one interval)
  if (CONVO_SCAN_INTERVAL_MS > 0) {
    await ensureSingleRepeatScan(CONVO_SCAN_INTERVAL_MS);
  }

  // One clean human-readable line after scheduling is settled
  console.log('[conversation] worker ready');
})().catch((err) => {
  console.error('[conversation] fatal error during boot:', err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    try { await db.destroy(); } catch {}
    process.exit(0);
  });
}
