import { embedText } from '../ai/embeddings.js';
import { similarRows } from '../vector/pgvector.js';
import { getDb } from '../db/index.js';

export async function findSimilarRowsForText(store_id: string, text: string, limit = 5) {
  const db = getDb()!;
  const emb = await embedText(text);
  const hits = await similarRows(db, emb, limit);
  // Join to raw rows (and filter by store_id)
  const ids = hits.map(h => h.sheet_row_id);
  if (ids.length === 0) return [];
  const rows = await db('sheet_rows_raw')
    .whereIn('id', ids)
    .andWhereIn('store_sheet_id',
      db('store_sheets').select('id').where({ store_id })
    );
  // decorate with distance
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  return hits.map(h => ({ dist: h.dist, row: byId.get(h.sheet_row_id) })).filter(x => x.row);
}
