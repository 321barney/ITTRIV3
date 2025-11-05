// src/app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND_BASE,
  PROXY_TIMEOUT_MS,
  backendUrl,
} from "@/lib/api/config";
import {
  filteredRequestHeaders,
  filteredResponseHeaders,
} from "@/lib/api/headers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);
  const tried = backendUrl("/api/auth/refresh");

  try {
    const upstream = await fetch(tried, {
      method: "POST",
      headers: filteredRequestHeaders(req), // includes cookies
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual",
    });

    // read JSON to extract new access token (if backend returns it)
    const clone = upstream.clone();
    const data = await clone.json().catch(() => null);

    const buf = await upstream.arrayBuffer();
    const res = new NextResponse(buf, {
      status: upstream.status,
      headers: filteredResponseHeaders(upstream),
    });

    // forward rotated refresh cookie if backend set it
    const backendSetCookie = upstream.headers.get("set-cookie");
    if (backendSetCookie) res.headers.set("set-cookie", backendSetCookie);

    // refresh often returns a new short-lived access too
    if (upstream.ok && data?.access_token) {
      const secure = (process.env.NODE_ENV ?? "development") !== "development";
      const cookie = [
        `access_token=${encodeURIComponent(data.access_token)}`,
        "Path=/",
        "Max-Age=900",   // 15 minutes
        "SameSite=Lax",
        "HttpOnly",
        secure ? "Secure" : "",
      ].filter(Boolean).join("; ");
      res.headers.append("set-cookie", cookie);
    }

    return res;
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e);
    const status = name === "AbortError" || msg.includes("timeout") ? 504 : 502;
    return NextResponse.json(
      { error: "upstream_error", detail: msg, backend: BACKEND_BASE, tried },
      { status }
    );
  } finally {
    clearTimeout(to);
  }
}
