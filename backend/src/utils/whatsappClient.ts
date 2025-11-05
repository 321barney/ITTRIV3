// src/utils/whatsappClient.ts
import type { Knex } from 'knex';
import { http } from '../http';

type SendResult = { ok: boolean; id?: string; error?: any };

/** Read ENV creds once (helpers keep code tidy). */
function getEnvCreds() {
  const token = (process.env.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_ID || '').trim();
  return { token, phoneNumberId, isConfigured: !!token && !!phoneNumberId };
}

async function postToWhatsAppAPI(
  url: string,
  token: string,
  body: any
): Promise<any> {
  return http(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    timeoutMs: 15_000,
  });
}

/**
 * Send a plain text message via WhatsApp Cloud API.
 * ENV-only:
 *   - WHATSAPP_TOKEN
 *   - WHATSAPP_PHONE_ID
 * If either is missing, we noop and return a descriptive error.
 */
export async function sendWhatsAppText(
  _knex: Knex,
  _store_id: string,
  toPhoneE164: string,
  body: string
): Promise<SendResult> {
  const { token, phoneNumberId, isConfigured } = getEnvCreds();
  if (!isConfigured) return { ok: false, error: 'whatsapp_noop_env_missing' };

  try {
    const res: any = await postToWhatsAppAPI(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
      token,
      {
        messaging_product: 'whatsapp',
        to: toPhoneE164,
        type: 'text',
        text: { preview_url: false, body },
      }
    );
    return { ok: true, id: res?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Send interactive buttons via WhatsApp Cloud API (ENV-only).
 */
export async function sendWhatsAppChoices(
  _knex: Knex,
  _store_id: string,
  toPhoneE164: string,
  title: string,
  buttons: { id: string; title: string }[]
): Promise<SendResult> {
  const { token, phoneNumberId, isConfigured } = getEnvCreds();
  if (!isConfigured) return { ok: false, error: 'whatsapp_noop_env_missing' };

  try {
    const res: any = await postToWhatsAppAPI(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
      token,
      {
        messaging_product: 'whatsapp',
        to: toPhoneE164,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: title },
          action: {
            buttons: buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      }
    );
    return { ok: true, id: res?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
