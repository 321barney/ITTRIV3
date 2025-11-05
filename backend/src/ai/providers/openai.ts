// src/ai/providers/openai.ts
import type { LLMClient } from '../types';
import { abortableFetch, withTimeout, parseSSEStream } from './utils';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const OPENAI_BASE = (process.env.OPENAI_BASE || 'https://api.openai.com').replace(/\/+$/, '');
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 120000);
const OPENAI_MODEL_PATTERN = /^(gpt|o1|chatgpt|gpt-|o\d)/i;

function openaiHeaders(): HeadersInit {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  return { 'content-type': 'application/json', 'authorization': `Bearer ${OPENAI_API_KEY}` };
}

export async function buildOpenAIProvider(): Promise<LLMClient> {
  return {
    async chat({ model, messages, stream = false, options = {} }) {
      const selectedModel = model && OPENAI_MODEL_PATTERN.test(model) ? model : OPENAI_MODEL;
      const body = {
        model: selectedModel,
        temperature: options.temperature,
        max_tokens: options.num_predict || options.max_tokens,
        stream: Boolean(stream),
        messages: messages || [],
      };
      const response = await abortableFetch(`${OPENAI_BASE}/v1/chat/completions`, { method: 'POST', headers: openaiHeaders(), body: JSON.stringify(body) }, OPENAI_TIMEOUT_MS);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI chat API error: ${response.status} ${text}`);
      }
      if (!stream) {
        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { message: { role: 'assistant', content: String(content) } };
      }
      return parseSSEStream(response);
    },

    async generate({ model, prompt, stream = false, options = {} }) {
      const selectedModel = model && OPENAI_MODEL_PATTERN.test(model) ? model : OPENAI_MODEL;
      const body = {
        model: selectedModel,
        temperature: options.temperature,
        max_tokens: options.num_predict || options.max_tokens,
        stream: Boolean(stream),
        messages: [{ role: 'user', content: String(prompt ?? '') }],
      };
      const response = await abortableFetch(`${OPENAI_BASE}/v1/chat/completions`, { method: 'POST', headers: openaiHeaders(), body: JSON.stringify(body) }, OPENAI_TIMEOUT_MS);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI generate API error: ${response.status} ${text}`);
      }
      if (!stream) {
        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { response: String(content), done: true };
      }
      async function* convertStream() {
        for await (const chunk of parseSSEStream(response)) {
          if (chunk.message?.content) yield { response: chunk.message.content, done: false };
        }
        yield { response: '', done: true };
      }
      return convertStream();
    },

    async embeddings({ model, input }) {
      const response = await abortableFetch(`${OPENAI_BASE}/v1/embeddings`, { method: 'POST', headers: openaiHeaders(), body: JSON.stringify({ model: model || OPENAI_EMBED_MODEL, input }) }, OPENAI_TIMEOUT_MS);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI embeddings API error: ${response.status} ${text}`);
      }
      const json = await response.json();
      return { embeddings: json?.data?.map((d: any) => d.embedding) || [] };
    },

    async __ping() {
      try {
        const response = await withTimeout(fetch(`${OPENAI_BASE}/v1/models`, { headers: openaiHeaders() }), 1500);
        return response.ok;
      } catch { return false; }
    },
  };
}
