// src/utils/whatsapp.ts
import type { Knex } from 'knex';

export function isWhatsAppEnvConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
}

export async function pickWhatsAppForStore(knex: Knex, store_id: string) {
  // Prefer per-store channel in `channels` table
  const ch = await knex('channels')
    .where({ store_id, provider: 'whatsapp', status: 'active' })
    .orderBy('updated_at', 'desc')
    .first();
  if (ch) return ch;

  // Fallback to env-only single-tenant mode
  if (isWhatsAppEnvConfigured()) {
    return {
      id: 'env',
      seller_id: null,
      provider: 'whatsapp',
      credentials_json: {
        access_token: process.env.WHATSAPP_TOKEN,
        phone_number_id: process.env.WHATSAPP_PHONE_ID,
      },
      status: 'active',
      enabled: true,
    };
  }
  return null;
}
