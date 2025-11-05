// src/app/api/_lib/proxy-auth-register.ts
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_BASE, PROXY_TIMEOUT_MS } from "./config";
import { filteredRequestHeaders, filteredResponseHeaders } from "./headers";

export const runtime = "nodejs";

// Optional GET to sanity-check route registration
export function GET() {
  return NextResponse.json({ ok: true, path: "/api/auth/register" });
}

const REQUIRED = ["email", "companyName", "sellerName", "phoneNumber", "storeName"] as const;

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (!/application\/json/i.test(ct)) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  let payload: Record<string, any> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  for (const f of REQUIRED) {
    if (!payload[f]) return NextResponse.json({ error: `missing_${f}` }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(String(payload.email))) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  for (const urlField of ["whatsappApi", "gsheetUrl"]) {
    const v = payload[urlField];
    if (v != null && v !== "" && !/^https?:\/\/[^ ]+$/i.test(String(v))) {
      return NextResponse.json({ error: `invalid_${urlField}` }, { status: 400 });
    }
  }

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);
  const tried = `${BACKEND_BASE}/auth/register`;

  try {
    const upstream = await fetch(tried, {
      method: "POST",
      headers: filteredRequestHeaders(req),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    // If Replit edge returns HTML, surface a clean JSON error
    const proxyErr = upstream.headers.get("replit-proxy-error");
    const upCT = (upstream.headers.get("content-type") || "").toLowerCase();
    if (proxyErr || (upstream.status >= 500 && upCT.includes("text/html"))) {
      const preview = await upstream.text();
      return NextResponse.json(
        {
          error: "upstream_unreachable",
          backend: BACKEND_BASE,
          tried,
          status: upstream.status,
          proxyErr,
          bodyPreview: preview.slice(0, 600),
        },
        { status: 502 }
      );
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: upstream.status,
      headers: filteredResponseHeaders(upstream),
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg.includes("timeout") ? 504 : 502;
    return NextResponse.json(
      { error: "upstream_error", detail: msg, backend: BACKEND_BASE, tried },
      { status }
    );
  } finally {
    clearTimeout(to);
  }
}
