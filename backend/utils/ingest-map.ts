// src/utils/ingest-map.ts

import type { RequestInit } from 'node-fetch';

// --------- Normalization helpers (accent-insensitive, partial-friendly) ----------
const norm = (s: any) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function buildHeaderIndex(headers: string[]) {
  const byNorm = new Map<string, string>();
  const listNorm = headers.map((h) => norm(h));
  headers.forEach((h, i) => byNorm.set(listNorm[i], h));
  return { byNorm, listNorm };
}

const pick = (headers: string[], candidates: string[]) => {
  const { byNorm, listNorm } = buildHeaderIndex(headers);
  // exact match on normalized token
  for (const c of candidates) {
    const hit = byNorm.get(norm(c));
    if (hit) return hit;
  }
  // partial/contains
  for (const c of candidates) {
    const nc = norm(c);
    const idx = listNorm.findIndex((h) => h.includes(nc));
    if (idx >= 0) return headers[idx];
  }
  return undefined;
};

// ------------------------------ Heuristic mapper ------------------------------
function heuristicSuggest(headers: string[], entity: 'orders' | 'products') {
  const H = (headers || []).filter((h) => String(h).trim() !== '');

  if (entity === 'products') {
    const sku = pick(H, [
      'sku', 'product sku', 'id', 'product id', 'code', 'item code', 'ref', 'reference', 'article', 'référence'
    ]);
    const title = pick(H, [
      'title', 'name', 'product name', 'libelle', 'libellé', 'designation', 'désignation'
    ]);
    const price = pick(H, [
      'price', 'unit price', 'amount', 'prix', 'montant', 'total'
    ]);
    const qty = pick(H, [
      'qty', 'quantity', 'qte', 'quantite', 'quantité', 'stock', 'inventory', 'inv', 'qtd', 'qté'
    ]);
    const description = pick(H, [
      'description', 'desc', 'details', 'detail', 'déscription'
    ]);

    return {
      uniqueKey: sku || 'sku',
      fields: {
        sku,
        title,
        price,
        quantity: qty,
        description,
      } as Record<string, string | undefined>,
    };
  }

  // orders - Enhanced multilingual patterns
  const orderId = pick(H, [
    // English
    'order id', 'order', 'id', 'external id', 'external key', 'reference', 'ref', 'order number', 'order no', 'invoice', 'invoice number', 'receipt',
    // French
    'commande', 'n° commande', 'num commande', 'numero commande', 'numéro commande', 'ref commande', 'facture', 'bon de commande',
    // Common abbreviations
    'num', 'numero', 'numéro', 'n°', 'no', '#', 'cmd', 'ord', 'ref', 'réf'
  ]);
  const status = pick(H, [
    // English
    'status', 'order status', 'state', 'order state', 'confirmation', 'confirmation status', 'delivery status', 'shipment status',
    // French
    'statut', 'état', 'etat', 'statut commande', 'statut confirmation', 'statut livraison', 'statut paiement', 'état commande',
    // Arabic transliterations
    'halat', 'hala', 'wad3iya', 'wadi3a'
  ]);
  const total = pick(H, [
    // English
    'total', 'amount', 'total amount', 'sum', 'price', 'total price', 'order total', 'grand total', 'subtotal', 'cost',
    // French
    'prix', 'montant', 'montant total', 'total ttc', 'prix total', 'somme', 'coût', 'cout',
    // Currency symbols
    'dh', 'mad', 'eur', 'usd', '$', '€'
  ]);
  const created = pick(H, [
    // English
    'created at', 'created', 'date', 'ordered at', 'order date', 'purchase date', 'ship date', 'date ordered', 'timestamp', 'time',
    // French  
    'date commande', 'date de commande', 'date order', 'date achat', 'date d achat', 'date creation', 'date création', 'date livraison',
    'commande le', 'créé le', 'cree le', 'commandé le', 'commande le',
    // Common formats
    'datetime', 'date time', 'date heure'
  ]);
  const email = pick(H, [
    // English
    'email', 'e-mail', 'mail', 'customer email', 'buyer email', 'user email', 'contact email', 'email address',
    // French
    'courriel', 'adresse email', 'adresse mail', 'email client', 'e mail',
    // Arabic transliterations
    'email', 'imail', 'baryd', 'bareed'
  ]);
  const phone = pick(H, [
    // English
    'phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number', 'cell', 'tel',
    // French
    'telephone', 'téléphone', 'numero de telephone', 'numéro de téléphone', 'tel', 'tél', 'gsm', 'portable', 'mobile',
    'numero', 'numéro', 'tel client', 'telephone client',
    // Arabic transliterations
    'tilifoun', 'hatif', 'raqm'
  ]);
  const name = pick(H, [
    // English
    'name', 'customer', 'buyer', 'full name', 'customer name', 'buyer name', 'first name', 'last name', 'firstname', 'lastname',
    // French
    'nom', 'client', 'nom client', 'nom complet', 'prenom', 'prénom', 'nom et prénom', 'nom prenom', 'nom prénom', 'acheteur',
    // Arabic transliterations
    'ism', 'esm', 'isem', '3amil', 'zaboun'
  ]);
  const city = pick(H, [
    // English
    'city', 'town', 'location', 'address', 'delivery city', 'shipping city',
    // French
    'ville', 'commune', 'localite', 'localité', 'adresse', 'lieu', 'ville livraison', 'ville de livraison',
    // Arabic transliterations
    'madina', 'mdina', 'balad'
  ]);

  return {
    uniqueKey: orderId || 'order_id',
    fields: {
      order_id: orderId,
      status,
      total_amount: total,
      created_at: created,
      customer_email: email,
      customer_phone: phone,
      customer_name: name,
      city,
    } as Record<string, string | undefined>,
  };
}

// ------------------------------ LLM integration ------------------------------
// Minimal REST call (no SDK). Works with OPENAI_API_KEY + OPENAI_MODEL.
async function callOpenAIChat(system: string, user: string, options?: { model?: string; timeoutMs?: number }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_missing');

  const model = options?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const timeoutMs = options?.timeoutMs ?? 12000;

  const { default: fetch } = await import('node-fetch');
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    } as RequestInit);

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`openai_http_${res.status}:${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('openai_empty_content');
    return JSON.parse(content);
  } finally {
    clearTimeout(to);
  }
}

// Redact PII-ish cells before sending to LLM
function sanitizeRows(rows: Array<Record<string, any>>, headers: string[], limit = 5) {
  const lower = headers.map((h) => h.toLowerCase());
  const piiCols = new Set(
    lower
      .map((h, i) => (/(email|e-mail|mail|phone|tel|téléphone|gsm)/.test(h) ? i : -1))
      .filter((i) => i >= 0)
  );

  return rows.slice(0, limit).map((r) => {
    const o: Record<string, any> = {};
    headers.forEach((h, idx) => {
      let v = r[h];
      if (piiCols.has(idx)) {
        const s = String(v ?? '');
        v = s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
      }
      o[h] = v;
    });
    return o;
  });
}

type Mapping = { uniqueKey?: string; fields: Record<string, string | undefined> };

async function llmSuggest(
  headers: string[],
  sampleRows: Array<Record<string, any>>,
  entity: 'orders' | 'products'
): Promise<Mapping> {
  const system = `You map spreadsheet headers to our canonical schema.
Return ONLY JSON with: { "uniqueKey": string, "fields": { <canonicalField>: "<inputHeader>" | null } }.
Never invent headers that don't exist. If you cannot map a field, set it to null.`;

  const canon = entity === 'products'
    ? {
        uniqueKey_hint: ['sku'],
        fields: ['sku','title','price','quantity','description'],
      }
    : {
        uniqueKey_hint: ['order_id'],
        fields: ['order_id','status','total_amount','created_at','customer_email','customer_phone','customer_name','city'],
      };

  const user = JSON.stringify({
    task: `Map headers to ${entity} canonical fields`,
    headers,
    sample_rows: sanitizeRows(sampleRows || [], headers),
    canonical: canon,
    rules: [
      'Prefer exact/near synonyms in English or French/Arabic transliterations.',
      'Be strict: fields must reference an existing header name exactly as seen in "headers".',
      'Pick a stable uniqueKey (orders: order_id/external_id/number; products: sku/id/code).',
      'Dates: choose order date / created date if present.',
      'Amounts: total/amount/prix/montant.',
    ],
  });

  try {
    const out = await callOpenAIChat(system, user);
    // Basic shape check
    if (!out || typeof out !== 'object' || !out.fields) {
      throw new Error('openai_bad_shape');
    }
    return {
      uniqueKey: typeof out.uniqueKey === 'string' ? out.uniqueKey : undefined,
      fields: out.fields || {},
    };
  } catch {
    // Fallback to empty mapping on any LLM failure
    return { fields: {} };
  }
}

// --------------------------- Public API used by worker ---------------------------

/**
 * Suggests a mapping for the given headers/entity by combining:
 *   heuristics → LLM (optional) → explicit overrides
 * If OPENAI_API_KEY is set, we call the LLM when heuristic coverage is weak or forceLLM=true.
 */
export async function suggestMapping(
  headers: string[],
  entity: 'orders' | 'products',
  opts?: {
    sampleRows?: Array<Record<string, any>>;
    forceLLM?: boolean;
    overrides?: Record<string, string | undefined>;
  }
): Promise<{ uniqueKey?: string; fields: Record<string, string | undefined>; source: 'heuristic' | 'llm+heuristic' }> {
  const heur = heuristicSuggest(headers, entity);
  const coverage = Object.values(heur.fields).filter(Boolean).length;

  let merged: Mapping = { ...heur };
  let source: 'heuristic' | 'llm+heuristic' = 'heuristic';

  const canUseLLM = !!process.env.OPENAI_API_KEY;
  const shouldAskLLM = opts?.forceLLM || (canUseLLM && coverage < (entity === 'products' ? 3 : 4));

  if (shouldAskLLM) {
    const llm = await llmSuggest(headers, opts?.sampleRows || [], entity);

    // Merge: heuristic first, then LLM fills gaps (don’t overwrite good heuristic matches),
    // then explicit overrides (if provided) win last.
    merged = {
      uniqueKey: heur.uniqueKey || llm.uniqueKey,
      fields: { ...heur.fields, ...llm.fields },
    };
    source = 'llm+heuristic';
  }

  if (opts?.overrides) {
    merged.fields = { ...merged.fields, ...opts.overrides };
  }

  return { uniqueKey: merged.uniqueKey, fields: merged.fields, source };
}

/**
 * Apply a resolved mapping to a given row.
 */
export function applyMapping(row: Record<string, any>, map: { fields: Record<string, string | undefined> }) {
  const out: Record<string, any> = {};
  const fields = map?.fields || {};
  for (const [dst, src] of Object.entries(fields)) {
    if (!src) continue;
    out[dst] = row[src];
  }
  return out;
}
