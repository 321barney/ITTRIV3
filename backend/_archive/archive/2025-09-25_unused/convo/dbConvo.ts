import type { Knex } from 'knex';

export async function findOrCreateConversation(
  db: Knex,
  store_id: string,
  customer_id: string | null,
  origin: 'whatsapp' | 'webchat' | 'email' = 'whatsapp'
) {
  const existing = await db('conversations')
    .where({ store_id, origin, status: 'open' })
    .modify(q => { if (customer_id) q.andWhere({ customer_id }); })
    .orderBy('created_at','desc')
    .first()
    .catch(() => null);

  if (existing) return existing;

  const [conv] = await db('conversations')
    .insert({ store_id, customer_id, origin, status: 'open', meta_json: {} })
    .returning('*');

  return conv;
}

export async function saveTurn(
  db: Knex,
  conversation_id: string,
  role: 'user'|'assistant'|'system'|'agent',
  content: string,
  meta?: any
) {
  const [msg] = await db('messages')
    .insert({ conversation_id, role, content, meta_json: meta ?? null })
    .returning('*');
  return msg;
}
