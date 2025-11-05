// src/worker/ingest.ts
import type { FastifyBaseLogger } from 'fastify';
import { ensureInProcessIngestWorker, IngestJob } from '../utils/worker-bus-ingest';
import { loadBufferFromSource, parseTableAsync as _parseTableAsync } from '../utils/ingest-parse';
import { suggestMapping, applyMapping } from '../utils/ingest-map';
import { toCsvExportUrl, fetchCsvRows, type CsvRow } from '../utils/sheetsCsv';
import { normalizeStatusWithAI } from '../utils/ingest-status-ai';
import {
  FLAGS,
  INGEST_ENABLED,
  SCAN_ON_BOOT,
  SCAN_INTERVAL_MS,
  INGEST_SELF_KICK,
} from '../utils/flags';

type DB = any;
const parseTableAsync = _parseTableAsync;

/* -------------------------------- Config ---------------------------------- */

const CHUNK_SIZE = Number(process.env.INGEST_CHUNK_SIZE || 300);
const LOCK_NS = 424242; // advisory lock "namespace" for ingest

/* ------------------------------ DB helpers -------------------------------- */

async function getEnabledSheetForStore(trx: any, storeId: string) {
  return trx('public.store_sheets')
    .where({ store_id: storeId, enabled: true })
    .orderBy('updated_at', 'desc')
    .first();
}

async function getStoreRow(trx: any, storeId: string) {
  return trx('public.stores').where({ id: storeId }).first();
}

/** Introspect orders columns so we handle schema differences safely */
async function introspectOrdersColumns(trx: any) {
  const rows = await trx
    .select('column_name')
    .from('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'orders' });

  const set = new Set<string>(rows.map((r: any) => r.column_name));

  const keyCol = set.has('external_key')
    ? 'external_key'
    : set.has('external_id')
    ? 'external_id'
    : null;

  const amountCol = set.has('total_amount')
    ? 'total_amount'
    : set.has('amount')
    ? 'amount'
    : set.has('total')
    ? 'total'
    : null;

  return { keyCol, amountCol, all: Array.from(set) };
}

/** Introspect allowed status values from the CHECK constraint */
async function introspectAllowedOrderStatuses(trx: any): Promise<Set<string>> {
  try {
    const res = await trx.raw(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname = 'orders'
        AND n.nspname = 'public'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%';
    `);
    const def: string | undefined = res?.rows?.[0]?.def;
    if (!def) return new Set();
    const vals = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]?.toLowerCase());
    return new Set(vals.filter(Boolean));
  } catch {
    return new Set();
  }
}

/* ------------------------------ Row helpers -------------------------------- */

/** strip any empty-string keys from a row object */
function stripEmptyKeys(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if ((k || '').trim() !== '') out[k] = v;
  }
  return out;
}

/** sanitize headers+rows to drop empty header names across all sources */
function sanitizeHeadersAndRows(headers: string[], rows: any[]) {
  const cleanHeaders = (headers || []).filter((h) => (h || '').trim() !== '');
  const cleanRows = (rows || []).map((r) => {
    const o: Record<string, any> = {};
    for (const h of cleanHeaders) o[h] = r[h];
    return o;
  });
  return { headers: cleanHeaders, rows: cleanRows, firstRow: cleanRows[0] ?? null };
}

function normalizeFromCsv(records: CsvRow[]) {
  if (!records?.length) return { headers: [] as string[], rows: [] as any[], firstRow: null as any };
  const headers = Object.keys(records[0] ?? {});
  const rows = records.map((r) => r);
  return sanitizeHeadersAndRows(headers, rows);
}

async function preflightFromCsvUrl(url: string) {
  const records = await fetchCsvRows(toCsvExportUrl(url));
  return normalizeFromCsv(records);
}

export async function preflightFromSource(db: DB, store_id: string, source?: any) {
  // If no source provided, use the store's enabled Sheet (CSV export)
  if (!source) {
    const res = await db.transaction(async (trx: any) => {
      await trx.raw('SET LOCAL search_path = public');
      const sheet = await getEnabledSheetForStore(trx, store_id);
      if (!sheet?.gsheet_url) return { ok: false as const, reason: 'sheet_missing' };
      return { ok: true as const, sheet };
    });
    if (!res.ok) return { headers: [], firstRow: null, rows: [] };
    return preflightFromCsvUrl(res.sheet!.gsheet_url);
  }

  // Upload/URL path (xlsx/csv/tsv/etc)
  const buf = await loadBufferFromSource(
    source.type === 'upload'
      ? { type: 'upload', path: source.path }
      : { type: 'url', url: source.url }
  );

  const parsed = await parseTableAsync(
    buf,
    source.type === 'upload' ? source.originalName : source.filenameHint,
    source.contentType
  );

  // ensure we drop empty headers for uploads too
  return sanitizeHeadersAndRows(parsed.headers ?? [], parsed.rows ?? []);
}

/* ------------------------------ Date & number parsing --------------------- */

function parseDateLoose(input: any): Date | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input : null;

  if (typeof input === 'number') {
    const ms = input > 1e12 ? input : input * 1000; // accept seconds or ms
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;

    const iso = new Date(s);
    if (Number.isFinite(iso.getTime())) return iso;

    // d/m/Y or d-m-Y (optional time)
    const m = s.match(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (m) {
      let [, a, b, c, hh = '0', mm = '0', ss = '0'] = m;
      let d = Number(a), mth = Number(b), y = Number(c.length === 2 ? `20${c}` : c);
      // prefer DD/MM/YYYY; flip if looks like MM/DD
      if (d <= 12 && mth > 12) [d, mth] = [mth, d];
      if (d > 31 || mth < 1 || mth > 12) return null;
      const dt = new Date(Date.UTC(y, mth - 1, d, Number(hh), Number(mm), Number(ss)));
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
  }
  return null;
}

function coerceNumber(input: any): number | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  // strip currency and spaces
  s = s.replace(/[^\d.,\-]/g, '');
  // if both separators present, assume . is thousands and , is decimal (EU style)
  if (s.includes('.') && s.includes(',')) {
    if (s.indexOf('.') < s.indexOf(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // single comma -> decimal
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------- Fuzzy matching helpers ------------------------- */

const NORM = (s: any) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function fuzzyPick(headers: string[], candidates: string[]): string | undefined {
  if (!headers?.length) return undefined;
  const normH = headers.map(NORM);
  const norms = candidates.map(NORM);

  for (const c of norms) {
    const i = normH.indexOf(c);
    if (i >= 0) return headers[i];
  }
  for (const c of norms) {
    const i = normH.findIndex(h => h.includes(c));
    if (i >= 0) return headers[i];
  }
  return undefined;
}

type FieldMap = Record<string, string | string[]>;

function ordersFallback(headers: string[]): FieldMap {
  const order_id = fuzzyPick(headers, [
    'order id','order','external id','ref','reference',
    'commande','cmd','numero','n°','order number'
  ]);
  const status = fuzzyPick(headers, [
    'status','state','order status','statut','état','etat','statut confirmation','statut livraison'
  ]);
  const total_amount = fuzzyPick(headers, [
    'total','amount','total amount','sum','price','prix','montant'
  ]);
  const created_at = fuzzyPick(headers, [
    'created at','created','date','ordered at','order date','date de commande','commande le'
  ]);
  const customer_name = fuzzyPick(headers, [
    'full name','name','customer','buyer','nom','nom complet'
  ]);
  const customer_phone = fuzzyPick(headers, [
    'phone','tel','telephone','téléphone','portable','gsm'
  ]);
  const customer_email = fuzzyPick(headers, ['email','e-mail','courriel']);

  const fields: FieldMap = {};
  if (order_id) fields.order_id = order_id;
  if (status) fields.status = status;
  if (total_amount) fields.total_amount = total_amount;
  if (created_at) fields.created_at = created_at;
  if (customer_name) fields.customer_name = customer_name;
  if (customer_phone) fields.customer_phone = customer_phone;
  if (customer_email) fields.customer_email = customer_email;
  return fields;
}

function productsFallback(headers: string[]): FieldMap {
  const sku = fuzzyPick(headers, [
    'sku','product sku','id','product id','code','item code','reference','ref'
  ]);
  const title = fuzzyPick(headers, ['title','name','product name','nom','désignation','designation']);
  const price = fuzzyPick(headers, ['price','unit price','amount','prix','montant']);
  const quantity = fuzzyPick(headers, ['qty','quantity','stock','inventory','qte','quantite','quantité']);
  const description = fuzzyPick(headers, ['description','desc','details']);

  const fields: FieldMap = {};
  if (sku) fields.sku = sku;
  if (title) fields.title = title;
  if (price) fields.price = price;
  if (quantity) fields.quantity = quantity;
  if (description) fields.description = description;
  return fields;
}

/** Keep only non-empty keys, resolve string[] -> first present header */
function resolveMappingToStrings(map: FieldMap, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dst, src] of Object.entries(map || {})) {
    if (Array.isArray(src)) {
      const choice = src.find(s => headers.includes(s)) || fuzzyPick(headers, src);
      if (choice) out[dst] = choice;
    } else if (typeof src === 'string' && src.trim()) {
      out[dst] = src;
    }
  }
  return out;
}

function mergeFieldMaps(a?: FieldMap, b?: FieldMap, c?: FieldMap): FieldMap {
  const out: FieldMap = {};
  const put = (m?: FieldMap) => {
    if (!m) return;
    for (const [k, v] of Object.entries(m)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.trim()) out[k] = v;
      else if (Array.isArray(v) && v.length) out[k] = v;
    }
  };
  // precedence: c (heuristic) < b (AI) < a (job override)
  put(c); put(b); put(a);
  return out;
}

/* ----------------------- Optional AI mapping (dynamic) --------------------- */

let _aiSuggest:
  | null
  | ((
      entity: 'orders' | 'products',
      headers: string[],
      sampleRows: Array<Record<string, any>>
    ) => Promise<{ fields?: FieldMap; uniqueKey?: string | null; confidence?: number }>) = null;

let _useAiMapping = false;

async function loadAiMappingIfAvailable(log?: FastifyBaseLogger) {
  if (_aiSuggest !== null) return;
  try {
    const mod = await import('../utils/ingest-map-ai');
    _aiSuggest = (mod as any).aiSuggestMapping ?? null;
    _useAiMapping = Boolean((mod as any).INGEST_USE_LLM_MAPPING ?? process.env.INGEST_USE_LLM_MAPPING);
    log?.info?.({ use_ai: _useAiMapping }, 'ingest_ai_module_loaded');
  } catch {
    _aiSuggest = null;
    _useAiMapping = false;
    log?.info?.({ use_ai: false }, 'ingest_ai_module_loaded');
  }
}

/* -------------------------- Mapping composition --------------------------- */

type Entity = 'orders' | 'products';

async function buildMappingAndKey(
  headers: string[],
  rows: Array<Record<string, any>>,
  entity: Entity,
  jobMapping?: { fields?: Record<string, string | string[]>; uniqueKey?: string; maxRows?: number },
  log?: FastifyBaseLogger,
) {
  const heuristic = suggestMapping(headers, entity) || { fields: {} as Record<string, string> };

  await loadAiMappingIfAvailable(log);
  let ai: { fields?: FieldMap; uniqueKey?: string | null; confidence?: number } | null = null;
  if (_useAiMapping && _aiSuggest) {
    try {
      ai = await _aiSuggest(entity, headers, rows.slice(0, 8));
      log?.info?.(
        { entity, ai_confidence: ai?.confidence, ai_fields: Object.keys(ai?.fields || {}) },
        'ingest_ai_mapping_ok'
      );
    } catch (e: any) {
      log?.warn?.({ entity, err: String(e) }, 'ingest_ai_mapping_failed');
    }
  }

  let merged: FieldMap = mergeFieldMaps(jobMapping?.fields, ai?.fields, heuristic.fields as any);

  if (!Object.keys(merged).length) {
    merged = entity === 'products' ? productsFallback(headers) : ordersFallback(headers);
  } else {
    const backfill = entity === 'products' ? productsFallback(headers) : ordersFallback(headers);
    for (const [k, v] of Object.entries(backfill)) {
      if (!merged[k]) merged[k] = v;
    }
  }

  const finalFields = resolveMappingToStrings(merged, headers);

  let uniqueKey: string | undefined =
    jobMapping?.uniqueKey || (ai?.uniqueKey ?? undefined);

  if (!uniqueKey) {
    if (entity === 'products') {
      const candidates = ['sku', 'id', 'product_id'];
      uniqueKey = candidates.find(k => finalFields[k]) || 'sku';
    } else {
      const candidates = ['order_id', 'id', 'external_id', 'external_key', 'number'];
      uniqueKey = candidates.find(k => finalFields[k]) || 'order_id';
    }
  }

  return { fields: finalFields, uniqueKey };
}

/* ----------------------- Status normalization helpers --------------------- */

// canonical tokens
const STATUS_CANON_MAP: Record<string, string> = {
  // confirmed
  'confirme': 'confirmed',
  'confirmer': 'confirmed',
  'confirmé': 'confirmed',
  'confirmee': 'confirmed',
  'confirmed': 'confirmed',
  'valide': 'confirmed',
  'validé': 'confirmed',
  'approved': 'confirmed',
  'ok': 'confirmed',

  // delivered
  'livre': 'delivered',
  'livrer': 'delivered',
  'livré': 'delivered',
  'delivered': 'delivered',
  'recu': 'delivered',
  'reçu': 'delivered',

  // canceled
  'annule': 'canceled',
  'annuler': 'canceled',
  'annulé': 'canceled',
  'cancel': 'canceled',
  'cancelled': 'canceled',
  'canceled': 'canceled',
  'refuse': 'canceled',
  'refusé': 'canceled',

  // shipped
  'expedie': 'shipped',
  'expedier': 'shipped',
  'expédié': 'shipped',
  'envoye': 'shipped',
  'envoyé': 'shipped',
  'shipped': 'shipped',

  // pending / new / processing
  'en attente': 'pending',
  'attente': 'pending',
  'en cours': 'processing',
  'nouveau': 'new',
  'new': 'new',
  'pending': 'pending',
  'processing': 'processing',
  'unconfirmed': 'pending',
  'non confirme': 'pending',

  // paid
  'paye': 'paid',
  'payé': 'paid',
  'paid': 'paid',

  // returned
  'retour': 'returned',
  'retourne': 'returned',
  'retourné': 'returned',
  'returned': 'returned',

  // failed
  'echec': 'failed',
  'echoue': 'failed',
  'échoué': 'failed',
  'failed': 'failed',
};

function preferAllowed(canon: string, allowed: Set<string>): string {
  const pick = (...opts: string[]) => opts.find(o => allowed.has(o));
  switch (canon) {
    case 'confirmed': return pick('processing', 'completed', 'new') || [...allowed][0] || 'new';
    case 'delivered': return pick('completed', 'processing', 'new') || [...allowed][0] || 'new';
    case 'canceled':  return pick('cancelled', 'refunded', 'new') || [...allowed][0] || 'new';
    case 'shipped':   return pick('processing', 'completed', 'new') || [...allowed][0] || 'new';
    case 'paid':      return pick('processing', 'completed', 'new') || [...allowed][0] || 'new';
    case 'returned':  return pick('refunded', 'cancelled', 'completed', 'new') || [...allowed][0] || 'new';
    case 'failed':    return pick('cancelled', 'new') || [...allowed][0] || 'new';
    case 'pending':   return pick('pending', 'new') || [...allowed][0] || 'new';
    case 'processing':return pick('processing', 'new') || [...allowed][0] || 'new';
    case 'new':       return pick('new') || [...allowed][0] || 'new';
    default:          return pick(canon, 'new', 'pending') || [...allowed][0] || 'new';
  }
}

function normalizeOrderStatusToAllowed(raw: any, allowed: Set<string>): string {
  const s = NORM(raw);
  const canon = STATUS_CANON_MAP[s] || s; // if unknown, keep normalized candidate
  if (allowed.has(canon)) return canon;
  return preferAllowed(canon, allowed);
}

/* ------------------------------ Helpers ----------------------------------- */

const safeJson = (obj: any) => {
  try { return JSON.stringify(obj ?? {}); } catch { return '{}'; }
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function tryAdvisoryLock(trx: any, store_id: string): Promise<boolean> {
  const res = await trx.raw('SELECT pg_try_advisory_lock(?, hashtext(?)) AS ok', [LOCK_NS, store_id]);
  return Boolean(res?.rows?.[0]?.ok);
}
async function advisoryUnlock(trx: any, store_id: string): Promise<void> {
  try { await trx.raw('SELECT pg_advisory_unlock(?, hashtext(?))', [LOCK_NS, store_id]); } catch {}
}

async function listActiveStoresWithEnabledSheet(db: DB): Promise<string[]> {
  return db.transaction(async (trx: any) => {
    await trx.raw('SET LOCAL search_path = public');
    const rows = await trx('public.stores as s')
      .select('s.id as store_id')
      .join('public.store_sheets as ss', 'ss.store_id', 's.id')
      .where({ 's.status': 'active', 'ss.enabled': true })
      .groupBy('s.id');
    return rows.map((r: any) => r.store_id);
  });
}

/* ------------------------------ Main worker -------------------------------- */

export function installIngestWorker(db: DB, log?: FastifyBaseLogger) {
  const logger: FastifyBaseLogger = (log as any) || (console as unknown as FastifyBaseLogger);

  try {
    (logger.info || console.log)({ flags: FLAGS, env_INGEST_ENABLED: process.env.INGEST_ENABLED }, 'ingest_boot_flags');
  } catch {}

  if (!INGEST_ENABLED) {
    (logger.info || console.log)({ INGEST_ENABLED }, 'ingest_disabled_via_env');
    return {
      warm: () => void 0,
      preflightFromSource: (store_id: string, source?: any) => preflightFromSource(db, store_id, source),
    };
  }

  async function handleJob(job: IngestJob) {
    const { store_id } = job;
    const entity = (job.mapping?.entity ?? (job as any).entity ?? 'orders') as Entity;

    const prestate = await db.transaction(async (trx: any) => {
      await trx.raw('SET LOCAL search_path = public');

      const store = await getStoreRow(trx, store_id);
      if (!store) return { ok: false as const, code: 'store_not_found' };
      if (store.status !== 'active') return { ok: false as const, code: 'store_inactive' };

      const sheet = await getEnabledSheetForStore(trx, store_id);
      if (!job.source && (!sheet || !sheet.gsheet_url)) return { ok: false as const, code: 'sheet_missing' };

      return { ok: true as const, store, sheet };
    });

    if (!prestate.ok) {
      logger.warn({ store_id, code: prestate.code }, 'ingest_precondition_failed');
      return;
    }

    // ---- Acquire rows
    let headers: string[] = [];
    let rows: any[] = [];
    let firstRow: any = null;
    let usedUrl: string | undefined;

    try {
      if (job.source) {
        const pf = await preflightFromSource(db, store_id, job.source);
        headers = pf.headers; rows = pf.rows; firstRow = pf.firstRow;
      } else {
        usedUrl = prestate.sheet!.gsheet_url;
        const pf = await preflightFromCsvUrl(usedUrl);
        headers = pf.headers; rows = pf.rows; firstRow = pf.firstRow;
      }
    } catch (e: any) {
      logger.warn({ store_id, err: String(e) }, 'ingest_preflight_failed');
      return;
    }

    // Resume only for sheet-based jobs (ignore for uploads/URL one-offs).
    // If the stored offset is nonsensical for the current sheet (e.g., new/shorter sheet),
    // reset it to 0 so we re-ingest from the beginning of this sheet.
    let resumeFrom = 0;
    if (!job.source) {
      const stored = Number(prestate.sheet?.last_processed_row || 0);
      resumeFrom = Number.isFinite(stored) && stored > 0 ? stored : 0;
      if (resumeFrom >= rows.length || resumeFrom > rows.length * 2) {
        logger.info({ store_id, resumeFrom, total_rows: rows.length }, 'ingest_resume_exceeds_rows_reset');
        try {
          await db('public.store_sheets')
            .where({ id: prestate.sheet!.id })
            .update({ last_processed_row: 0, updated_at: db.fn.now() });
        } catch {}
        resumeFrom = 0;
      }
    }
    const baseRows = resumeFrom > 0 ? rows.slice(resumeFrom) : rows;

    logger.info(
      { store_id, entity, exportUrl: usedUrl, total_rows: rows.length, resume_from_row: resumeFrom, headers, firstRow },
      'ingest_preflight'
    );

    if (!baseRows.length) {
      logger.info({ store_id, skipped: resumeFrom }, 'ingest_no_rows');
      return;
    }

    const { fields: finalFields, uniqueKey } = await buildMappingAndKey(
      headers,
      rows, // use full rows for mapping heuristics
      entity,
      job.mapping,
      logger
    );

    logger.info({
      store_id,
      entity,
      uniqueKey,
      mappedFields: Object.keys(finalFields || {}).length,
      sampleMapping: Object.fromEntries(Object.entries(finalFields).slice(0, 6)),
    }, 'ingest_mapping');

    // ---- Respect optional maxRows (applied after resume offset)
    const limit = job.mapping?.maxRows && job.mapping.maxRows > 0 ? job.mapping.maxRows : undefined;
    const useRows = limit ? baseRows.slice(0, limit) : baseRows;

    // ---- Process in chunks with advisory lock to avoid DB contention
    const chunks = chunk(useRows, CHUNK_SIZE);

    for (const c of chunks) {
      try {
        await db.transaction(async (trx: any) => {
          await trx.raw('SET LOCAL search_path = public');

          // try advisory lock per store
          const got = await tryAdvisoryLock(trx, store_id);
          if (!got) {
            logger.info({ store_id }, 'ingest_store_busy_skip_chunk');
            return; // skip this chunk; another worker is active
          }

          try {
            if (entity === 'products') {
              for (const raw of c) {
                const rec = applyMapping(raw, { fields: finalFields });
                const keyVal = (rec?.[uniqueKey] ?? rec?.sku ?? '').toString().trim();

                if (!keyVal) {
                  logger.warn({ store_id, uniqueKey, rawKeys: Object.keys(rec || {}) }, 'products_missing_unique_key_row_skipped');
                  continue;
                }

                const priceNum = coerceNumber(rec?.price);
                const qtyNum = coerceNumber(rec?.quantity);

                await trx('public.products')
                  .insert({
                    id: trx.raw('gen_random_uuid()'),
                    store_id,
                    sku: keyVal,
                    title: rec?.title ?? keyVal,
                    description: rec?.description ?? null,
                    price: Number.isFinite(priceNum as number) ? priceNum : null,
                    inventory: Number.isFinite(qtyNum as number) ? qtyNum : null,
                    status: 'active',
                    created_at: trx.fn.now(),
                    updated_at: trx.fn.now(),
                  })
                  .onConflict(['store_id', 'sku'])
                  .merge({
                    title: rec?.title ?? trx.raw('public.products.title'),
                    description: rec?.description ?? trx.raw('public.products.description'),
                    price: Number.isFinite(priceNum as number) ? priceNum : trx.raw('public.products.price'),
                    inventory: Number.isFinite(qtyNum as number) ? qtyNum : trx.raw('public.products.inventory'),
                    updated_at: trx.fn.now(),
                  });
              }
            } else {
              // ---- Orders upsert (key + optional amount) + raw_payload_json + status normalization
              const { keyCol, amountCol, all } = await introspectOrdersColumns(trx);
              if (!keyCol) {
                logger.warn({ store_id, columns: all }, 'orders_table_missing_key_column');
                return;
              }
              const allowedStatuses = await introspectAllowedOrderStatuses(trx);
              logger.info({ store_id, keyCol, amountCol, allowedStatuses: [...allowedStatuses] }, 'orders_introspect');

              for (const raw of c) {
                const rec = applyMapping(raw, { fields: finalFields });

                const extKey = (rec?.[uniqueKey] ?? rec?.order_id ?? rec?.id ?? rec?.external_id ?? rec?.external_key ?? '')
                  .toString()
                  .trim();
                if (!extKey) {
                  logger.warn({ store_id, uniqueKey, rawKeys: Object.keys(rec || {}) }, 'orders_missing_unique_key_row_skipped');
                  continue;
                }

                // Normalize status to match DB constraint
                // Try AI-powered normalization first, falls back to manual mapping
                const statusRaw = (rec?.status ?? 'new').toString();
                const status = await normalizeStatusWithAI(statusRaw, allowedStatuses);

                // Amount
                const total = rec?.total_amount ?? rec?.amount ?? rec?.total ?? rec?.price;
                const totalNum = coerceNumber(total);

                // Date candidates
                const rawCreated =
                  rec?.created_at ??
                  rec?.date ??
                  rec?.ordered_at ??
                  rec?.order_date ??
                  raw?.['Order date'] ??
                  raw?.['order date'];
                const createdAt = parseDateLoose(rawCreated);

                const cleanRaw = stripEmptyKeys(raw);

                const insertObj: Record<string, any> = {
                  id: trx.raw('gen_random_uuid()'),
                  store_id,
                  status,
                  created_at: createdAt ? createdAt : trx.fn.now(),
                  updated_at: trx.fn.now(),
                  raw_payload_json: trx.raw('?::jsonb', [safeJson(cleanRaw)]), // keep source row (cleaned)
                };
                insertObj[keyCol] = extKey;
                if (amountCol) insertObj[amountCol] = Number.isFinite(totalNum as number) ? totalNum : null;

                const mergeObj: Record<string, any> = {
                  status,
                  updated_at: trx.fn.now(),
                };
                if (amountCol && Number.isFinite(totalNum as number)) {
                  mergeObj[amountCol] = totalNum;
                }

                await trx('public.orders')
                  .insert(insertObj)
                  .onConflict(['store_id', keyCol])
                  .merge(mergeObj);
              }
            }

            // Progress marker (best effort) per chunk
            try {
              const sheet = await getEnabledSheetForStore(trx, store_id);
              if (sheet) {
                await trx('public.store_sheets')
                  .where({ id: sheet.id })
                  .update({
                    last_processed_row: (sheet.last_processed_row || 0) + c.length,
                    updated_at: trx.fn.now(),
                  });
              }
            } catch { /* non-fatal */ }
          } finally {
            await advisoryUnlock(trx, store_id);
          }
        });
      } catch (e: any) {
        logger.warn({ store_id, err: String(e) }, 'ingest_tx_failed');
        // keep going with next chunk; another scan tick will catch leftovers
      }
    }

    logger.info(
      {
        store_id,
        entity,
        processed: useRows.length,
        headers_len: headers.length,
        mappedFields: Object.keys(finalFields || {}).length,
        uniqueKey,
      },
      'ingest_complete'
    );
  }

  // Register the handler (support multiple util signatures defensively)
  let installed = false;
  try {
    (ensureInProcessIngestWorker as any)(handleJob);
    installed = true;
  } catch {}
  if (!installed) {
    try {
      (ensureInProcessIngestWorker as any)(process, handleJob);
      installed = true;
    } catch {}
  }
  if (!installed) {
    try {
      (ensureInProcessIngestWorker as any)(process);
      installed = true;
    } catch {}
  }

  if (installed) {
    logger.info('ingest_worker_installed', {});
  } else {
    (logger?.warn || console.warn)('ingest_worker_install_failed', {});
  }

  /** Optional: self-kick a scan on boot and/or at intervals */
  const startSelfKick = async () => {
    if (!INGEST_SELF_KICK) return;

    if (SCAN_ON_BOOT) {
      try {
        const storeIds = await listActiveStoresWithEnabledSheet(db);
        logger.info({ count: storeIds.length }, 'scan_on_boot_dispatch');
        for (const store_id of storeIds) {
          await handleJob({ store_id, mapping: { entity: 'orders' } } as unknown as IngestJob);
        }
      } catch (e: any) {
        logger.warn({ err: String(e) }, 'scan_on_boot_failed');
      }
    }

    if (Number.isFinite(SCAN_INTERVAL_MS) && SCAN_INTERVAL_MS >= 15000) {
      setInterval(async () => {
        try {
          const storeIds = await listActiveStoresWithEnabledSheet(db);
          logger.info({ count: storeIds.length, every_ms: SCAN_INTERVAL_MS }, 'scan_tick_dispatch');
          for (const store_id of storeIds) {
            await handleJob({ store_id, mapping: { entity: 'orders' } } as unknown as IngestJob);
          }
        } catch (e: any) {
          logger.warn({ err: String(e) }, 'scan_tick_failed');
        }
      }, SCAN_INTERVAL_MS).unref?.();
    }
  };

  void startSelfKick();

  return {
    warm: () => void 0,
    preflightFromSource: (store_id: string, source?: any) => preflightFromSource(db, store_id, source),
  };
}

export default { installIngestWorker };
