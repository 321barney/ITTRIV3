/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

export function withCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
    const rh = req.headers.get("access-control-request-headers");
    if (rh) res.headers.set("Access-Control-Allow-Headers", rh);
    const rm = req.headers.get("access-control-request-method");
    if (rm) res.headers.set("Access-Control-Allow-Methods", rm);
  }
  return res;
}

// ---- cookie rewrite helpers ----
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
export function applySetCookies(res: NextResponse, sc: string, isHttps: boolean) {
  for (const one of splitSetCookie(sc)) res.headers.append("Set-Cookie", rewriteOneCookieForFrontend(one, isHttps));
}
export function filteredRequestHeaders(req: NextRequest) {
  const hop = new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade","host","accept-encoding"]);
  const h: Record<string,string> = {};
  for (const [k, v] of req.headers.entries()) if (!hop.has(k.toLowerCase())) h[k] = v;
  return h;
}
export function filteredResponseHeaders(up: Response) {
  const hop = new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade","content-encoding"]);
  const h = new Headers(up.headers);
  for (const k of Array.from(h.keys())) if (hop.has(k.toLowerCase())) h.delete(k);
  return h;
}
