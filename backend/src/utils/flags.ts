/**
 * Centralized feature flags & intervals.
 * Booleans accept: "1" | "true" | "yes" | "y" | "on" (case-insensitive).
 */

function boolFromEnv(name: string, defaultValue = false): boolean {
  const v = process.env[name];
  if (v == null) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
}

function intFromEnv(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

/* ---------------- Core worker / ingest flags ---------------- */

export const RUN_WORKERS: boolean = (() => {
  if (process.env.RUN_WORKERS != null) return boolFromEnv('RUN_WORKERS', false);
  return process.env.NODE_ENV === 'development';
})();

export const INGEST_ENABLED: boolean = boolFromEnv('INGEST_ENABLED', true);
export const SCAN_ON_BOOT: boolean = boolFromEnv('SCAN_ON_BOOT', true);
export const SCAN_INTERVAL_MS: number = intFromEnv('SCAN_INTERVAL_MS', 60000);
export const INGEST_ACCEPT_UPLOAD: boolean = boolFromEnv('INGEST_ACCEPT_UPLOAD', true);
export const INGEST_ACCEPT_URL: boolean = boolFromEnv('INGEST_ACCEPT_URL', true);
export const INGEST_SELF_KICK: boolean = boolFromEnv('INGEST_SELF_KICK', false);

export const FLAGS = {
  RUN_WORKERS,
  INGEST_ENABLED,
  SCAN_ON_BOOT,
  SCAN_INTERVAL_MS,
  INGEST_ACCEPT_UPLOAD,
  INGEST_ACCEPT_URL,
  INGEST_SELF_KICK,
};

/* ---------------- Conversation worker flags ---------------- */

export const CONVO_ENABLED: boolean = boolFromEnv('CONVO_ENABLED', true);
export const CONVO_SCAN_ON_BOOT: boolean = boolFromEnv('CONVO_SCAN_ON_BOOT', true);
export const CONVO_SCAN_INTERVAL_MS: number = intFromEnv('CONVO_SCAN_INTERVAL_MS', 60_000);

/* ---------------- WhatsApp (ENV-only, with noop fallback) ---------------- */

/** Master toggle for WhatsApp features (default: true). */
export const WHATSAPP_ENABLED: boolean = boolFromEnv('WHATSAPP_ENABLED', true);

/** Check if ENV has the WhatsApp Cloud API credentials. */
export function isWhatsAppEnvConfigured(): boolean {
  const token = (process.env.WHATSAPP_TOKEN || '').trim();
  const phoneId = (process.env.WHATSAPP_PHONE_ID || '').trim();
  return !!token && !!phoneId;
}

/** Safe accessor for creds (do not log values!). */
export function getWhatsAppCreds():
  | { token: string; phoneNumberId: string }
  | null {
  const token = (process.env.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_ID || '').trim();
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId };
}

/** Final capability decision (no DB lookup; ENV-only). */
export const WHATSAPP_CAN_SEND: boolean =
  WHATSAPP_ENABLED && isWhatsAppEnvConfigured();

/** Delivery mode:
 *  - 'env'  → send via WhatsApp Cloud API using ENV creds
 *  - 'noop' → ENV missing → callers should no-op gracefully
 */
export const WHATSAPP_DELIVERY_MODE: 'env' | 'noop' =
  WHATSAPP_CAN_SEND ? 'env' : 'noop';

export const WHATSAPP_ENV_AVAILABLE: boolean = isWhatsAppEnvConfigured();

export const WHATSAPP_FLAGS = {
  WHATSAPP_ENABLED,
  WHATSAPP_ENV_AVAILABLE,
  WHATSAPP_CAN_SEND,
  WHATSAPP_DELIVERY_MODE,
};
