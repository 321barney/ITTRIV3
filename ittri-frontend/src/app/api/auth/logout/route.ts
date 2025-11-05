// api/auth/logout/route.ts
import { NextResponse } from 'next/server';
import { BACKEND_BASE, PROXY_TIMEOUT_MS } from "@/lib/api/config";
import { filteredRequestHeaders, filteredResponseHeaders } from "@/lib/api/headers";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort('upstream_timeout'), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${BACKEND_BASE}/auth/logout`, {
      method: 'POST',
      headers: filteredRequestHeaders(req as any),
      signal: ctrl.signal,
    } as any);
    const buf = await upstream.arrayBuffer();
    const res = new NextResponse(buf, {
      status: upstream.status,
      headers: filteredResponseHeaders(upstream),
    });
    const sc = upstream.headers.get('set-cookie');
    if (sc) res.headers.set('set-cookie', sc);
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg.includes('timeout') ? 504 : 502;
    return NextResponse.json({ error: 'upstream_error', detail: msg }, { status });
  } finally {
    clearTimeout(to);
  }
}
