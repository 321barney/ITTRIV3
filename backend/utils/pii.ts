// backend/src/utils/pii.ts
/* eslint-disable no-control-regex */

// ---------- Precompiled patterns ----------
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RE_EMAIL_FREE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

// phones: allow spaces, dashes, dots, parentheses; require ≥6 digits overall
const RE_PHONE_FREE = /(?:(?:\+|00)?\d[\d\-\s().]{5,}\d)/g;

// cc digits (13–19) – later we Luhn-check before masking
const RE_DIGIT_RUN_13_19 = /\b(?:\d[ -]?){13,19}\b/g;

// IBAN (2 letters + 2 digits + up to 30 alnum), keep country+check, mask middle
const RE_IBAN = /\b([A-Z]{2}\d{2})([A-Z0-9]{4,28})([A-Z0-9]{2})\b/gi;

// URL query params that look sensitive
const SENSITIVE_QUERY_KEYS = new Set([
  'email','user_email','customer_email',
  'phone','phone_number','whatsapp','contact','to',
  'token','access_token','refresh_token','api_key','key',
  'password','pass','secret',
]);

// ---------- Helpers ----------
function onlyDigits(s: string) { return s.replace(/\D+/g, ''); }

function luhnCheck(num: string): boolean {
  let sum = 0, dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function maskMiddle(s: string, keepLeft: number, keepRight: number, mask = '*'): string {
  if (s.length <= keepLeft + keepRight) return mask.repeat(Math.max(1, s.length - 1));
  return s.slice(0, keepLeft) + mask.repeat(s.length - keepLeft - keepRight) + s.slice(-keepRight);
}

function maskPhoneFormat(s: string): string {
  // keep country/first 3 visible, last 2 visible
  const digits = onlyDigits(s);
  if (digits.length < 6) return s;
  const maskedDigits = maskMiddle(digits, 3, 2);
  // reinsert separators approximately
  let out = '', j = 0;
  for (const ch of s) out += /\d/.test(ch) ? maskedDigits[j++] : ch;
  return out;
}

function tryMaskUrlQuery(text: string): string {
  try {
    const u = new URL(text);
    let changed = false;
    for (const [k, v] of u.searchParams.entries()) {
      if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
        u.searchParams.set(k, maskPII(v) ?? '*');
        changed = true;
      }
    }
    return changed ? u.toString() : text;
  } catch {
    return text; // not a full URL, ignore
  }
}

// ---------- Public API ----------
export function maskPII(v: string | undefined | null): string | undefined | null {
  if (v == null) return v;
  const s = String(v).trim();
  if (!s) return s;

  // Email
  if (RE_EMAIL.test(s)) {
    const [local, domain] = s.split('@');
    const maskedLocal = local.length <= 2 ? '*' : maskMiddle(local, 1, 1);
    return `${maskedLocal}@${domain}`;
  }

  // Phone-like (strip non-digits, require ≥6)
  const digits = onlyDigits(s);
  if (digits.length >= 6) return maskPhoneFormat(s);

  // Credit card or long digit run
  const digitsLong = digits.length >= 13 && digits.length <= 19 ? digits : null;
  if (digitsLong && luhnCheck(digitsLong)) {
    return maskMiddle(s, Math.max(0, s.length - 4), 4); // keep last 4
  }

  // IBAN inline (not a strict IBAN validator, just mask)
  const iban = s.match(RE_IBAN);
  if (iban) {
    return s.replace(RE_IBAN, (_m, a: string, mid: string, z: string) => `${a}${'*'.repeat(mid.length)}${z}`);
  }

  // URL with sensitive query params
  const maybeUrl = tryMaskUrlQuery(s);
  if (maybeUrl !== s) return maybeUrl;

  // Generic fallback
  if (s.length > 8) return maskMiddle(s, 4, 0);
  if (s.length > 4) return maskMiddle(s, 2, 0);
  return '*';
}

// Deep redaction with cycle safety & depth cap
const DEFAULT_KEYS = new Set([
  'email','user_email','customer_email',
  'phone','phone_number','customer_phone',
  'whatsapp','contact','to',
  'token','access_token','refresh_token','api_key','key',
  'password','pass','secret',
]);

export function redactObject<T = any>(
  obj: T,
  opts?: { extraKeys?: string[]; depth?: number }
): T {
  const keys = new Set([...DEFAULT_KEYS, ...(opts?.extraKeys ?? [])].map(k => k.toLowerCase()));
  const maxDepth = Math.max(1, opts?.depth ?? 6);
  const seen = new WeakSet<object>();

  const walk = (val: any, depth: number): any => {
    if (val == null) return val;
    if (typeof val !== 'object') return val;
    if (seen.has(val)) return '[Circular]';
    if (depth > maxDepth) return '[Truncated]';
    seen.add(val);

    if (Array.isArray(val)) return val.map(v => walk(v, depth + 1));

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (keys.has(k.toLowerCase())) {
        out[k] = typeof v === 'string' ? maskPII(v) : (v == null ? v : '[redacted]');
      } else if (typeof v === 'string') {
        // scrub strings for embedded emails/phones/cards/ibans/urls
        out[k] = scrubFreeText(v);
      } else {
        out[k] = walk(v, depth + 1);
      }
    }
    return out;
  };

  return walk(obj, 0) as T;
}

// Scrubs PII in free text (best-effort, safe for logs)
export function scrubFreeText(s: string): string {
  if (!s) return s;

  // Emails
  let t = s.replace(RE_EMAIL_FREE, (_m, local, domain) => {
    const maskedLocal = local.length <= 2 ? '*' : maskMiddle(local, 1, 1);
    return `${maskedLocal}@${domain}`;
  });

  // Phones
  t = t.replace(RE_PHONE_FREE, (m) => maskPhoneFormat(m));

  // Credit cards (only if Luhn passes)
  t = t.replace(RE_DIGIT_RUN_13_19, (m) => {
    const digits = onlyDigits(m);
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      // keep last 4
      return m.replace(/\d(?=(?:\D*\d){4})/g, '*');
    }
    return m;
  });

  // IBAN
  t = t.replace(RE_IBAN, (_m, a: string, mid: string, z: string) => `${a}${'*'.repeat(mid.length)}${z}`);

  // URLs with sensitive query params
  t = t.replace(/\bhttps?:\/\/[^\s)]+/gi, (url) => tryMaskUrlQuery(url));

  return t;
}

export default { maskPII, redactObject, scrubFreeText };
