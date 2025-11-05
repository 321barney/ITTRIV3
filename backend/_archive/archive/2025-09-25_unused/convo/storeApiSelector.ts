// Selects the WhatsApp channel for a specific store by joining the store's seller.
// Falls back to the first enabled WhatsApp channel for that seller.
import type { Knex } from 'knex';

export type WhatsAppChannel = {
  id: string;
  seller_id: string;
  provider: string; // e.g. 'meta', 'twilio', 'gupshup'
  credentials_json: any;
  number?: string | null; // if you store it inside credentials_json too
};

export async function getWhatsappForStore(db: Knex, store_id: string): Promise<WhatsAppChannel | null> {
  // 1) Find the store + seller
  const store = await db('stores').select('id','seller_id','name').where({ id: store_id }).first();
  if (!store) return null;

  // 2) Get enabled whatsapp channel(s) for that seller
  const ch = await db('seller_channels')
    .select('id','seller_id','provider','credentials_json')
    .where({ seller_id: store.seller_id, kind: 'whatsapp', enabled: true })
    .orderBy('updated_at','desc')
    .first()
    .catch(() => null);

  if (!ch) return null;

  const creds = ch.credentials_json || {};
  const number = creds.number || creds.phone || null;

  return {
    id: ch.id,
    seller_id: ch.seller_id,
    provider: ch.provider,
    credentials_json: creds,
    number,
  };
}
