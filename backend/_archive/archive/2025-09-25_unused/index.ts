
// src/vector/index.ts
import { knex } from '../db/index.js';
export async function ensurePgVector() {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
}
export async function upsertEmbedding(table: string, id: string, embedding: number[]) {
  await ensurePgVector();
  const vector = `[${embedding.join(',')}]`;
  await knex.raw(`
    INSERT INTO ${table} (id, embedding)
    VALUES (?, ?::vector)
    ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding
  `, [id, vector]);
}
