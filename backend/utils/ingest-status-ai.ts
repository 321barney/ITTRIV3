// src/utils/ingest-status-ai.ts

/**
 * AI-powered status normalization using OpenAI
 * Falls back to manual mapping if AI fails or API key is missing
 */

import type { RequestInit } from 'node-fetch';

// Cache to avoid repeated API calls for the same status
const statusCache = new Map<string, string>();

const CANONICAL_STATUSES = [
  'new',
  'pending',
  'processing',
  'confirmed',
  'shipped',
  'delivered',
  'completed',
  'canceled',
  'cancelled',
  'refunded',
  'failed',
  'returned',
  'paid'
];

/**
 * Call OpenAI to normalize a status value
 */
async function callOpenAIForStatus(
  rawStatus: string,
  allowedStatuses: string[]
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const { default: fetch } = await import('node-fetch');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const system = `You are a status normalizer for e-commerce orders. 
Map any input status to one of the allowed canonical statuses.
Return ONLY a JSON object: { "status": "<canonical_status>" }
Never invent statuses. Pick the closest match from the allowed list.`;

    const user = JSON.stringify({
      task: 'Normalize this order status',
      raw_status: rawStatus,
      allowed_statuses: allowedStatuses.length > 0 ? allowedStatuses : CANONICAL_STATUSES,
      rules: [
        'Match semantically (e.g., "confirmé" → "confirmed", "livré" → "delivered")',
        'Handle French, English, Arabic transliterations',
        'Handle typos and variations',
        'If uncertain, prefer: confirmed > processing > pending > new',
      ],
    });

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
        max_tokens: 50,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    } as RequestInit);

    if (!res.ok) return null;

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const normalized = parsed?.status?.toLowerCase()?.trim();

    // Validate the response is in allowed list
    if (normalized && allowedStatuses.includes(normalized)) {
      return normalized;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Deterministic status mapping (fallback when AI is unavailable)
const STATUS_CANON_MAP: Record<string, string> = {
  // confirmed
  'confirme': 'confirmed', 'confirmer': 'confirmed', 'confirmé': 'confirmed',
  'confirmee': 'confirmed', 'confirmed': 'confirmed', 'valide': 'confirmed',
  'validé': 'confirmed', 'approved': 'confirmed', 'ok': 'confirmed',
  
  // delivered
  'livre': 'delivered', 'livrer': 'delivered', 'livré': 'delivered',
  'delivered': 'delivered', 'recu': 'delivered', 'reçu': 'delivered',
  
  // canceled
  'annule': 'canceled', 'annuler': 'canceled', 'annulé': 'canceled',
  'cancel': 'canceled', 'cancelled': 'canceled', 'canceled': 'canceled',
  'refuse': 'canceled', 'refusé': 'canceled',
  
  // shipped
  'expedie': 'shipped', 'expedier': 'shipped', 'expédié': 'shipped',
  'envoye': 'shipped', 'envoyé': 'shipped', 'shipped': 'shipped',
  
  // pending / new / processing
  'en attente': 'pending', 'attente': 'pending', 'en cours': 'processing',
  'nouveau': 'new', 'new': 'new', 'pending': 'pending',
  'processing': 'processing', 'unconfirmed': 'pending', 'non confirme': 'pending',
  
  // paid
  'paye': 'paid', 'payé': 'paid', 'paid': 'paid',
  
  // returned
  'retour': 'returned', 'retourne': 'returned', 'retourné': 'returned',
  'returned': 'returned',
  
  // failed
  'echec': 'failed', 'echoue': 'failed', 'échoué': 'failed', 'failed': 'failed',
};

function normalizeText(s: any): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function deterministicNormalize(raw: string, allowedStatuses: Set<string>): string {
  const normalized = normalizeText(raw);
  
  // Try direct canonical mapping
  const canon = STATUS_CANON_MAP[normalized];
  if (canon && allowedStatuses.has(canon)) {
    return canon;
  }
  
  // Fallback: prefer common statuses
  const pick = (...opts: string[]) => opts.find(o => allowedStatuses.has(o));
  
  if (canon) {
    switch (canon) {
      case 'confirmed': return pick('processing', 'completed', 'new') || Array.from(allowedStatuses)[0] || 'new';
      case 'delivered': return pick('completed', 'processing', 'new') || Array.from(allowedStatuses)[0] || 'new';
      case 'canceled': return pick('cancelled', 'refunded', 'new') || Array.from(allowedStatuses)[0] || 'new';
      case 'shipped': return pick('processing', 'completed', 'new') || Array.from(allowedStatuses)[0] || 'new';
      case 'paid': return pick('processing', 'completed', 'new') || Array.from(allowedStatuses)[0] || 'new';
      case 'pending': return pick('pending', 'new') || Array.from(allowedStatuses)[0] || 'new';
      default: return pick('new', 'pending') || Array.from(allowedStatuses)[0] || 'new';
    }
  }
  
  // Final fallback
  return pick('new', 'pending') || Array.from(allowedStatuses)[0] || 'new';
}

/**
 * Normalize status using AI with deterministic fallback
 * @param rawStatus - The raw status from the sheet
 * @param allowedStatuses - Set of allowed status values from DB schema
 * @param enableAI - Whether to use AI (default: true if OPENAI_API_KEY exists)
 */
export async function normalizeStatusWithAI(
  rawStatus: any,
  allowedStatuses: Set<string>,
  enableAI: boolean = !!process.env.OPENAI_API_KEY
): Promise<string> {
  const raw = String(rawStatus ?? 'new').trim().toLowerCase();
  const allowed = Array.from(allowedStatuses);

  // Fast path: already valid
  if (allowedStatuses.has(raw)) return raw;

  // Check cache
  const cacheKey = `${raw}:${allowed.join(',')}`;
  if (statusCache.has(cacheKey)) {
    return statusCache.get(cacheKey)!;
  }

  let result: string | null = null;

  // Try AI normalization first if available
  if (enableAI && process.env.OPENAI_API_KEY) {
    try {
      result = await callOpenAIForStatus(raw, allowed);
    } catch {
      // Silent fail, will use deterministic fallback
    }
  }

  // CRITICAL: Use deterministic mapping as fallback (preserves existing behavior)
  if (!result) {
    result = deterministicNormalize(raw, allowedStatuses);
  }

  // Cache the result
  statusCache.set(cacheKey, result);

  return result;
}

/**
 * Batch normalize multiple statuses (for efficiency)
 */
export async function batchNormalizeStatuses(
  rawStatuses: string[],
  allowedStatuses: Set<string>
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const unique = [...new Set(rawStatuses)];

  // Process in parallel with max concurrency
  const MAX_CONCURRENT = 5;
  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const batch = unique.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map((raw) => normalizeStatusWithAI(raw, allowedStatuses));
    const normalized = await Promise.all(promises);
    batch.forEach((raw, idx) => results.set(raw, normalized[idx]));
  }

  return results;
}

/**
 * Clear the status cache (useful for testing or after config changes)
 */
export function clearStatusCache() {
  statusCache.clear();
}
