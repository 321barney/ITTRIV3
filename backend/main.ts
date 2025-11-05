// src/main.ts
import 'dotenv/config';

import { startApi } from './api/server';
import { initializeDatabase, closeDb, getDb } from './db/index.js';
import { ensureReady as ensureLLMReady } from './ai/llm';

import {
  INGEST_ENABLED,
  CONVO_ENABLED,
  WHATSAPP_ENABLED,
  WHATSAPP_ENV_AVAILABLE,
} from './utils/flags';

import { installIngestWorker } from './worker/ingest';
import { waitIngestReady } from './utils/worker-bus-ingest';

import { installConversationWorker } from './worker/conversation';
import { waitConvoReady } from './utils/worker-bus-conversation';

type MaybeFn = ((...a: any[]) => any) | null;

const RAW_MODE = (process.env.MODE || 'all').toLowerCase();
const MODE = RAW_MODE === 'workers' ? 'worker' : RAW_MODE; // compat: "workers" → "worker"

async function tryImport<T = any>(p: string): Promise<T | null> {
  try {
    const m = await import(p);
    return ((m as any)?.default ?? m) as T;
  } catch {
    return null;
  }
}

async function ensureDbUpToDate() {
  const db = await initializeDatabase(console);
  if (!db) throw new Error('Database failed to initialize');

  try { await (db as any).raw?.('SET search_path = app, public'); } catch {}

  // Try to run Knex migrations if present (idempotent)
  const knexLib = await tryImport<any>('knex');
  const knexfile =
    (await tryImport<any>('../knexfile.ts')) ??
    (await tryImport<any>('../knexfile.mjs'));

  if (knexLib && knexfile) {
    const env = process.env.NODE_ENV || 'development';
    const cfg = (knexfile as any)[env] ?? knexfile;
    const kx = knexLib.knex ? knexLib.knex(cfg) : knexLib(cfg);
    try {
      await kx.raw('set search_path = app, public');
      await kx.raw('select 1');
      if (typeof kx.migrate?.latest === 'function') {
        await kx.migrate.latest();
      }
    } finally {
      await kx.destroy().catch(() => {});
    }
  }

  // Optional: pgvector bootstrap if available
  const vector = await tryImport<any>('./vector/index.js');
  if (vector?.ensurePgVector) {
    try { await vector.ensurePgVector(); } catch {}
  }
}

/* ────────────────────────────────────────────────────────────
   Ingest worker (non-blocking start)
   ──────────────────────────────────────────────────────────── */
async function startIngestWorker() {
  if (!INGEST_ENABLED) {
    console.log('[worker] ingest disabled (INGEST_ENABLED=false)');
    return;
  }
  console.log('[worker] starting ingest…');

  try {
    const db = getDb?.() ?? null;
    if (!db) {
      console.warn('[worker] ingest: no DB handle available');
      return;
    }

    const log = {
      info: (...a: any[]) => console.log('[ingest]', ...a),
      warn: (...a: any[]) => console.warn('[ingest]', ...a),
      error: (...a: any[]) => console.error('[ingest]', ...a),
    } as any;

    installIngestWorker(db, log);
    await waitIngestReady(600); // brief readiness wait
    console.log('[worker] ingest launch initiated (non-blocking)');
  } catch (e: any) {
    console.warn('[worker] ingest start failed (continuing):', e?.message ?? String(e));
  }
}

/* ────────────────────────────────────────────────────────────
   Conversation worker (non-blocking start)
   ──────────────────────────────────────────────────────────── */
async function startConversationWorker() {
  if (!CONVO_ENABLED) {
    console.log('[worker] conversation disabled (CONVO_ENABLED=false)');
    return;
  }
  console.log('[worker] starting conversation…');

  try {
    const db = getDb?.() ?? null;
    if (!db) {
      console.warn('[worker] conversation: no DB handle available');
      return;
    }

    const log = {
      info: (...a: any[]) => console.log('[conversation]', ...a),
      warn: (...a: any[]) => console.warn('[conversation]', ...a),
      error: (...a: any[]) => console.error('[conversation]', ...a),
    } as any;

    installConversationWorker(db, log);
    await waitConvoReady(600); // brief readiness wait
    console.log('[worker] conversation launch initiated (non-blocking)');
  } catch (e: any) {
    console.warn('[worker] conversation start failed (continuing):', e?.message ?? String(e));
  }
}

/* ────────────────────────────────────────────────────────────
   Start both workers together
   ──────────────────────────────────────────────────────────── */
async function startWorkersBundle() {
  console.log('[workers] bundle: init');
  await Promise.allSettled([startIngestWorker(), startConversationWorker()]);
  console.log('[workers] bundle: launched');
}

/* ────────────────────────────────────────────────────────────
   Shutdown
   ──────────────────────────────────────────────────────────── */
async function shutdown(sig?: string) {
  try {
    console.info('Shutting down…', sig ?? '');
    await closeDb().catch(() => {});
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('UnhandledRejection:', reason));

/* ────────────────────────────────────────────────────────────
   Main
   ──────────────────────────────────────────────────────────── */
async function main() {
  console.log('[main] MODE:', MODE, '| NODE_ENV:', process.env.NODE_ENV ?? 'development');
  console.log('[main] flags:', {
    INGEST_ENABLED,
    CONVO_ENABLED,
    WHATSAPP_ENABLED,
    WHATSAPP_ENV_AVAILABLE,
  });

  try { await ensureLLMReady(); }
  catch (e) { console.warn('LLM bootstrap skipped/failed (continuing):', (e as any)?.message ?? e); }

  await ensureDbUpToDate();

  if (MODE === 'api') {
    // API-only (workers not started here)
    await startApi();
  } else if (MODE === 'worker') {
    // Worker-only
    await startWorkersBundle();
    // Keep process alive
    setInterval(() => {}, 1 << 30);
  } else {
    // MODE === 'all' → start API AND workers in the same process
    // (Your server.ts does NOT install conversation workers, so we start them here)
    const apiStarted = startApi();
    await startWorkersBundle();
    await apiStarted;
  }

  console.log('✔ Boot complete');
}

main().catch((e) => {
  console.error('Fatal boot error:', e);
  closeDb().finally(() => process.exit(1));
});
