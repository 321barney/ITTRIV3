// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_BASE, PROXY_TIMEOUT_MS, backendUrl } from "@/lib/api/config";
import { filteredResponseHeaders } from "@/lib/api/headers";
import rateLimit from '@fastify/rate-limit';

export const runtime = "nodejs";

function pickAccessToken(req: NextRequest): string | null {
  // 1) Standard Authorization header
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth;

  // 2) Custom header (handy for fetches from client code)
  const x = req.headers.get("x-access-token");
  if (x) return `Bearer ${x}`;

  // 3) Optional cookie (only if you later decide to store it)
  const ck = req.cookies.get("access_token")?.value;
  if (ck) return `Bearer ${ck}`;

  return null;
}

// Proxy GET /api/auth/me  ->  BACKEND /api/auth/me
export async function GET(req: NextRequest) {
  const tried = backendUrl("/api/auth/me");
  const bearer = pickAccessToken(req);

  if (!bearer) {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 401 },
    );
  }

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);

  try {
    // Build minimal safe headers – we don’t forward cookies
    const headers = new Headers();
    headers.set("accept", "application/json");
    headers.set("content-type", "application/json");
    headers.set("authorization", bearer);

    const upstream = await fetch(tried, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
    });

    const buf = await upstream.arrayBuffer();

    // Pass through response headers (including any Set-Cookie if backend sends it)
    const headersOut = new Headers(filteredResponseHeaders(upstream));
    headersOut.delete("set-cookie");
    const sc = upstream.headers.get("set-cookie");
    if (sc) headersOut.append("set-cookie", sc);

    return new NextResponse(buf, {
      status: upstream.status,
      headers: headersOut,
    });
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e);
    const status = name === "AbortError" || msg.includes("timeout") ? 504 : 502;
    return NextResponse.json(
      { error: "upstream_error", detail: msg, backend: BACKEND_BASE, tried },
      { status },
    );
  } finally {
    clearTimeout(to);
  }
}
