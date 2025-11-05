import { embedTexts } from '../../ai/embeddings';
import { upsertProductEmbeddings } from '../../vector/pgvector';

export async function indexProductsForSearch(rows: Array<{ id: string; name: string; description?: string }>) {
  if (!rows?.length) return;
  const texts = rows.map((r) => `${r.name}\n\n${r.description ?? ''}`.trim());
  const embs = await embedTexts(texts);
  await upsertProductEmbeddings(rows.map((r, i) => ({ product_id: r.id, embedding: embs[i] })));
}
