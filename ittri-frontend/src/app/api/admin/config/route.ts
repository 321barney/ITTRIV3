/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { PROXY_TIMEOUT_MS } from "@/lib/api/config";
import { proxyToBackend } from "@/app/api/_lib/adminProxy";

import { backendUrl, extractTokens, buildCookieHeader, identityFromJwtOrCookies, signOrgContext } from "@/lib/api/orgctx";
import { withCors, filteredRequestHeaders, filteredResponseHeaders } from "@/lib/api/cors-cookies";

export const runtime = "nodejs";
export function OPTIONS(req: NextRequest) { return withCors(req, new NextResponse(null, { status: 204 })); }

export async function GET(req: NextRequest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), PROXY_TIMEOUT_MS);
  const tried: string[] = [];
  try {
    const upstreamUrl = backendUrl(`/admin/config`);
    tried.push(upstreamUrl);

    const { access, headerCookie } = extractTokens(req);
    const pass: Record<string,string> = {
      ...filteredRequestHeaders(req),
      accept: req.headers.get("accept") || "application/json",
    };
    if (access) pass["authorization"] = `Bearer ${access}`;
    const cookies = buildCookieHeader(headerCookie, access) || "";

    const me = identityFromJwtOrCookies(req, access || null);
    if (me.sellerId && me.email) {
      try { pass["x-org-context"] = await signOrgContext(me.sellerId, me.email); } catch {}
      pass["x-org-identity"] = JSON.stringify({ sellerId: me.sellerId, email: me.email });
    }

    const up = await fetch(upstreamUrl, { method: "GET", headers: { ...pass, cookie: cookies }, signal: ctrl.signal, cache: "no-store", redirect: "manual" });
    const text = await up.text();
    const res = new NextResponse(text, { status: up.status, headers: filteredResponseHeaders(up) });
    res.headers.set("x-which-route", "admin-config");
    res.headers.set("x-upstream-tried", tried.join(" | "));
    return withCors(req, res);
  } catch (e: any) {
    const status = (e?.name || "") === "AbortError" ? 504 : 502;
    return withCors(req, NextResponse.json({ error: "upstream_error", detail: String(e?.message || e), tried }, { status }));
  } finally { clearTimeout(timer); }
}
