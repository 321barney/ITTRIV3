// src/ai/llm.ts
import type { LLMClient } from './types';
import { buildOllamaProvider } from './providers/ollama';
import { buildOpenAIProvider } from './providers/openai';

/*
 * Select and cache an LLM provider based on environment variables.
 *
 * Supports both numeric and string envs:
 *   LLM_PROVIDER_ID=0 or LLM_PROVIDER=ollama  → Ollama
 *   LLM_PROVIDER_ID=1 or LLM_PROVIDER=openai  → OpenAI
 * If neither is set (or unrecognised), we default to OpenAI to avoid
 * ECONNREFUSED against a local Ollama that may not be running.
 */

let cachedClient: LLMClient | null = null;
let cachedName: 'openai' | 'ollama' | null = null;

function pickProvider(): 'openai' | 'ollama' {
  const raw = (process.env.LLM_PROVIDER_ID ?? process.env.LLM_PROVIDER ?? '1')
    .toString()
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'ollama') return 'ollama';
  if (raw === '1' || raw === 'openai') return 'openai';
  return 'openai';
}

export async function getClient(): Promise<LLMClient> {
  const name = pickProvider();
  if (cachedClient && cachedName === name) return cachedClient;

  cachedName = name;
  cachedClient =
    name === 'openai'
      ? await buildOpenAIProvider()
      : await buildOllamaProvider();

  return cachedClient;
}

/** Return the selected provider name without instantiating it (useful for logs). */
export function getProviderName(): 'openai' | 'ollama' {
  return cachedName ?? pickProvider();
}

/** Clear memoized provider (useful in tests or when env changes in watch mode). */
export function resetLLMClientCache() {
  cachedClient = null;
  cachedName = null;
}

/** Optionally verify connectivity if provider exposes __ping(). */
export async function ensureReady(): Promise<boolean> {
  const client = await getClient();
  if (typeof (client as any).__ping === 'function') {
    try { return !!(await (client as any).__ping()); }
    catch { return false; }
  }
  return true;
}

export * from './types';
