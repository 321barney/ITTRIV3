// src/utils/ingest-parse.ts

import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';

export type Parsed = { headers: string[]; rows: Array<Record<string, any>> };

/** Minimal CSV parser (no quoted-field support). Fast and dependency-free. */
function parseCSV(buf: Buffer): Parsed {
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };

  const first = lines[0];
  const delimiter = first.includes(',') ? ',' : first.includes(';') ? ';' : '\t';
  const headers = first.split(delimiter).map((h) => h.trim());

  const rows: Array<Record<string, any>> = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter);
    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => (obj[h] = parts[idx] ?? ''));
    rows.push(obj);
  }
  return { headers, rows };
}

/** XLSX parser — only enabled when INGEST_ENABLE_XLSX=1 (keeps footprint small). */
async function parseXLSX(buf: Buffer): Promise<Parsed> {
  if (!process.env.INGEST_ENABLE_XLSX || process.env.INGEST_ENABLE_XLSX === '0') {
    throw new Error('xlsx_parsing_disabled');
  }
  // Dynamic import + default interop (xlsx is often CJS)
  const mod = await import('xlsx');
  const XLSX: any = (mod as any).default ?? mod;

  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 }) as any[][];
  const headers = (data[0] || []).map((h) => String(h));
  const rows = data.slice(1).map((arr) => {
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => (obj[h] = arr[i]));
    return obj;
  });
  return { headers, rows };
}

/**
 * Async table parser that auto-detects CSV/XLSX by filename extension or contentType.
 * Falls back to CSV if unknown.
 */
export async function parseTableAsync(
  buf: Buffer,
  filename?: string | null,
  contentType?: string | null,
): Promise<Parsed> {
  const ext = (extname(filename || '').toLowerCase()) || '';
  if (contentType?.includes('csv') || ext === '.csv' || !ext) {
    return parseCSV(buf);
  }
  if (ext === '.xlsx' || contentType?.includes('spreadsheetml')) {
    return parseXLSX(buf);
  }
  // default to CSV
  return parseCSV(buf);
}

/**
 * Convenience export to satisfy callers that import { parseTable }.
 * This is just an alias to the async version.
 */
export const parseTable = parseTableAsync;

/**
 * Load a Buffer from either a temporary uploaded file path or a URL.
 * - For uploads, provide { type: 'upload', path }
 * - For URLs, provide { type: 'url', url }
 */
export async function loadBufferFromSource(
  source: { type: 'upload'; path: string } | { type: 'url'; url: string },
): Promise<Buffer> {
  if (source.type === 'upload') {
    return await readFile(source.path);
  }
  // Basic URL fetch (node-fetch)
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`fetch_failed:${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
