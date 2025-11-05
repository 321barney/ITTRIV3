// backend/src/utils/conversations.ts
import type { Knex } from 'knex';
import { maskPII } from './pii.js';

type ConversationRow = {
  id: string;
  store_id: string;
  customer_id: string | null;
  origin: string | null;
  status: string | null;
  meta_json: any | null;
  created_at: Date | string;
  updated_at: Date | string;
  order_id?: string | null; // may exist (new schema)
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: string | null; // enforce null (never undefined)
  meta_json: any | null;
  created_at: Date | string;
};

export async function conversationsForOrder(
  db: Knex,
  storeId: string,
  orderId: string
): Promise<Array<ConversationRow & { messages: MessageRow[] }>> {
  let conversations: ConversationRow[] = [];
  try {
    conversations = await db<ConversationRow>('conversations')
      .select(
        'id',
        'store_id',
        'customer_id',
        'origin',
        'status',
        'meta_json',
        'created_at',
        'updated_at',
        'order_id'
      )
      .where({ store_id: storeId, order_id: orderId })
      .orderBy('created_at', 'desc');
  } catch {
    // Fallback schema: order_id inside meta_json
    conversations = await db<ConversationRow>('conversations')
      .select(
        'id',
        'store_id',
        'customer_id',
        'origin',
        'status',
        'meta_json',
        'created_at',
        'updated_at'
      )
      .where({ store_id: storeId })
      .whereRaw(`(meta_json->>'order_id') = ?`, [orderId])
      .orderBy('created_at', 'desc');
  }

  return attachMessages(db, conversations);
}

/** Recent conversations linked to any order (supports both schemas). */
export async function listRecentStoreConversationsLinkedToOrders(
  db: Knex,
  storeId: string,
  limit = 20,
  offset = 0
): Promise<Array<ConversationRow & { messages: MessageRow[] }>> {
  try {
    const rows = await db<ConversationRow>('conversations as c')
      .select(
        'c.id',
        'c.store_id',
        'c.customer_id',
        'c.origin',
        'c.status',
        'c.meta_json',
        'c.created_at',
        'c.updated_at',
        'c.order_id'
      )
      .where('c.store_id', storeId)
      .whereNotNull('c.order_id') // typed, supported
      .orderBy('c.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return attachMessages(db, rows);
  } catch {
    // Fallback schema: order_id inside meta_json
    const rows = await db<ConversationRow>('conversations as c')
      .select(
        'c.id',
        'c.store_id',
        'c.customer_id',
        'c.origin',
        'c.status',
        'c.meta_json',
        'c.created_at',
        'c.updated_at',
        db.raw<string>("(c.meta_json->>'order_id') as order_id")
      )
      .where('c.store_id', storeId)
      .whereRaw("(c.meta_json->>'order_id') IS NOT NULL")
      .orderBy('c.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return attachMessages(db, rows);
  }
}

async function attachMessages(
  db: Knex,
  convos: ConversationRow[]
): Promise<Array<ConversationRow & { messages: MessageRow[] }>> {
  const ids = convos.map((c) => c.id);

  // Allow content possibly being undefined at fetch-time; normalize later.
  const msgs: Array<Omit<MessageRow, 'content'> & { content?: string | null }> =
    ids.length
      ? await db<MessageRow>('messages')
          .select('id', 'conversation_id', 'role', 'content', 'meta_json', 'created_at')
          .whereIn('conversation_id', ids)
          .orderBy('created_at', 'asc')
      : [];

  const byConvo: Record<string, MessageRow[]> = {};
  for (const m of msgs) {
    // Normalize undefined -> null, then mask if present
    const raw: string | null = m.content ?? null;
    const masked = raw === null ? null : (maskPII(raw) ?? null);
    (byConvo[m.conversation_id] ||= []).push({
      ...m,
      content: masked, // MessageRow enforces string | null
    });
  }

  return convos.map((c) => ({ ...c, messages: byConvo[c.id] || [] }));
}
