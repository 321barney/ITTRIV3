// src/ai/providers/utils.ts
export function basicAuthHeader(): string | undefined {
  const up = process.env.ITTRI_BASIC_AUTH || process.env.OLLAMA_BASIC_AUTH;
  if (up?.includes(':')) {
    return 'Basic ' + Buffer.from(up, 'utf8').toString('base64');
  }
  const user = process.env.ITTRI_USER || process.env.OLLAMA_USER;
  const pass = process.env.ITTRI_PASS || process.env.OLLAMA_PASS;
  if (user && pass) return 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return undefined;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

export function abortableFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function* parseSSEStream(response: Response) {
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) yield { message: { content: delta } };
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* parseJSONLStream(response: Response) {
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { yield JSON.parse(line); } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}
