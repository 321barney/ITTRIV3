// src/utils/ingest-map-ai.ts
import crypto from 'node:crypto';

// Reuse the Redis helper if available (it’s optional)
let redis: any = null;
let isRedisEnabled = () => false;
try {
  // If your redis helper lives elsewhere, adjust the path
  const mod = await import('./redis');
  // @ts-ignore
  redis = (mod as any).redis ?? null;
  // @ts-ignore
  isRedisEnabled = (mod as any).isRedisEnabled ?? (() => false);
} catch {
  // no-redis mode
}

const truthy = (v?: string | null) =>
  typeof v === 'string' && !['0','false','no','off',''].includes(v.trim().toLowerCase());

export const INGEST_USE_LLM_MAPPING = truthy(process.env.INGEST_USE_LLM_MAPPING ?? '0');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.INGEST_LLM_MODEL || 'gpt-4o-mini';
const LLM_TIMEOUT_MS = Number(process.env.INGEST_LLM_TIMEOUT_MS || '12000');
const SAMPLE_ROWS = Math.max(1, Math.min(8, Number(process.env.INGEST_LLM_SAMPLE_ROWS || '6')));
const CACHE_TTL_SECONDS = Math.max(60, Number(process.env.INGEST_LLM_CACHE_TTL || '43200')); // 12h

type FieldMap = Record<string, string | string[]>;
type Entity = 'orders' | 'products';

function sha(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function cacheKey(entity: Entity, headers: string[], rows: Array<Record<string, any>>) {
  const head = [...headers].sort().join('|');
  // keep cache key stable but avoid PII — never include raw row values
  return `ingest:ai:${entity}:${sha(head)}`;
}

function sanitizeRows(rows: Array<Record<string, any>>) {
  // Shallow copy + light redaction of obvious PII-like fields to be safe
  const redactKeys = ['phone','tel','telephone','téléphone','email','e-mail','courriel'];
  const out: Array<Record<string, any>> = [];
  for (const r of rows) {
    const c: Record<string, any> = {};
    for (const [k,v] of Object.entries(r || {})) {
      if (redactKeys.some(rk => k.toLowerCase().includes(rk))) {
        c[k] = '[redacted]';
      } else {
        // keep small/short strings only; avoid long blobs
        const s = String(v ?? '');
        c[k] = s.length > 120 ? s.slice(0, 117) + '…' : s;
      }
    }
    out.push(c);
  }
  return out;
}

async function fetchOpenAIJson(prompt: string): Promise<any> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a data-mapping assistant. You receive spreadsheet headers and a few sample rows and must return a JSON object describing how to map those columns into our database fields. Only return valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content: string =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.message ??
      '';

    // Should already be JSON thanks to response_format, but be defensive
    try {
      return JSON.parse(content);
    } catch {
      // try to extract JSON block
      const m = content.match(/\{[\s\S]*\}$/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Model did not return valid JSON');
    }
  } finally {
    clearTimeout(t);
  }
}

function makePrompt(entity: Entity, headers: string[], sampleRows: Array<Record<string, any>>) {
  const baseFields =
    entity === 'products'
      ? [
          'sku','title','price','quantity','description',
        ]
      : [
          'order_id', 'external_id', 'external_key', 'number',
          'created_at', 'status', 'total_amount',
          'customer_name', 'customer_phone', 'customer_email',
          'city','address',
        ];

  // Tell the model to ONLY use provided headers for the mapping
  // and pick the best single header for each DB field.
  return [
    `Entity: ${entity}`,
    `Spreadsheet headers (exact): ${JSON.stringify(headers)}`,
    `Sample rows: ${JSON.stringify(sanitizeRows(sampleRows))}`,
    `Target fields you may map (choose only those that exist/are useful): ${baseFields.join(', ')}`,
    '',
    'Return JSON of the form:',
    '{ "fields": { "<db_field>": "<header_name>" }, "uniqueKey": "<one_of_db_fields_or_null>", "confidence": 0.0 }',
    '',
    'Rules:',
    '- Only include headers that actually exist in the spreadsheet.',
    '- Prefer a single best header per db_field (no arrays).',
    '- If you cannot find a good unique key, set "uniqueKey" to null.',
    '- Respond with JSON only.',
  ].join('\n');
}

function normalizeResult(
  entity: Entity,
  headers: string[],
  raw: any
): { fields?: FieldMap; uniqueKey?: string | null; confidence?: number } {
  const out: { fields?: FieldMap; uniqueKey?: string | null; confidence?: number } = {
    fields: {},
    uniqueKey: null,
    confidence: undefined,
  };

  const hdrSet = new Set(headers);

  const fields: Record<string, string> = raw?.fields || raw?.mapping || {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string') continue;
    if (hdrSet.has(v)) out.fields![k] = v;
  }

  let uniqueKey: string | null = raw?.uniqueKey ?? null;
  if (uniqueKey && typeof uniqueKey === 'string') {
    // keep as-is; ingest.ts will still sanity-check presence later
    out.uniqueKey = uniqueKey;
  } else {
    out.uniqueKey = null;
  }

  const conf = Number(raw?.confidence);
  if (Number.isFinite(conf)) out.confidence = conf;

  return out;
}

async function getCached(key: string) {
  if (!isRedisEnabled() || !redis) return null;
  try { const s = await redis.get(key); return s ? JSON.parse(s) : null; } catch { return null; }
}

async function setCached(key: string, val: any) {
  if (!isRedisEnabled() || !redis) return;
  try { await redis.set(key, JSON.stringify(val), 'EX', CACHE_TTL_SECONDS); } catch {}
}

/**
 * Ask the LLM to propose a column mapping.
 * Returns { fields, uniqueKey, confidence }.
 */
export async function aiSuggestMapping(
  entity: Entity,
  headers: string[],
  sampleRows: Array<Record<string, any>>
): Promise<{ fields?: FieldMap; uniqueKey?: string | null; confidence?: number }> {
  if (!INGEST_USE_LLM_MAPPING) {
    throw new Error('LLM mapping disabled (INGEST_USE_LLM_MAPPING=0)');
  }
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const rows = sampleRows.slice(0, SAMPLE_ROWS);
  const key = cacheKey(entity, headers, rows);

  const cached = await getCached(key);
  if (cached) return cached;

  const prompt = makePrompt(entity, headers, rows);
  const raw = await fetchOpenAIJson(prompt);
  const normalized = normalizeResult(entity, headers, raw);

  // Small sanity: ensure we only keep fields whose header exists
  const cleaned: FieldMap = {};
  for (const [k, v] of Object.entries(normalized.fields || {})) {
    if (typeof v === 'string' && headers.includes(v)) cleaned[k] = v;
  }
  const result = { fields: cleaned, uniqueKey: normalized.uniqueKey ?? null, confidence: normalized.confidence };

  await setCached(key, result);
  return result;
}

export default { aiSuggestMapping, INGEST_USE_LLM_MAPPING };
