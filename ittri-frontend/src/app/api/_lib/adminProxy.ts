// src/app/api/_lib/adminProxy.ts
import { NextRequest, NextResponse } from "next/server";
import { SignJWT, importPKCS8, decodeJwt } from "jose";

export const runtime = "nodejs";

/* ===== Config & utils ===== */
function normalizeBackendBase(s: string) {
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;   // default to http
  return s.replace(/\/+$/, "");
}
const RAW_BACKEND_BASE =
  process.env.BACKEND_BASE ??
  "http://09c83f29-0f55-4757-8016-aa5d4ffbbaf5-00-1fq75tid6n0c9.spock.replit.dev:8000";
const BACKEND_BASE = normalizeBackendBase(RAW_BACKEND_BASE);

// Optional org-context signing (recommended for seller routes)
const ORG_CONTEXT_ISSUER   = process.env.ORG_CONTEXT_ISSUER || "";
const ORG_CONTEXT_AUDIENCE = process.env.ORG_CONTEXT_AUDIENCE || "";
const ORG_CONTEXT_PRIVATE_KEY_PKCS8 = process.env.ORG_CONTEXT_PRIVATE_KEY_PKCS8 || "";

let _orgKeyPromise: Promise<CryptoKey> | null = null;
function hasOrgSigner() {
  return !!(ORG_CONTEXT_ISSUER && ORG_CONTEXT_AUDIENCE && ORG_CONTEXT_PRIVATE_KEY_PKCS8);
}
function importOrgKey() {
  if (!_orgKeyPromise) _orgKeyPromise = importPKCS8(ORG_CONTEXT_PRIVATE_KEY_PKCS8, "EdDSA");
  return _orgKeyPromise!;
}
async function signOrgContext(sellerId: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importOrgKey();
  return new SignJWT({ context: { sellerId, email } })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setIssuer(ORG_CONTEXT_ISSUER)
    .setAudience(ORG_CONTEXT_AUDIENCE)
    .sign(key);
}

/* ===== Cookies & headers helpers (same as you had) ===== */
function splitSetCookie(sc: string): string[] { /* …unchanged… */ return sc.match(/(?:^|,)(?:[^=;,]+=[^,]*)/g)?.map(s=>s.trim().replace(/^,/, "")) ?? []; }
function rewriteOneCookieForFrontend(one: string, isHttps: boolean): string { /* …unchanged… */ let c=one; c=c.replace(/;\s*Domain=[^;]*/gi,""); if(!/;\s*Path=/i.test(c)) c+="; Path=/"; c=c.replace(/;\s*SameSite=[^;]*/gi,""); c+="; SameSite=Lax"; c=c.replace(/;\s*Secure/gi,""); if(isHttps) c+="; Secure"; if(!/;\s*HttpOnly/i.test(c)) c+="; HttpOnly"; return c; }
function appendRewrittenSetCookies(resHeaders: Headers, upstream: Response, isHttps: boolean) { /* …unchanged… */ const sc=upstream.headers.get("set-cookie"); if(!sc) return; for (const one of splitSetCookie(sc)) resHeaders.append("set-cookie", rewriteOneCookieForFrontend(one,isHttps)); }
function copyResponseHeaders(up: Response) { /* …unchanged… */ const out=new Headers(); for (const [k,v] of up.headers){const key=k.toLowerCase(); if(["transfer-encoding","content-length","content-encoding","connection","keep-alive","set-cookie"].includes(key)) continue; out.append(k,v);} return out; }

/* ===== Extractors (add JWT decode to get seller/email fallback) ===== */
function extractAccessToken(req: NextRequest) { /* …unchanged… */ const seen:Record<string,string|undefined>={}; const candidates=["__Host-access_token","__Secure-access_token","access_token","accessToken","id_token","token","jwt","session","auth"]; for (const n of candidates){const v=req.cookies.get(n)?.value; if(v) return {token:v,src:`cookie:${n}`,seen} as const; if(req.cookies.get(n)) seen[n]="(present-empty?)";} const auth=req.headers.get("authorization")||req.headers.get("Authorization"); if(auth&&/^Bearer\s+(.+)/i.test(auth)) return {token:auth.replace(/^Bearer\s+/i,"").trim(),src:"authorization",seen} as const; const x=req.headers.get("x-access-token")||req.headers.get("x-authorization"); if(x) return {token:x.trim(),src:"x-header",seen} as const; const raw=req.headers.get("cookie")||""; for (const n of candidates){const m=new RegExp(String.raw`(?:^|;\s*)${n}=([^;]+)`,"i").exec(raw); if(m?.[1]) return {token:decodeURIComponent(m[1]),src:`cookie_header:${n}`,seen} as const;} const qp=req.nextUrl.searchParams.get("access_token"); if(qp) return {token:qp,src:"query",seen} as const; return {token:null as string|null,src:"none",seen} as const; }

function extractIdentity(req: NextRequest, token: string | null) {
  // 1) cookies
  let sellerId = req.cookies.get("user_id")?.value || req.cookies.get("seller_id")?.value || null;
  let email    = req.cookies.get("user_email")?.value || req.cookies.get("email")?.value || null;
  // 2) decode JWT (best-effort)
  if ((!sellerId || !email) && token) {
    try {
      const p = decodeJwt(token) as any;
      sellerId = sellerId || p?.sellerId || p?.sub || p?.user_id || null;
      email    = email    || p?.email || p?.user_email || p?.preferred_username || p?.upn || null;
    } catch { /* ignore */ }
  }
  return { sellerId, email };
}

/* ===== Public API ===== */
export type ProxyMode = "seller" | "admin";
export type ProxyOptions =
  | { mode: "admin"; upstreamPath: string; tag?: string }
  | { mode: "seller"; candidates?: string[]; tag?: string };

export async function proxyToBackend(req: NextRequest, opts: ProxyOptions) {
  const tag = opts.tag ?? (opts.mode === "seller" ? "seller-proxy" : "admin-proxy");

  // Build target list
  const search = req.nextUrl.search || "";
  const targets =
    opts.mode === "admin"
      ? [`${BACKEND_BASE}${opts.upstreamPath}${search}`]
      : (opts.candidates?.length ? opts.candidates : [
          "/api/v1/metric/overview",
          "/metric/overview",
          "/api/v1/seller/dashboard",
          "/seller/dashboard",
        ]).map(p => `${BACKEND_BASE}${p}${p.endsWith("overview") ? search : ""}`);

  // Abort control
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("upstream_timeout"), 20_000);

  try {
    const headers = new Headers();
    const accept = req.headers.get("accept"); if (accept) headers.set("accept", accept);
    const ua = req.headers.get("user-agent"); if (ua) headers.set("user-agent", ua);
    const ctype = req.headers.get("content-type"); if (ctype) headers.set("content-type", ctype);

    // Authorization
    const { token, src } = extractAccessToken(req);
    if (token) headers.set("authorization", `Bearer ${token}`);

    // Cookies (for refresh flows)
    const rawCookie = req.headers.get("cookie"); if (rawCookie) headers.set("cookie", rawCookie);

    // Identity hints
    const ident = extractIdentity(req, token);
    if (ident.sellerId || ident.email) {
      headers.set("x-org-identity", JSON.stringify({
        sellerId: ident.sellerId ?? undefined,
        email: ident.email ?? undefined,
      }));
    }

    // Signed org context (CRITICAL for seller routes)
    if (opts.mode === "seller" && hasOrgSigner() && ident.sellerId && ident.email) {
      try {
        const jwt = await signOrgContext(ident.sellerId, ident.email);
        headers.set("x-org-context", jwt);
      } catch { /* if signing fails, we still proceed with identity only */ }
    }

    // Body for non-GET/HEAD
    const method = req.method.toUpperCase();
    const needsBody = !(method === "GET" || method === "HEAD");
    const body = needsBody ? await req.arrayBuffer() : undefined;

    const tried: string[] = [];
    let last: Response | null = null;

    for (const target of targets) {
      tried.push(target);
      const up = await fetch(target, {
        method, headers, body: needsBody ? body : undefined,
        cache: "no-store", redirect: "manual", signal: ctrl.signal,
      }).catch(() => null as any);

      if (!up) continue;

      // Seller mode: skip admin-only 403s and try next candidate
      if (opts.mode === "seller" && up.status === 403) {
        try {
          const j = await up.clone().json().catch(() => null);
          if (j?.hint === "admin_required") { last = up; continue; }
        } catch { /* ignore */ }
      }

      if (up.status !== 404) {
        const buf = await up.arrayBuffer();
        const isHttps = req.nextUrl.protocol === "https:";
        const respHeaders = copyResponseHeaders(up);
        appendRewrittenSetCookies(respHeaders, up, isHttps);
        respHeaders.set("x-which-route", tag);
        if (token) respHeaders.set("x-auth-promoted-from", src);
        respHeaders.set("x-upstream-tried", tried.join(", "));
        return new NextResponse(buf, { status: up.status, headers: respHeaders });
      }

      last = up;
    }

    // Seller: mask as 404 if only admin/404 responses
    if (opts.mode === "seller") {
      return new NextResponse(JSON.stringify({
        ok: false, error: "not_found", hint: "seller_endpoint_required", tried,
      }), { status: 404, headers: { "content-type": "application/json", "x-which-route": tag, "x-upstream-tried": tried.join(", ") }});
    }

    // Admin: return last or synthesize
    if (last) {
      const buf = await last.arrayBuffer();
      const respHeaders = copyResponseHeaders(last);
      respHeaders.set("x-which-route", tag);
      respHeaders.set("x-upstream-tried", tried.join(", "));
      return new NextResponse(buf, { status: last.status, headers: respHeaders });
    }
    return NextResponse.json({ ok:false, error:"upstream_unreachable", tried: targets }, { status: 502, headers: { "x-which-route": tag }});

  } finally {
    clearTimeout(timer);
  }
}

/* Convenience wrappers */
export function proxySellerMetrics(req: NextRequest) {
  return proxyToBackend(req, { mode: "seller", tag: "seller-metrics" });
}
export function proxyAdmin(req: NextRequest, path: string) {
  return proxyToBackend(req, { mode: "admin", upstreamPath: path, tag: "admin" });
}
