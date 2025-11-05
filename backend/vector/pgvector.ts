import type { Knex } from 'knex';

export async function insertEmbedding(db: Knex, sheet_row_id: string, emb: number[]) {
  // pgvector expects array -> vector, use parameter binding
  // NOTE: knex doesn't know vector type; use db.raw
  const placeholders = emb.map((_, i) => `$${i + 2}`).join(',');
  const sql = `
    INSERT INTO sheet_row_embeddings (sheet_row_id, embedding)
    VALUES ($1, vector[${placeholders}])
    ON CONFLICT (sheet_row_id) DO UPDATE SET embedding = EXCLUDED.embedding
    RETURNING id
  `;
  const params: any[] = [sheet_row_id, ...emb];
  const r = await db.raw(sql, params as any);
  return r?.rows?.[0]?.id ?? null;
}

export async function similarRows(
  db: Knex,
  emb: number[],
  limit = 5
): Promise<{ sheet_row_id: string; dist: number }[]> {
  const placeholders = emb.map((_, i) => `$${i + 1}`).join(',');
  const sql = `
    SELECT sheet_row_id, (embedding <-> vector[${placeholders}]) AS dist
    FROM sheet_row_embeddings
    ORDER BY embedding <-> vector[${placeholders}]
    LIMIT ${limit}
  `;
  const params: any[] = [...emb, ...emb];
  const r = await db.raw(sql, params as any);
  return r?.rows?.map((x: any) => ({ sheet_row_id: x.sheet_row_id, dist: Number(x.dist) })) ?? [];
}
