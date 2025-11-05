import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { connection, QUEUE_NAMES, addJob } from '../queues/index.js';
import { getDb } from '../db/index.js';
import { toCsvExportUrl, fetchCsvRows, stableRowSignature, idempotencyKey } from '../utils/sheets.js'; // you already have these (you shared earlier)
import { embedText } from '../ai/embeddings.js';
import { insertEmbedding } from '../vector/pgvector.js';
import { normalizeRowLLM } from './normalize.js';

type Tick = { type: 'sheets.tick' };
let worker: Worker<Tick> | null = null;

// Pull all enabled sheets and process new rows
async function pollOnce() {
  const db = getDb()!;
  const sheets = await db('store_sheets')
    .select('id','store_id','seller_id','gsheet_url','sheet_tab','enabled','last_processed_row')
    .where({ enabled: true })
    .orderBy('updated_at','desc')
    .catch(() => []);

  for (const sh of sheets) {
    const url = toCsvExportUrl(sh.gsheet_url);
    let rows: Record<string,string>[];
    try {
      rows = await fetchCsvRows(url);
    } catch (e) {
      console.error(`[sheets] fetch failed for ${sh.id}:`, (e as any)?.message);
      continue;
    }

    // Simple header-based detection of a unique key if present
    const hasRef = ['order_id','id','reference','ref','Order ID','ExternalKey']
      .find(k => k in (rows[0] || {}));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1 for header, so rows start at 2
      const sig = stableRowSignature(row);
      const idem = idempotencyKey(sh.id, rowNum, sig);

      // Skip if we saw this exact version
      const exists = await db('ingestion_audit').where({ idempotency_key: idem }).first();
      if (exists) continue;

      // Persist in audit (idempotent)
      await db('ingestion_audit').insert({
        store_sheet_id: sh.id,
        run_id: `tick-${Date.now()}`,
        row_number: rowNum,
        external_row_id: hasRef ? String((row as any)[hasRef]) : null,
        status: 'success',
        error: null,
        idempotency_key: idem
      }).catch(() => {});

      // Save raw row snapshot
      const [raw] = await db('sheet_rows_raw')
        .insert({
          store_sheet_id: sh.id,
          row_number: rowNum,
          row_json: row,
          row_signature: sig,
          idempotency_key: idem,
        })
        .returning('*');

      // Create a compact text view for embedding
      const textView = Object.entries(row)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n');

      // Embed + index
      try {
        const vec = await embedText(textView);
        await insertEmbedding(db, raw.id, vec);
      } catch (e) {
        console.warn(`[sheets] embed failed row ${raw.id}:`, (e as any)?.message);
      }

      // Normalize -> orders & items
      const store = await db('stores').select('name').where({ id: sh.store_id }).first();
      const norm = await normalizeRowLLM(row, { storeName: store?.name });

      const external_key = norm.external_key || `${sh.id}:${rowNum}`;
      // Upsert customer (by phone/email if present)
      let customer_id: string | null = null;
      if (norm.customer?.phone || norm.customer?.email) {
        const contactWhere: any = { store_id: sh.store_id };
        if (norm.customer.phone) contactWhere.phone = norm.customer.phone;
        if (norm.customer.email) contactWhere.email = norm.customer.email;

        const existing = await db('customers').where(contactWhere).first();
        if (existing) {
          customer_id = existing.id;
        } else {
          const [c] = await db('customers')
            .insert({
              store_id: sh.store_id,
              email: norm.customer?.email ?? null,
              phone: norm.customer?.phone ?? null,
              name: norm.customer?.name ?? null,
              meta_json: {}
            })
            .returning('*');
          customer_id = c.id;
        }
      }

      // Upsert order by (store_id, external_key)
      const now = new Date();
      const existingOrder = await db('orders')
        .where({ store_id: sh.store_id, external_key })
        .first();

      let order: any;
      if (existingOrder) {
        [order] = await db('orders')
          .where({ id: existingOrder.id })
          .update({
            raw_payload_json: row,
            customer_id,
            updated_at: now
          })
          .returning('*');
      } else {
        [order] = await db('orders')
          .insert({
            store_id: sh.store_id,
            external_key,
            status: 'new',
            raw_payload_json: row,
            customer_id,
            created_at: now,
            updated_at: now
          })
          .returning('*');
      }

      // Items: simple replace to keep idempotence (or match by SKU)
      if (order) {
        await db('order_items').where({ order_id: order.id }).delete().catch(() => {});
        for (const it of norm.items) {
          await db('order_items').insert({
            order_id: order.id,
            product_id: null,
            sku: it.sku ?? null,
            qty: it.qty ?? 1,
            price: typeof it.price === 'number' ? it.price : null,
            meta_json: { title: it.title ?? null, currency: it.currency ?? norm.currency ?? null }
          }).catch(() => {});
        }

        // Emit event for downstream workers (e.g., AI/notifications)
        await addJob('ordersNew', 'sheet.order.upserted', {
          order_id: order.id,
          store_id: sh.store_id,
          external_key
        }).catch(() => {});
      }
    }

    // Move the cursor forward naïvely (optional)
    // Better: compute max rowNumber seen & persist; we keep the audit/idempotency anyway.
    await db('store_sheets')
      .where({ id: sh.id })
      .update({ updated_at: new Date() })
      .catch(() => {});
  }
}

async function handleTick(_job: Job<Tick>) {
  await pollOnce();
}

export function startSheetsIngestor() {
  if (worker) return worker;
  const concurrency = 1; // single poller is fine; inner loops are parallel-ish
  worker = new Worker<Tick>(
    QUEUE_NAMES.WORKFLOW_CONTROL,
    async (job) => {
      if (job.data.type === 'sheets.tick') return handleTick(job);
      throw new Error(`unsupported job ${job.name}`);
    },
    { connection, concurrency }
  );
  worker.on('completed', (j) => console.log('[sheetsIngestor] tick completed', j.id));
  worker.on('failed', (j, e) => console.error('[sheetsIngestor] failed', j?.id, e?.message));
  console.log('[sheetsIngestor] started');
  return worker;
}

// helper to schedule ticks from your main heartbeat
export async function scheduleSheetsTick() {
  await addJob('workflowControl', 'sheets.tick', { type: 'sheets.tick' }, { removeOnComplete: 100 });
}
