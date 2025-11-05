
import fetch, { HeadersInit } from 'node-fetch';
export async function http<T=any>(url: string, opts: { method?: string; headers?: HeadersInit; body?: any; timeoutMs?: number } = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30000 } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`${res.status} ${res.statusText} - ${text.slice(0,200)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json() as T;
    return await res.text() as any as T;
  } finally {
    clearTimeout(t);
  }
}
