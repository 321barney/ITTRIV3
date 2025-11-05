import { z } from 'zod';
import { ProductV1 } from './normalize/product';
import { indexProductsForSearch } from './loaders/vector';
import { upsertProduct } from '../graph/neo4j';

export const IngestJob = z.object({
  source: z.enum(['google_sheet','csv','shopify']),
  uri: z.string(),
  options: z.record(z.any()).optional(),
});
export type IngestJob = z.infer<typeof IngestJob>;

// Placeholder extractors: replace with real implementations
async function extractProducts(job: IngestJob): Promise<any[]> {
  // TODO: implement google sheets / csv / shopify readers
  // Returning an empty array so pipeline is safe by default
  return [];
}

export async function startIngestJob(job: IngestJob) {
  const parsed = IngestJob.parse(job);
  const raw = await extractProducts(parsed);
  const normalized = raw.map((r) => ProductV1.parse(r));
  // Load: neo4j and vector index
  for (const p of normalized) {
    await upsertProduct({ id: p.id, name: p.name, price: p.price, category: p.category ?? null });
  }
  await indexProductsForSearch(normalized.map((p) => ({ id: p.id, name: p.name, description: p.description })));
  return { id: `ingest_${Date.now()}`, count: normalized.length };
}
