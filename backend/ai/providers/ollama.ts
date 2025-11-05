// src/ai/providers/ollama.ts
import type { LLMClient, ChatMessage } from '../types';
import { abortableFetch, withTimeout, basicAuthHeader, parseJSONLStream } from './utils';

const OLLAMA_HOST = (process.env.ITTRI_HOST?.trim() || process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = (process.env.ITTRI_MODEL?.trim() || process.env.OLLAMA_MODEL?.trim() || 'ITTRI');
const OLLAMA_TIMEOUT_MS = Number(process.env.ITTRI_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || 120000);

function ollamaHeaders(): HeadersInit {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  const auth = basicAuthHeader();
  if (auth) headers['authorization'] = auth;
  return headers;
}

function messagesToPrompt(messages: ChatMessage[]): string {
  return messages.map(m => `${m.role?.toUpperCase()}: ${m.content ?? ''}`).join('\n');
}

export async function buildOllamaProvider(): Promise<LLMClient> {
  return {
    async chat({ model, messages, stream = false, options }) {
      const prompt = messagesToPrompt(messages || []);
      const body = { model: model || OLLAMA_MODEL, prompt, stream, options };
      const response = await abortableFetch(`${OLLAMA_HOST}/api/generate`, { method: 'POST', headers: ollamaHeaders(), body: JSON.stringify(body) }, OLLAMA_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      if (!stream) {
        const json = await response.json();
        return { message: { role: 'assistant', content: String(json?.response ?? '') } };
      }
      async function* convertStream() {
        for await (const chunk of parseJSONLStream(response) as any) {
          const delta = chunk?.response;
          if (delta) yield { message: { content: delta } };
        }
      }
      return convertStream();
    },

    async generate({ model, prompt, stream = false, options }) {
      const body = { model: model || OLLAMA_MODEL, prompt, stream, options };
      const response = await abortableFetch(`${OLLAMA_HOST}/api/generate`, { method: 'POST', headers: ollamaHeaders(), body: JSON.stringify(body) }, OLLAMA_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      if (!stream) return response.json();
      return parseJSONLStream(response) as any;
    },

    async embeddings({ model, input }) {
      const response = await abortableFetch(`${OLLAMA_HOST}/api/embeddings`, { method: 'POST', headers: ollamaHeaders(), body: JSON.stringify({ model: model || OLLAMA_MODEL, input }) }, OLLAMA_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Ollama embeddings API error: ${response.status}`);
      return response.json();
    },

    async __ping() {
      try {
        const response = await withTimeout(fetch(`${OLLAMA_HOST}/api/tags`, { headers: ollamaHeaders() }), 1500);
        return response.ok;
      } catch { return false; }
    },
  };
}
