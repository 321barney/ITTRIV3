/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { PROXY_TIMEOUT_MS } from "@/lib/api/config";
import { proxyToBackend } from "@/app/api/_lib/adminProxy";

import { backendUrl, extractTokens, buildCookieHeader, identityFromJwtOrCookies, signOrgContext } from "@/lib/api/orgctx";
import { withCors, filteredRequestHeaders, filteredResponseHeaders } from "@/lib/api/cors-cookies";

export const runtime = "nodejs";
export function OPTIONS(req: NextRequest) { return withCors(req, new NextResponse(null, { status: 204 })); }

async function forward(req: NextRequest, method: "GET" | "PATCH") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), PROXY_TIMEOUT_MS);
  const tried: string[] = [];
  try {
    const { pathname, searchParams, protocol } = req.nextUrl;
    const id = pathname.split("/").pop();
    const qs = searchParams.toString();
    const upstreamUrl = backendUrl(`/admin/orders/${id}${qs ? `?${qs}` : ""}`);
    tried.push(upstreamUrl);

    const { access, headerCookie } = extractTokens(req);
    const pass: Record<string,string> = {
      ...filteredRequestHeaders(req),
      accept: req.headers.get("accept") || "application/json",
      "content-type": req.headers.get("content-type") || "application/json",
    };
    if (access) pass["authorization"] = `Bearer ${access}`;
    const cookies = buildCookieHeader(headerCookie, access) || "";
    const isHttps = protocol === "https:";

    // impersonation
    const sellerId = req.nextUrl.searchParams.get("seller_id");
    if (sellerId) pass["x-impersonate-seller-id"] = sellerId;
    const xImp = req.headers.get("x-impersonate-seller-id");
    if (xImp) pass["x-impersonate-seller-id"] = xImp;

    // org-context
    const me = identityFromJwtOrCookies(req, access || null);
    if (me.sellerId && me.email) {
      try { pass["x-org-context"] = await signOrgContext(me.sellerId, me.email); } catch {}
      pass["x-org-identity"] = JSON.stringify({ sellerId: me.sellerId, email: me.email });
    }

    const init: RequestInit = {
      method,
      headers: { ...pass, cookie: cookies },
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual",
    };
    if (method === "PATCH") init.body = await req.text();

    const up = await fetch(upstreamUrl, init);
    const buf = await up.arrayBuffer();
    const text = new TextDecoder().decode(buf);

    const res = new NextResponse(text, { status: up.status, headers: filteredResponseHeaders(up) });
    const sc = up.headers.get("set-cookie");
    if (sc) {
      // reuse same rewrite helper in login route if you prefer; here we just pass through headers already filtered
      // (admin endpoints typically won't set cookies)
    }
    res.headers.set("x-which-route", "admin-order-id");
    res.headers.set("x-upstream-tried", tried.join(" | "));
    return withCors(req, res);
  } catch (e: any) {
    const status = (e?.name || "") === "AbortError" ? 504 : 502;
    return withCors(req, NextResponse.json({ error: "upstream_error", detail: String(e?.message || e), tried }, { status }));
  } finally { clearTimeout(timer); }
}

export async function GET(req: NextRequest)   { return forward(req, "GET"); }
export async function PATCH(req: NextRequest) { return forward(req, "PATCH"); }
