#!/usr/bin/env node
/**
 * Metrics Worker
 *  - Rebuilds app.metrics_daily from truth tables (orders, conversations)
 *  - Respects RLS by calling set_current_seller() per seller
 *
 * Usage examples:
 *   node workers/metrics.worker.js                         # last 30d for all sellers
 *   node workers/metrics.worker.js --days 7                # last 7d
 *   node workers/metrics.worker.js --seller <uuid>         # single seller
 *   node workers/metrics.worker.js --from 2025-09-01 --to 2025-09-30
 *   node workers/metrics.worker.js --full                  # 365d backfill for all sellers
 *
 * Env:
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 *   (optional) WORKER_CONCURRENCY=4
 */

const { Client, Pool } = require("pg");

function parseArgs(argv) {
  const args = { days: 30, full: false, seller: null, from: null, to: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") args.days = Number(argv[++i] || 30);
    else if (a === "--full") args.full = true;
    else if (a === "--seller") args.seller = String(argv[++i] || "");
    else if (a === "--from") args.from = String(argv[++i] || "");
    else if (a === "--to") args.to = String(argv[++i] || "");
  }
  return args;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRangeFromArgs(args) {
  if (args.from && args.to) {
    return { from: args.from, to: args.to };
  }
  const to = new Date();
  const days = args.full ? 365 : Math.max(1, Number(args.days || 30));
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  return { from: isoDate(from), to: isoDate(to) };
}

async function listSellers(pool, onlyId) {
  if (onlyId) {
    return [{ id: onlyId }];
  }
  const { rows } = await pool.query(`
    SELECT id
    FROM app.sellers
    WHERE locked_at IS NULL
    ORDER BY created_at ASC
  `);
  return rows;
}

async function rebuildForSeller(pool, sellerId, fromISO, toISO) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Set RLS context so deletes/inserts on metrics_daily pass policies
    await client.query("SELECT app.set_current_seller($1)", [sellerId]);

    // Call your reconciliation function
    const { rows } = await client.query(
      "SELECT app.rebuild_metrics_range($1, $2::date, $3::date) AS upserts",
      [sellerId, fromISO, toISO]
    );
    const upserts = Number(rows?.[0]?.upserts || 0);

    // Clear seller context
    await client.query("SELECT app.set_current_seller(NULL)");
    await client.query("COMMIT");
    return upserts;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    // Attach seller id for logs
    err._seller = sellerId;
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const range = dateRangeFromArgs(args);
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 2));

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL env var is required.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    application_name: "metrics-worker",
    max: Math.max(concurrency, 2),
  });

  console.log(
    `[metrics-worker] starting | from=${range.from} to=${range.to} ` +
    `seller=${args.seller || "ALL"} full=${args.full} days=${args.days}`
  );

  try {
    const sellers = await listSellers(pool, args.seller);
    if (!sellers.length) {
      console.log("[metrics-worker] no sellers found; exiting.");
      await pool.end();
      return;
    }

    // Simple concurrency control
    let idx = 0;
    let success = 0;
    let totalUpserts = 0;

    async function workerThread(threadId) {
      while (idx < sellers.length) {
        const i = idx++;
        const sellerId = sellers[i].id;
        const t0 = Date.now();
        try {
          const up = await rebuildForSeller(pool, sellerId, range.from, range.to);
          totalUpserts += up;
          success++;
          const ms = Date.now() - t0;
          console.log(
            `[ok] seller=${sellerId} window=${range.from}->${range.to} ` +
            `upserts=${up} time=${ms}ms`
          );
        } catch (e) {
          const ms = Date.now() - t0;
          console.error(
            `[fail] seller=${sellerId} window=${range.from}->${range.to} time=${ms}ms`,
            e.message || e
          );
        }
      }
    }

    const threads = [];
    for (let t = 0; t < concurrency; t++) threads.push(workerThread(t));
    await Promise.all(threads);

    console.log(
      `[metrics-worker] done | sellers=${sellers.length} ok=${success} total_upserts=${totalUpserts}`
    );
  } catch (err) {
    console.error("[metrics-worker] fatal error:", err?.stack || err);
    process.exitCode = 1;
  } finally {
    try { await pool.end(); } catch {}
  }
}

if (require.main === module) {
  main();
}
