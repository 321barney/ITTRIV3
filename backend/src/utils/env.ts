// src/config/env.ts
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform(v => (typeof v === 'string' ? ['1','true','yes','on'].includes(v.toLowerCase()) : v));

const Url = z.string().url().or(z.string().regex(/^http:\/\/localhost(:\d+)?$/i));

const schema = z.object({
  NODE_ENV: z.enum(['production','staging','development','test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required in prod')
    .or(z.literal('')).default(''),
  ALLOW_NON_PROD_DB: bool.default(false),

  // Security
  PROXY_TOKEN: z.string().default('dev-token'),

  // API
  API_PREFIX: z.string().default(''),

  // Ollama / ITTRI
  OLLAMA_URL: Url.default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('ittri'), // your renamed local model

  // n8n (optional)
  N8N_URL: Url.optional(),
  N8N_TOKEN: z.string().optional(),

  // CORS
  FRONTEND_ORIGIN: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
});

const raw = schema.parse(process.env);

// Prod safety: enforce requireds
if (raw.NODE_ENV === 'production' && !raw.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}
if (raw.NODE_ENV === 'production' && (!raw.PROXY_TOKEN || raw.PROXY_TOKEN === 'dev-token')) {
  throw new Error('PROXY_TOKEN must be set to a secure value in production');
}

const allowedOrigins = new Set<string>([
  'http://localhost:3000','http://127.0.0.1:3000',
  'http://localhost:5173','http://127.0.0.1:5173',
  ...(raw.FRONTEND_ORIGIN ? [raw.FRONTEND_ORIGIN] : []),
  ...(raw.ALLOWED_ORIGINS ? raw.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : []),
]);

export const env = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,

  db: {
    url: raw.DATABASE_URL || process.env.NEON_DATABASE_URL || '',
    allowNonProdDb: raw.ALLOW_NON_PROD_DB as boolean,
  },

  security: {
    proxyToken: raw.PROXY_TOKEN,
  },

  ai: {
    ollamaUrl: raw.OLLAMA_URL,
    model: raw.OLLAMA_MODEL,
  },

  n8n: {
    url: raw.N8N_URL,
    token: raw.N8N_TOKEN,
  },

  cors: {
    allowedOrigins: [...allowedOrigins],
  },
} as const;
