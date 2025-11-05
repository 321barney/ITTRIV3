// src/ai/ittriClient.ts
import fetch from 'node-fetch';
import { OLLAMA } from './ollama.js';

type ChatMessage = { role: 'system'|'user'|'assistant'|'tool'; content: string; };
type ChatOpts = { stream?: boolean; temperature?: number; top_p?: number; tools?: any[]; tool_choice?: 'auto'|'none'; };

async function postJSON<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${OLLAMA.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function chat(messages: ChatMessage[], opts: ChatOpts = {}) {
  const payload: any = {
    model: OLLAMA.model,
    messages,
    stream: Boolean(opts.stream),
    options: {
      temperature: opts.temperature ?? 0.2,
      top_p: opts.top_p ?? 0.95,
    }
  };
  if (opts.tools && opts.tools.length) payload.tools = opts.tools;
  if (opts.tool_choice) payload.tool_choice = opts.tool_choice;

  if (!opts.stream) {
    const out = await postJSON<any>('/api/chat', payload);
    // Ollama returns { message: { content }, ... } or an array depending on model;
    const content = out?.message?.content ?? out?.messages?.[0]?.content ?? '';
    return { raw: out, content };
  }

  // Streaming
  const res = await fetch(`${OLLAMA.url}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!res.ok || !res.body) throw new Error(`Ollama stream error ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  async function* chunks() {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true }).trim();
      // Each line is a JSON event
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          yield evt;
        } catch {}
      }
    }
  }
  return chunks();
}

export async function generate(prompt: string, temperature = 0.2) {
  const out = await postJSON<any>('/api/generate', { model: OLLAMA.model, prompt, stream: false, options: { temperature } });
  return out?.response ?? '';
}

// JSON extraction using `/api/generate` with `format:"json"`
export async function extractJSON<T = any>(prompt: string): Promise<T> {
  const out = await postJSON<any>('/api/generate', { model: OLLAMA.model, prompt, stream: false, format: 'json' });
  const raw = out?.response ?? '{}';
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

// Embeddings (if your model supports it)
export async function embed(input: string | string[]) {
  const texts = Array.isArray(input) ? input : [input];
  const out = await postJSON<any>('/api/embeddings', { model: OLLAMA.model, input: texts });
  return out?.embeddings ?? [];
}
