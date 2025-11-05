// src/env.ts
import 'dotenv/config';
import { z } from 'zod';

/** bool parser: accepts true/false and common string variants */
const bool = z.union([z.boolean(), z.string()]).transform(v =>
  typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : v
);

/** URL validator that only allows http/https */
const Url = z
  .string()
  .refine((s) => {
    try {
      const u = new URL(s);
      return ['http:', 'https:'].includes(u.protocol);
    } catch {
      return false;
    }
  }, { message: 'Invalid URL' });

/** trims optional quotes and decodes percent-encoding (if present) */
function cleanQuoted(s?: string) {
  if (!s) return s;
  let out = s.trim().replace(/^['"]|['"]$/g, '');
  if (/%[0-9A-Fa-f]{2}/.test(out)) {
    try { out = decodeURIComponent(out); } catch { /* ignore */ }
  }
  return out.replace(/^['"]|['"]$/g, '');
}

const schema = z.object({
  // ── Runtime basics ──────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['production', 'staging', 'development', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().positive().max(65535).default(7001),

  // ── Canonical ITTRI / Ollama via Traefik ───────────────────────────────────
  ITTRI_BASE_URL: z.string().transform(cleanQuoted).pipe(Url).optional(), // e.g. https://srv1028.../ (Traefik)
  ITTRI_ROUTE_PREFIX: z.string().default('/api'),
  ITTRI_USERNAME: z.string().optional(),         // Traefik Basic Auth user
  ITTRI_PASSWORD: z.string().optional(),         // Traefik Basic Auth password
  ITTRI_MODEL: z.string().default('ITTRI'),
  ITTRI_STREAM: bool.default(false as any),
  ITTRI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  ITTRI_MAX_TOKENS: z.coerce.number().int().min(0).default(0), // 0 → let server decide
  ITTRI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  ITTRI_VERIFY_TLS: bool.default(true as any),
  ITTRI_CA_CERT_PATH: z.string().optional(),     // optional custom CA bundle path

  // ── Legacy / back-compat inputs (used only if canonical unset) ─────────────
  // If these are present and ITTRI_BASE_URL is missing, we'll use them.
  OLLAMA_URL: z.string().transform(cleanQuoted).pipe(Url).optional(), // ex: http://127.0.0.1:11434
  OLLAMA_MODEL: z.string().optional(),

  // ── App backends & integrations ────────────────────────────────────────────
  BACKEND_URL: z.string().transform(cleanQuoted).pipe(Url).default('http://127.0.0.1:8000'),
  BACKEND_TOKEN: z.string().optional(),

  N8N_URL: z.string().optional().transform(cleanQuoted).optional(),
  N8N_TOKEN: z.string().optional(),

  // Shared proxy token your API Gateway may enforce
  PROXY_TOKEN: z.string().default('dev-token'),

  // CORS allowlist (csv)
  ALLOWED_ORIGINS: z.string().optional(),
})
.transform((v) => {
  // ── CORS set (defaults + additional from env)
  const cors = new Set<string>([
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'http://localhost:5173', 'http://127.0.0.1:5173',
  ]);
  if (v.ALLOWED_ORIGINS) {
    v.ALLOWED_ORIGINS.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(s => cors.add(s));
  }

  // ── Canonicalize AI base URL with back-compat fallbacks
  const base =
    v.ITTRI_BASE_URL ??
    v.OLLAMA_URL ??                 // legacy
    'http://127.0.0.1:11434';       // final dev fallback

  const prefix = v.ITTRI_ROUTE_PREFIX || '/api';
  const trim = (s: string) => s.replace(/\/+$/,'');
  const baseTrimmed = trim(base);
  const tagsUrl = `${baseTrimmed}${prefix}/tags`;
  const generateUrl = `${baseTrimmed}${prefix}/generate`;

  // Model & options (back-compat for OLLAMA_MODEL)
  const model = v.ITTRI_MODEL || v.OLLAMA_MODEL || 'ITTRI';
  const stream = !!v.ITTRI_STREAM;
  const temperature = v.ITTRI_TEMPERATURE;
  const num_predict = v.ITTRI_MAX_TOKENS > 0 ? v.ITTRI_MAX_TOKENS : undefined;
  const timeoutMs = v.ITTRI_TIMEOUT_MS;

  // Basic Auth header for Traefik (optional)
  const authHeader = (v.ITTRI_USERNAME && v.ITTRI_PASSWORD)
    ? 'Basic ' + Buffer.from(`${v.ITTRI_USERNAME}:${v.ITTRI_PASSWORD}`).toString('base64')
    : undefined;

  return {
    ...v,
    cors: Array.from(cors),
    ai: {
      base: baseTrimmed,
      prefix,
      tagsUrl,
      generateUrl,
      model,
      stream,
      temperature,
      num_predict,
      timeoutMs,
      verifyTLS: v.ITTRI_VERIFY_TLS,
      caCertPath: v.ITTRI_CA_CERT_PATH,
      authHeader, // include in fetch headers if present
    },
  } as const;
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Convenience helper if you prefer a function */
export function ittriAuthHeader(): Record<string, string> {
  return env.ai.authHeader ? { Authorization: env.ai.authHeader } : {};
}
