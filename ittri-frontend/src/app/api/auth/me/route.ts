// src/app/api/auth/me/route.ts
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

/* ---------------- Cookie helpers ---------------- */
function readCookie(req: NextRequest, name: string): string | null {
  return req.cookies.get(name)?.value || null;
}

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

function readJwtExp(token: string): number | null {
  try {
    const b64urlToString = (b64url: string) => {
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
      return (typeof Buffer !== "undefined")
        ? Buffer.from(b64, "base64").toString("utf-8")
        : atob(b64);
    };
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = JSON.parse(b64urlToString(payload));
    const exp = Number(json?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch { return null; }
}

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const exp = readJwtExp(token);
  if (!exp) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  // Consider expired if less than 60 seconds remaining
  return exp - nowSec < 60;
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

/* ---------------- GET /api/auth/me ---------------- */
export async function GET(req: NextRequest) {
  const isHttps = req.nextUrl.protocol === "https:";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);

  try {
    // Extract tokens from cookies
    let accessToken = readCookie(req, "access_token") || readCookie(req, "accessToken");
    const refreshToken = readCookie(req, "refresh_token") || readCookie(req, "refreshToken");

    // If access token is expired or missing and we have a refresh token, refresh it first
    let refreshSetCookie: string | undefined;
    let newRefreshToken: string | undefined;
    
    if (isTokenExpired(accessToken) && refreshToken) {
      const refreshPaths = ["/api/v1/auth/refresh", "/auth/refresh", "/refresh"];
      
      for (const rp of refreshPaths) {
        const refreshUrl = backendUrl(rp);
        const rf = await fetch(refreshUrl, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            cookie: `refresh_token=${encodeURIComponent(refreshToken)}`,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          cache: "no-store",
          redirect: "manual",
          signal: ctrl.signal,
        }).catch(() => null as any);

        if (!rf || rf.status === 404) continue;
        if (rf.status !== 200) continue;

        // CRITICAL: Capture Set-Cookie headers for token rotation
        const rfSetCookie = rf.headers.get("set-cookie");
        if (rfSetCookie) {
          refreshSetCookie = rfSetCookie;
        }

        const rText = await rf.text();
        const rfJson = /^application\/json\b/i.test(rf.headers.get("content-type") || "");
        
        if (rfJson) {
          try {
            const jr = JSON.parse(rText);
            const newAccessToken = jr?.access_token || jr?.token || jr?.jwt;
            
            if (newAccessToken) {
              accessToken = newAccessToken;
            }
            
            // CRITICAL: Capture rotated refresh token from JSON response
            const rotatedRefreshToken = jr?.refresh_token;
            if (rotatedRefreshToken) {
              newRefreshToken = rotatedRefreshToken;
            }
            
            if (newAccessToken) {
              // Token refreshed successfully, break the loop
              break;
            }
          } catch {
            // ignore JSON parse errors
          }
        }
      }
    }

    // If still no valid access token, return unauthorized
    if (!accessToken) {
      return withCors(req, NextResponse.json(
        { ok: false, error: "missing_token" },
        { status: 401 }
      ));
    }

    // Now call /auth/me with the (possibly refreshed) access token
    const mePaths = ["/auth/me", "/me"];
    const tried: string[] = [];

    for (const mp of mePaths) {
      const meUrl = backendUrl(mp);
      tried.push(meUrl);

      const upstream = await fetch(meUrl, {
        method: "GET",
        headers: {
          ...filteredRequestHeaders(req),
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "manual",
        signal: ctrl.signal,
      }).catch((e) => {
        if ((e?.name || "") === "AbortError") throw e;
        return null as any;
      });

      if (!upstream) continue;
      if (upstream.status === 404) continue;

      const buf = await upstream.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      const isJson = /^application\/json\b/i.test(upstream.headers.get("content-type") || "");

      // Pass-through response base
      const res = new NextResponse(text, {
        status: upstream.status,
        headers: filteredResponseHeaders(upstream),
      });

      // Forward any Set-Cookie from backend (rewritten for this origin)
      const sc = upstream.headers.get("set-cookie");
      if (sc) {
        applySetCookies(res, sc, isHttps);
        res.headers.set("x-cookie-rewritten", "1");
      }

      // CRITICAL: Forward Set-Cookie from refresh response (for token rotation)
      if (refreshSetCookie) {
        applySetCookies(res, refreshSetCookie, isHttps);
        res.headers.set("x-refresh-cookie-forwarded", "1");
      }

      // If we refreshed the access token, set it as a cookie
      if (accessToken && accessToken !== readCookie(req, "access_token")) {
        res.headers.append("Set-Cookie", cookieLine("access_token", accessToken, isHttps));
        res.headers.set("x-token-refreshed", "1");
      }
      
      // CRITICAL: Set rotated refresh token as cookie (if backend returned new one in JSON)
      if (newRefreshToken && newRefreshToken !== refreshToken) {
        const refreshMaxAge = 30 * 24 * 60 * 60; // 30 days
        res.headers.append("Set-Cookie", `refresh_token=${encodeURIComponent(newRefreshToken)}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}; Max-Age=${refreshMaxAge}`);
        res.headers.set("x-refresh-token-rotated", "1");
      }

      // Diagnostics
      res.headers.set("x-which-route", "auth-me");
      res.headers.set("x-upstream-tried", tried.join(" | "));

      // CORS and return
      return withCors(req, res);
    }

    // No upstream matched
    return withCors(
      req,
      NextResponse.json(
        { error: "route_not_found_upstream", tried, backend: BACKEND_BASE },
        { status: 502, headers: { "x-which-route": "auth-me", "x-upstream-tried": tried.join(" | ") } }
      )
    );
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e);
    const status = name === "AbortError" || msg.includes("timeout") ? 504 : 502;
    return withCors(
      req,
      NextResponse.json(
        { error: "upstream_error", detail: msg, backend: BACKEND_BASE },
        { status, headers: { "x-which-route": "auth-me" } }
      )
    );
  } finally {
    clearTimeout(timer);
  }
}
