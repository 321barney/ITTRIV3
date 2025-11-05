// src/api/routes/ai/_chatDb.ts
import type { Knex } from 'knex';

/** Cache of column presence by table */
const COL_CACHE: Record<string, boolean> = {};

async function hasColumn(db: Knex, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (COL_CACHE[key] !== undefined) return COL_CACHE[key];
  try {
    const row = await db
      .select(
        db.raw(`EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ?
            AND column_name = ?
        ) as has_col`, [table, column])
      )
      .first();
    COL_CACHE[key] = !!(row as any)?.has_col;
  } catch {
    COL_CACHE[key] = false;
  }
  return COL_CACHE[key];
}

async function hasStatusColumn(db: Knex): Promise<boolean> {
  return hasColumn(db, 'ai_chat_sessions', 'status');
}

async function metaColumnForSessions(db: Knex): Promise<'meta_json' | 'metadata'> {
  return (await hasColumn(db, 'ai_chat_sessions', 'meta_json')) ? 'meta_json' : 'metadata';
}
async function metaColumnForMessages(db: Knex): Promise<'meta_json' | 'metadata'> {
  return (await hasColumn(db, 'ai_chat_messages', 'meta_json')) ? 'meta_json' : 'metadata';
}

export async function ensureSession(
  db: Knex,
  sellerId: string,
  opts?: { storeId?: string | null; title?: string | null; sessionId?: string | null }
): Promise<string> {
  const { sessionId, storeId = null, title = null } = opts || {};
  const hasStatus = await hasStatusColumn(db);
  const metaCol = await metaColumnForSessions(db);

  if (sessionId) {
    const row = await db('ai_chat_sessions')
      .where({ id: sessionId, seller_id: sellerId })
      .first('id');
    if ((row as any)?.id) return (row as any).id as string;
  }

  // reuse most recent; prefer 'open' when available
  const base = db('ai_chat_sessions')
    .where({ seller_id: sellerId })
    .orderBy('created_at', 'desc')
    .first('id');

  const existing = hasStatus ? await base.clone().where({ status: 'open' }) : await base;
  if ((existing as any)?.id) return (existing as any).id as string;

  // create new
  const insertPayload: any = {
    seller_id: sellerId,
    store_id: storeId,
    title,
  };
  insertPayload[metaCol] = {};
  if (hasStatus) insertPayload.status = 'open';

  const [created] = await db('ai_chat_sessions').insert(insertPayload).returning(['id']);
  return (created as any).id as string;
}

export async function appendUserMessage(
  db: Knex,
  sessionId: string,
  content: string,
  meta?: Record<string, any>
) {
  const metaCol = await metaColumnForMessages(db);
  const payload: any = {
    session_id: sessionId,
    role: 'user',
    content,
  };
  payload[metaCol] = meta ?? {};

  const [row] = await db('ai_chat_messages')
    .insert(payload)
    .returning(['id', 'role', 'content', metaCol, 'created_at'] as any);

  // Normalize return: always expose row.meta_json for callers
  const out: any = row || {};
  if (metaCol !== 'meta_json') out.meta_json = (row as any)?.[metaCol] ?? {};
  return out;
}

export async function appendAssistantMessage(
  db: Knex,
  sessionId: string,
  content: string,
  meta?: Record<string, any>
) {
  const metaCol = await metaColumnForMessages(db);
  const payload: any = {
    session_id: sessionId,
    role: 'assistant',
    content,
  };
  payload[metaCol] = meta ?? {};

  const [row] = await db('ai_chat_messages')
    .insert(payload)
    .returning(['id', 'role', 'content', metaCol, 'created_at'] as any);

  const out: any = row || {};
  if (metaCol !== 'meta_json') out.meta_json = (row as any)?.[metaCol] ?? {};
  return out;
}
