import { chatCompletion } from '../ai/ollamaClient.js';

type NormItem = { sku?: string; title?: string; qty?: number; price?: number; currency?: string };
export type NormalizedOrder = {
  external_key: string;
  customer: { name?: string; phone?: string; email?: string } | null;
  items: NormItem[];
  total?: number | null;
  currency?: string | null;
  notes?: string | null;
};

export async function normalizeRowLLM(row: Record<string, any>, opts: {
  storeName?: string;
  model?: string;
}) : Promise<NormalizedOrder> {
  const model = opts.model || process.env.OLLAMA_MODEL || 'ittri';
  const textView = Object.entries(row)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');

  const sys = [
    `You are ITTRI, a commerce extractor.`,
    `Given a single spreadsheet row, output STRICT JSON for an ecommerce order.`,
    `Keys: external_key (string from any order id like reference),`,
    `customer {name, phone, email}, items[{sku,title,qty,price,currency}], total (number|null), currency (string|null), notes (string|null).`,
    `Prefer digits from phone fields. Parse qty/price integers/floats. If missing, leave null or defaults.`,
    `Do NOT add commentary; return only JSON.`,
  ].join(' ');

  const user = `Store: ${opts.storeName || 'Unknown'}\nRow:\n${textView}`;

  const { text } = await chatCompletion({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
  });

  // Safe parse: if LLM returns garbage, fallback minimal shape
  try {
    const parsed = JSON.parse(text);
    const norm: NormalizedOrder = {
      external_key: String(parsed.external_key ?? ''),
      customer: parsed.customer ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      total: parsed.total ?? null,
      currency: parsed.currency ?? null,
      notes: parsed.notes ?? null
    };
    // Coerce qty/price
    norm.items = norm.items.map((it: any) => ({
      sku: it?.sku ?? undefined,
      title: it?.title ?? undefined,
      qty: Number.isFinite(Number(it?.qty)) ? Number(it.qty) : 1,
      price: Number.isFinite(Number(it?.price)) ? Number(it.price) : undefined,
      currency: it?.currency ?? norm.currency ?? undefined
    }));
    return norm;
  } catch {
    return {
      external_key: String(row.order_id || row.id || row.reference || ''),
      customer: null,
      items: [],
      total: null,
      currency: null,
      notes: null
    };
  }
}
