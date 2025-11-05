// src/app/api/auth/login/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND_BASE,
  PROXY_TIMEOUT_MS,
  backendUrl,
  BODY_LIMIT_BYTES,
} from "@/lib/api/config";
import {
  filteredRequestHeaders,
  filteredResponseHeaders,
} from "@/lib/api/headers";

export const runtime = "nodejs";

/* ---------------- CORS (reflect origin for credentialed cookies) ---------------- */
function withCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
    const reqHeaders = req.headers.get("access-control-request-headers");
    if (reqHeaders) res.headers.set("Access-Control-Allow-Headers", reqHeaders);
    const reqMethod = req.headers.get("access-control-request-method");
    if (reqMethod) res.headers.set("Access-Control-Allow-Methods", reqMethod);
  }
  return res;
}
export function OPTIONS(req: NextRequest) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}
export function GET(req: NextRequest) {
  return withCors(req, NextResponse.json({ ok: true, path: "/api/auth/login" }));
}

/* ---------------- Cookie helpers ---------------- */
function splitSetCookie(sc: string): string[] {
  return sc.match(/(?:^|,)(?:[^=;,]+=[^,]*)/g)?.map(s => s.trim().replace(/^,/, "")) ?? [];
}
function rewriteOneCookieForFrontend(one: string, isHttps: boolean): string {
  let c = one;
  c = c.replace(/;\s*Domain=[^;]*/gi, "");
  if (!/;\s*Path=/i.test(c)) c += "; Path=/";
  c = c.replace(/;\s*SameSite=[^;]*/gi, "");
  c += "; SameSite=Lax";
  c = c.replace(/;\s*Secure/gi, "");
  if (isHttps) c += "; Secure";
  if (!/;\s*HttpOnly/i.test(c)) c += "; HttpOnly";
  return c;
}
function applySetCookies(res: NextResponse, sc: string, isHttps: boolean) {
  for (const one of splitSetCookie(sc)) {
    res.headers.append("Set-Cookie", rewriteOneCookieForFrontend(one, isHttps));
  }
}

/* ---------------- JWT helpers (decode for exp + identity fallback) ---------------- */
function b64urlToString(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  // @ts-ignore
  return (typeof Buffer !== "undefined")
    ? Buffer.from(b64, "base64").toString("utf-8")
    : atob(b64);
}
function readJwtExp(token: string): number | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = JSON.parse(b64urlToString(payload));
    const exp = Number(json?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch { return null; }
}
function decodeJwtSafe(token?: string | null): Record<string, any> | null {
  try {
    if (!token) return null;
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(b64urlToString(payload)) as any;
  } catch { return null; }
}
function cookieLine(name: string, value: string, isHttps: boolean, maxAge?: number) {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = readJwtExp(value);
  const _maxAge =
    typeof maxAge === "number"
      ? maxAge
      : exp && exp > nowSec
        ? Math.max(0, exp - nowSec - 5)
        : 3600;
  const attrs = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isHttps ? "Secure" : "",
    `Max-Age=${_maxAge}`,
  ].filter(Boolean);
  return `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`;
}

/* ---------------- POST /api/auth/login ---------------- */
export async function POST(req: NextRequest) {
  // Size guard
  const len = Number(req.headers.get("content-length") || 0);
  if (len && len > BODY_LIMIT_BYTES) {
    return withCors(req, NextResponse.json({ error: "payload_too_large" }, { status: 413 }));
  }
  // Content-type guard
  const ct = req.headers.get("content-type") || "";
  if (!/application\/json/i.test(ct)) {
    return withCors(req, NextResponse.json({ error: "invalid_content_type" }, { status: 415 }));
  }

  // Parse
  let payload: Record<string, any> = {};
  try { payload = await req.json(); }
  catch { return withCors(req, NextResponse.json({ error: "invalid_json" }, { status: 400 })); }

  // Required
  if (!payload.email)    return withCors(req, NextResponse.json({ error: "missing_email" }, { status: 400 }));
  if (!payload.password) return withCors(req, NextResponse.json({ error: "missing_password" }, { status: 400 }));

  const backendPayload = {
    email: String(payload.email),
    password: String(payload.password),
    login_type: String(payload.login_type || "seller"),
  };

  // Prefer the current route; keep legacy fallbacks
  const pathCandidates = [
    "/api/v1/auth/login", // current
    "/auth/login",
    "/login",
    "/api/auth/login",
    "/api/login",
  ];

  const tried: string[] = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);

  try {
    for (const p of pathCandidates) {
      const url = backendUrl(p);
      tried.push(url);

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          ...filteredRequestHeaders(req),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(backendPayload),
        signal: ctrl.signal,
        cache: "no-store",
        redirect: "manual",
      }).catch((e) => {
        if ((e?.name || "") === "AbortError") throw e;
        return null as any;
      });

      if (!upstream) continue;
      if (upstream.status === 404) continue;

      const isHttps = req.nextUrl.protocol === "https:";
      const buf = await upstream.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      const isJson = /^application\/json\b/i.test(upstream.headers.get("content-type") || "");

      // Pass-through response base
      const res = new NextResponse(text, {
        status: upstream.status,
        headers: filteredResponseHeaders(upstream),
      });

      // (1) Forward upstream Set-Cookie to the browser (rewritten for this origin)
      const sc = upstream.headers.get("set-cookie");
      if (sc) {
        applySetCookies(res, sc, isHttps);
        res.headers.set("x-cookie-rewritten", "1");
      }

      // (2) Mint cookies from JSON: access + identity (with JWT fallback)
      if (isJson) {
        try {
          const json = JSON.parse(text);

          // Access / refresh
          const access = json?.access_token as string | undefined;
          const refresh = json?.refresh_token as string | undefined;

          if (access) {
            res.headers.append("Set-Cookie", cookieLine("access_token", access, isHttps));
            res.headers.set("x-cookie-from-json", "access");
          }
          
          // FIXED: Set refresh token cookie (30 days)
          if (refresh) {
            const refreshMaxAge = 30 * 24 * 60 * 60; // 30 days to match backend REFRESH_TTL_SEC
            res.headers.append("Set-Cookie", `refresh_token=${encodeURIComponent(refresh)}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}; Max-Age=${refreshMaxAge}`);
            res.headers.set("x-cookie-refresh-set", "1");
          }

          // Identity (robust extraction)
          const user =
            json?.user ??
            json?.data?.user ??
            json?.data ??
            null;

          // Primary from payload
          let userId =
            user?.id ??
            user?.seller_id ??
            user?.user_id ??
            null;

          let userEmail =
            user?.email ??
            user?.user_email ??
            null;

          // Fallback: decode the access token for sub/email if user payload missing/incomplete
          if ((!userId || !userEmail) && access) {
            const claims = decodeJwtSafe(access) || {};
            userId = userId || claims.sub || claims.user_id || claims.sellerId || null;
            userEmail = userEmail || claims.email || claims.user_email || claims.preferred_username || claims.upn || null;
          }

          // Mint identity cookies (24h)
          const maxAge = 24 * 60 * 60;
          if (userId)   res.headers.append("Set-Cookie", `user_id=${encodeURIComponent(String(userId))}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}; Max-Age=${maxAge}`);
          if (userEmail) res.headers.append("Set-Cookie", `user_email=${encodeURIComponent(String(userEmail))}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}; Max-Age=${maxAge}`);
          if (userId || userEmail) res.headers.set("x-cookie-identity", "1");

          // If only refresh came back (no access + no Set-Cookie), try to exchange for access once
          if (!access && !sc && refresh) {
            const refreshPaths = ["/api/v1/auth/refresh", "/api/auth/refresh", "/auth/refresh", "/refresh", "/api/refresh"];
            for (const rp of refreshPaths) {
              const refreshUrl = backendUrl(rp);
              const rf = await fetch(refreshUrl, {
                method: "POST",
                headers: { accept: "application/json", "content-type": "application/json" },
                body: JSON.stringify({ refresh_token: refresh }),
                cache: "no-store",
                redirect: "manual",
                signal: ctrl.signal,
              }).catch(() => null as any);

              if (!rf || rf.status === 404) continue;

              const rText = await rf.text();
              const rfJson = /^application\/json\b/i.test(rf.headers.get("content-type") || "");
              let accessFromRefresh: string | undefined;

              if (rfJson) {
                try {
                  const jr = JSON.parse(rText);
                  accessFromRefresh = jr?.access_token || jr?.token || jr?.jwt;
                } catch {}
              }

              const rfSetCookie = rf.headers.get("set-cookie");
              if (!accessFromRefresh && rfSetCookie) {
                // Backend set an access cookie — forward
                applySetCookies(res, rfSetCookie, isHttps);
                res.headers.set("x-cookie-refreshed", "1");
                break;
              }

              if (accessFromRefresh) {
                res.headers.append("Set-Cookie", cookieLine("access_token", accessFromRefresh, isHttps));
                res.headers.set("x-cookie-refreshed", "1");
                break;
              }
            }
          }
        } catch {
          // ignore JSON parse errors
        }
      }

      // Diagnostics
      res.headers.set("x-which-route", "auth-login");
      res.headers.set("x-upstream-tried", tried.join(" | "));

      // CORS and return
      return withCors(req, res);
    }

    // No upstream matched
    return withCors(
      req,
      NextResponse.json(
        { error: "route_not_found_upstream", tried, backend: BACKEND_BASE },
        { status: 502, headers: { "x-which-route": "auth-login", "x-upstream-tried": tried.join(" | ") } }
      )
    );
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e);
    const status = name === "AbortError" || msg.includes("timeout") ? 504 : 502;
    return withCors(
      req,
      NextResponse.json(
        { error: "upstream_error", detail: msg, backend: BACKEND_BASE, tried },
        { status, headers: { "x-which-route": "auth-login", "x-upstream-tried": tried.join(" | ") } }
      )
    );
  } finally {
    clearTimeout(timer);
  }
}
