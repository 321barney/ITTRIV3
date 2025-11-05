// src/utils/sheetsCsv.ts
import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

class SheetCsvError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

/** Extract <id> and optional <gid> from any Google Sheets URL. */
function extractSheetIdAndGid(input: string): { id?: string; gid?: string; raw: string } {
  try {
    const u = new URL(input);
    const m = u.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    const id = m?.[1];
    const hashGid = (u.hash || '').match(/gid=(\d+)/)?.[1];
    const qGid = u.searchParams.get('gid') || undefined;
    const gid = hashGid || qGid;
    return { id, gid, raw: input };
  } catch {
    return { raw: input };
  }
}

/** Build several candidate CSV URLs so we can try them in order. */
function buildCandidateCsvUrls(input: string): string[] {
  const { id, gid, raw } = extractSheetIdAndGid(input);
  if (!id) return [raw]; // not a gsheet link—use as-is

  const urls: string[] = [];

  // Official export endpoint
  const baseExport = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  if (gid) urls.push(`${baseExport}&gid=${gid}`);
  urls.push(baseExport); // first sheet

  // Publish-to-web endpoint
  const basePub = `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv`;
  if (gid) urls.push(`${basePub}&gid=${gid}`);
  urls.push(basePub);

  // gviz CSV endpoint (surprisingly reliable in some cases)
  const baseGviz = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  if (gid) urls.push(`${baseGviz}&gid=${gid}`);
  urls.push(baseGviz);

  // Legacy form (same as export, but some proxies differ)
  const baseFeed = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  if (gid) urls.push(`${baseFeed}&gid=${gid}`);

  return Array.from(new Set(urls)); // dedupe
}

function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().slice(0, 240).toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}

/**
 * Fetch CSV text with resilient retries and a stable User-Agent to avoid bot blocks.
 * - Retries up to 3 times with exponential backoff on 429/5xx
 * - Adds Accept and UA headers to reduce HTML interstitials
 */
async function fetchCsvText(url: string): Promise<string> {
  const headers = {
    'accept': 'text/csv, text/plain;q=0.9, */*;q=0.8',
    'user-agent': 'ITTRI-Ingest/1.0 (+https://ittri.local)'
  } as Record<string, string>;

  const attemptOnce = async () => {
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new SheetCsvError('http_error', `HTTP ${res.status}`);
    return await res.text();
  };

  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await attemptOnce();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || '');
      if (/HTTP (429|5\d\d)/.test(msg)) {
        const delay = 300 * Math.pow(2, i); // 300ms, 600ms, 1200ms
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break; // non-retryable
    }
  }
  throw lastErr || new SheetCsvError('http_error', 'failed_to_fetch_csv');
}

/** Try a list of delimiters if autodetect yields suspicious results. */
function parseWithDelimiters(text: string, delimiters: (string | undefined)[]): string[][] {
  for (const delim of delimiters) {
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      delimiter: delim, // undefined → autodetect
    });
    const rows = (parsed.data || []) as string[][];
    // Heuristic: if we only ever got 1 column but the line clearly has separators, try next delimiter
    const firstNonEmpty = rows.find((r) => (r || []).some((c) => String(c ?? '').trim() !== '')) || [];
    const joined = firstNonEmpty.join('');
    const hasSemis = /;/.test(text.slice(0, 2048));
    const hasTabs = /\t/.test(text.slice(0, 2048));
    const obviouslySplit = firstNonEmpty.length > 1 || (!joined && rows.length > 1);

    if (obviouslySplit) return rows;
    if (delim === ';' && firstNonEmpty.length > 1) return rows;
    if (delim === '\t' && firstNonEmpty.length > 1) return rows;

    // If we used autodetect and only got 1 col but the file has semicolons/tabs, keep trying
    if (delim === undefined && firstNonEmpty.length <= 1 && (hasSemis || hasTabs)) continue;

    // Accept the best we've got for this delimiter
    if (rows.length) return rows;
  }
  return [];
}

/** Parse CSV building headers ourselves (drops empties/duplicates). */
function parseCsvNoHeader(text: string): CsvRow[] {
  const cleaned = stripBOM(text);
  const rows = parseWithDelimiters(cleaned, [undefined, ',', ';', '\t']);
  if (!rows.length) return [];

  // Pick the first non-empty row as headers
  let headerRowIdx = 0;
  while (
    headerRowIdx < rows.length &&
    (rows[headerRowIdx] ?? []).every((c) => String(c ?? '').trim() === '')
  ) {
    headerRowIdx++;
  }
  if (headerRowIdx >= rows.length) return [];

  const rawHeader = rows[headerRowIdx].map((c) => String(c ?? '').trim());
  const seen = new Set<string>();
  const header: (string | null)[] = rawHeader.map((h) => {
    const key = h.trim();
    if (!key) return null; // drop empty headings
    const norm = key.toLowerCase();
    if (seen.has(norm)) return null; // drop duplicates (keep first)
    seen.add(norm);
    return key;
  });

  const out: CsvRow[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? '').trim() !== '')) continue; // skip blank rows

    const rec: CsvRow = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j];
      if (!key) continue; // dropped column
      rec[key] = String(row[j] ?? '').trim();
    }
    out.push(rec);
  }
  return out;
}

/**
 * Robustly fetch & parse a Google Sheet as CSV.
 * We try multiple endpoints and fall back from gid→first sheet automatically.
 */
export async function fetchCsvRows(urlOrSheet: string): Promise<CsvRow[]> {
  const candidates = buildCandidateCsvUrls(urlOrSheet);

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const text = await fetchCsvText(url);
      if (looksLikeHtml(text)) throw new SheetCsvError('sheet_or_gid_not_found', 'HTML response (likely permission/unpublished).');

      const rows = parseCsvNoHeader(text);
      return rows;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  const err =
    lastErr instanceof SheetCsvError
      ? lastErr
      : new SheetCsvError('sheet_or_gid_not_found', String((lastErr as any)?.message || lastErr));
  throw err;
}

/** Convenience for code that only needs a “best” CSV URL. */
export function toCsvExportUrl(input: string): string {
  const list = buildCandidateCsvUrls(input);
  return list[0] || input;
}
