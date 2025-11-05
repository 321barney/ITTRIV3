// src/app/api/auth/register/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BACKEND_BASE, PROXY_TIMEOUT_MS, backendUrl, BODY_LIMIT_BYTES } from "@/lib/api/config";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ ok: true, path: "/api/auth/register" });
}

// Minimal, defensive header copying. No external helpers.
function copyRequestHeaders(h: Headers) {
  const out = new Headers();
  const drop = new Set(["host", "connection", "content-length", "accept-encoding"]);
  h?.forEach?.((v, k) => {
    const key = k.toLowerCase();
    if (!drop.has(key)) out.set(k, v);
  });
  // re-ensure important ones
  const ct = h.get("content-type");
  if (ct) out.set("content-type", ct);
  const cookie = h.get("cookie");
  if (cookie) out.set("cookie", cookie);
  return out;
}

function copyResponseHeaders(h: Headers) {
  const out = new Headers();
  h?.forEach?.((v, k) => out.set(k, v));
  return out;
}

export async function POST(req: NextRequest) {
  // Content-Type + size checks
  const ct = String(req.headers.get("content-type") || "");
  if (!/application\/json/i.test(ct)) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (BODY_LIMIT_BYTES && new TextEncoder().encode(raw).byteLength > BODY_LIMIT_BYTES) {
    return NextResponse.json({ error: "payload_too_large", limit: BODY_LIMIT_BYTES }, { status: 413 });
  }

  // Light validation for helpful errors (forward body unchanged)
  try {
    const p = JSON.parse(raw || "{}");
    if (!p?.email)    return NextResponse.json({ error: "missing_email" }, { status: 400 });
    if (!p?.password) return NextResponse.json({ error: "missing_password" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // IMPORTANT: backend path has NO /api prefix
  const tried = backendUrl("/auth/register");

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(tried, {
      method: "POST",
      headers: copyRequestHeaders(req.headers),     // pass Headers, not req
      body: raw,                                    // forward original body
      redirect: "manual",
      signal: ctrl.signal,
      cache: "no-store",
    });

    const res = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: copyResponseHeaders(upstream.headers), // pass Headers, not upstream
    });

    // Preserve Set-Cookie for auth flows
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.headers.set("set-cookie", setCookie);

    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = (e?.name === "AbortError" || msg.includes("timeout")) ? 504 : 502;
    return NextResponse.json(
      { error: "upstream_error", detail: msg, backend: BACKEND_BASE, tried },
      { status }
    );
  } finally {
    clearTimeout(to);
  }
}
