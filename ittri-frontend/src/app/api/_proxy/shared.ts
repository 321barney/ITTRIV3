/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { SignJWT, importPKCS8, decodeJwt } from "jose";

/** ========= ENV ========= **/
export const BACKEND_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_BASE ||
  process.env.BACKEND_BASE ||
  ""
).replace(/\/+$/, "");
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 10000);
const ORG_CONTEXT_ISSUER = process.env.ORG_CONTEXT_ISSUER!;
const ORG_CONTEXT_AUDIENCE = process.env.ORG_CONTEXT_AUDIENCE!;
const ORG_CONTEXT_PRIVATE_KEY_PKCS8 = process.env.ORG_CONTEXT_PRIVATE_KEY_PKCS8!;
export const runtime = "nodejs";

if (!BACKEND_BASE) throw new Error("BACKEND_BASE env is required");
if (!ORG_CONTEXT_ISSUER || !ORG_CONTEXT_AUDIENCE || !ORG_CONTEXT_PRIVATE_KEY_PKCS8) {
  throw new Error("ORG_CONTEXT_ISSUER, ORG_CONTEXT_AUDIENCE, ORG_CONTEXT_PRIVATE_KEY_PKCS8 envs are required");
}

/** ========= tiny timing helper ========= **/
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function pushTiming(h: Headers, name: string, durMs: number) {
  const prev = h.get("Server-Timing");
  const line = `${name};dur=${Math.max(0, Math.round(durMs))}`;
  h.set("Server-Timing", prev ? `${prev}, ${line}` : line);
}

/** ========= streaming helpers ========= **/
function isStreamingContentType(ct: string | null | undefined) {
  if (!ct) return false;
  const v = ct.toLowerCase();
  return (
    v.includes("text/event-stream") ||
    v.includes("application/x-ndjson") ||
    v.includes("ndjson") ||
    // some backends stream "text/plain" lines
    (v.startsWith("text/") && !v.includes("html"))
  );
}
function wantsStreaming(req: NextRequest) {
  const acc = req.headers.get("accept")?.toLowerCase() || "";
  return acc.includes("text/event-stream") || acc.includes("application/x-ndjson");
}

/** ========= CORS + header helpers ========= **/
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
export function OPTIONS(req: NextRequest) { return withCors(req, new NextResponse(null, { status: 204 })); }
export function HEAD(req: NextRequest) { return withCors(req, new NextResponse(null, { status: 200 })); }

export function filteredRequestHeaders(req: NextRequest) {
  const hop = new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade","host","accept-encoding","content-length"]);
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

/** ========= Cookies ========= **/
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
export function mergeSetCookieIntoCookieHeader(existingCookieHeader: string | null, setCookieHeader: string): string {
  const jar: Record<string, string> = {};
  if (existingCookieHeader) {
    for (const kv of existingCookieHeader.split(";")) {
      const [k, ...rest] = kv.trim().split("=");
      if (!k) continue;
      jar[k] = rest.join("=");
    }
  }
  for (const one of splitSetCookie(setCookieHeader)) {
    const m = one.match(/^\s*([^=;\s]+)=([^;]*)/);
    if (!m) continue;
    const [, name, val] = m;
    jar[name] = val;
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
export function cookieLine(name: string, value: string, isHttps: boolean, maxAge = 3600) {
  const attrs = ["Path=/","HttpOnly","SameSite=Lax", isHttps ? "Secure" : "", `Max-Age=${maxAge}`].filter(Boolean);
  return `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`;
}

/** Merge raw cookie pairs (e.g., "session=abc; other=def") into a Cookie header */
function mergeCookiePairs(existing: string | null, extraPairs: string | null): string | null {
  if (!extraPairs && (existing || "") === "") return null;
  const jar: Record<string, string> = {};
  const add = (line: string) => {
    if (!line) return;
    for (const part of line.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (!k) continue;
      jar[k] = rest.join("=");
    }
  };
  if (existing) add(existing);
  if (extraPairs) add(extraPairs);
  const out = Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ");
  return out || null;
}

/** ========= Tokens & identity ========= **/
function isLikelyJwt(s?: string | null) { return !!s && /^[-\w]+\.[-\w]+\.[-\w]+$/.test(s); }
function decodeJwtSafe(token?: string | null): Record<string, any> | null {
  try { return token ? (decodeJwt(token) as any) : null; } catch { return null; }
}

/**
 * Extracts:
 *  - access: JWT from cookies/headers OR bridged `be_jwt`
 *  - refresh: refresh token from cookies (if any)
 *  - incomingCookieHeader: original Cookie header
 *  - bridgeCookie: raw backend cookie pair(s) from `be_cookie` (decoded)
 */
export function extractTokens(req: NextRequest) {
  const accessCookie =
    req.cookies.get("__Host-access_token")?.value ||
    req.cookies.get("__Secure-access_token")?.value ||
    req.cookies.get("access_token")?.value ||
    req.cookies.get("accessToken")?.value ||
    req.cookies.get("id_token")?.value ||
    // bridged JWT from our login proxy
    req.cookies.get("be_jwt")?.value ||
    null;

  const refresh =
    req.cookies.get("__Host-refresh_token")?.value ||
    req.cookies.get("__Secure-refresh_token")?.value ||
    req.cookies.get("refresh_token")?.value ||
    req.cookies.get("refreshToken")?.value ||
    null;

  let accessHeader: string | null = null;
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && /^Bearer\s+(.+)/i.test(auth)) accessHeader = auth.replace(/^Bearer\s+/i, "").trim();
  if (!accessCookie && !accessHeader) {
    const x = req.headers.get("x-access-token");
    if (isLikelyJwt(x)) accessHeader = x!;
  }

  const incomingCookieHeader = req.headers.get("cookie") || null;

  // Bridged raw backend cookie (name=value[; name2=value2...]) set by our login proxy
  let bridgeCookie = req.cookies.get("be_cookie")?.value || null;
  try { if (bridgeCookie) bridgeCookie = decodeURIComponent(bridgeCookie); } catch {}

  return { access: accessCookie || accessHeader, refresh, incomingCookieHeader, bridgeCookie };
}

/**
 * Build upstream Cookie header:
 *  - start with incoming frontend cookies (if any)
 *  - add access_token=<JWT> if we have a token
 *  - merge bridged backend cookie pairs (be_cookie)
 */
export function buildUpstreamCookieHeader(
  incomingCookieHeader: string | null,
  accessToken: string | null,
  bridgeCookie: string | null
): string | null {
  // include access_token cookie for backends that read it from Cookie
  const withAccess = (incomingCookieHeader || "")
    + (accessToken && !/(^|;\s*)access_token=/.test(incomingCookieHeader || "")
        ? (incomingCookieHeader ? `; access_token=${encodeURIComponent(accessToken)}` : `access_token=${encodeURIComponent(accessToken)}`)
        : "");

  // merge the bridged backend cookie pair(s)
  return mergeCookiePairs(withAccess || null, bridgeCookie);
}

function getIdentityFromCookies(req: NextRequest): { sellerId: string | null; email: string | null } {
  const sellerId =
    req.cookies.get("user_id")?.value ||
    req.cookies.get("seller_id")?.value ||
    null;
  const email =
    req.cookies.get("user_email")?.value ||
    req.cookies.get("email")?.value ||
    null;
  return { sellerId, email };
}

/** ========= Org Context signer (Ed25519) ========= **/
let _orgCtxKeyPromise: Promise<CryptoKey> | null = null;
function importOrgCtxKey() {
  if (!_orgCtxKeyPromise) _orgCtxKeyPromise = importPKCS8(ORG_CONTEXT_PRIVATE_KEY_PKCS8, "EdDSA");
  return _orgCtxKeyPromise;
}
async function signOrgContext(sellerId: string, email: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  const key = await importOrgCtxKey();
  return new SignJWT({ context: { sellerId, email } })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 60)
    .setIssuer(ORG_CONTEXT_ISSUER)
    .setAudience(ORG_CONTEXT_AUDIENCE)
    .sign(key);
}

/** ========= Identity resolution ========= **/
async function resolveIdentity(
  req: NextRequest,
  accessToken: string | null,
  cookieHeader: string | null,
  signal: AbortSignal,
  timingHeaders: Headers
): Promise<{ sellerId: string | null; email: string | null }> {
  const t0 = now();
  const p = decodeJwtSafe(accessToken);
  let sellerId: string | null = (p?.sellerId as string) || (p?.sub as string) || (p?.user_id as string) || null;
  let email: string | null = (p?.email as string) || (p?.user_email as string) || (p?.preferred_username as string) || (p?.upn as string) || null;
  if (sellerId && email) {
    pushTiming(timingHeaders, "identity_resolve", now() - t0);
    return { sellerId, email };
  }
  const idc = getIdentityFromCookies(req);
  sellerId = sellerId || idc.sellerId;
  email    = email    || idc.email;
  if (sellerId && email) {
    pushTiming(timingHeaders, "identity_resolve", now() - t0);
    return { sellerId, email };
  }
  const meURL = `${BACKEND_BASE}/api/v1/auth/me`;
  const headers: Record<string,string> = { accept: "application/json" };
  if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;
  if (cookieHeader) headers["cookie"] = cookieHeader;

  const r = await fetch(meURL, { method: "GET", headers, cache: "no-store", redirect: "manual", signal }).catch(() => null as any);
  if (r && r.status === 200) {
    try {
      const json = await r.json();
      const d = json?.data || json || {};
      sellerId = d.id || d.user_id || d.seller_id || d.sellerId || d.sub || null;
      email    = d.email || d.user_email || d.username || null;
    } catch {}
  }
  pushTiming(timingHeaders, "identity_resolve", now() - t0);
  return { sellerId: sellerId || null, email: email || null };
}

/** ========= Body parsing & normalization ========= **/
async function readBodyAuto(req: NextRequest): Promise<any> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.startsWith("application/json")) {
      return await req.json();
    }
    if (ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data")) {
      const fd = await req.formData();
      const o: any = {};
      fd.forEach((v, k) => { if (typeof v === "string") o[k] = v; });
      return o;
    }
    // Fallback: try JSON → form
    return await req.json().catch(async () => {
      const fd = await req.formData().catch(() => null as any);
      if (!fd) return {};
      const o: any = {};
      fd.forEach((v, k) => { if (typeof v === "string") o[k] = v; });
      return o;
    });
  } catch {
    return {};
  }
}

function normalizeStorePayload(raw: any): any {
  const out: any = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  const pick = (...keys: string[]) => keys.find(has);
  const trim = (v: any) => (typeof v === "string" ? v.trim() : v);

  const nameKey = pick("name", "store_name", "storeName");
  if (nameKey) out.name = trim(raw[nameKey]);

  const statusKey = pick("status");
  if (statusKey) out.status = String(raw[statusKey]).toLowerCase();

  const urlKey = pick("gsheet_url", "gsheetUrl", "sheet", "sheet_url", "sheetUrl");
  if (urlKey) out.gsheet_url = trim(raw[urlKey]);

  const tabKey = pick("sheet_tab", "sheetTab", "tab");
  if (tabKey) out.sheet_tab = trim(raw[tabKey]);

  if (has("whatsapp")) out.whatsapp = raw.whatsapp;
  return out;
}

/** ========= Discovery + fetch ========= **/
async function fetchWithCandidates(
  candidates: Array<{ url: string; withQS?: boolean }>,
  qs: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  tried: string[],
  maskAdminAs404: boolean
) {
  let firstAuthError: Response | null = null;

  const tryOne = async (entry: { url: string; withQS?: boolean }) => {
    const full = `${entry.url}${entry.withQS ? qs : ""}`;
    tried.push(full);
    const r = await fetch(full, { method: "GET", headers, cache: "no-store", redirect: "manual", signal }).catch(() => null as any);
    return r;
  };

  for (const c of candidates) {
    const r = await tryOne(c);
    if (!r) continue;

    if (r.status === 403) {
      if (maskAdminAs404) {
        try {
          const j = await r.clone().json();
          if (j?.hint === "admin_required") continue;
        } catch {}
      }
      if (!firstAuthError) firstAuthError = r;
      continue;
    }
    if (r.status === 401) {
      if (!firstAuthError) firstAuthError = r;
      continue;
    }
    if (r.status !== 404) return r;
  }

  if (firstAuthError) return firstAuthError;

  return new Response(
    JSON.stringify({
      ok: false,
      error: "route_not_found",
      message: "No matching upstream responded.",
      tried,
    }),
    { status: 404, headers: { "content-type": "application/json" } }
  );
}

async function tryRefreshForAccess(
  BACKEND: string,
  refreshToken: string | null,
  cookieHeader: string | null,
  signal: AbortSignal,
  timingHeaders: Headers
) {
  const t0 = now();
  const candidates = [
    `${BACKEND}/auth/refresh`,
    `${BACKEND}/refresh`,
    `${BACKEND}/api/v1/auth/refresh`,
  ];
  for (const url of candidates) {
    const headers: Record<string,string> = { accept:"application/json", "content-type":"application/json" };
    if (cookieHeader) headers["cookie"] = cookieHeader;
    const rf = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      cache: "no-store",
      redirect: "manual",
      signal,
    }).catch(() => null as any);
    if (!rf) continue;
    if (rf.status === 404) continue;
    const setCookie = rf.headers.get("set-cookie") || undefined;
    const ct = rf.headers.get("content-type") || "";
    let access: string | undefined;
    if (/^application\/json\b/i.test(ct)) {
      try {
        const json = await rf.clone().json();
        access = json?.access_token || json?.id_token || json?.token || json?.jwt;
      } catch {}
    }
    pushTiming(timingHeaders, "refresh_attempt", now() - t0);
    if (access) return { access, setCookie };
    if (setCookie) return { setCookie };
  }
  pushTiming(timingHeaders, "refresh_attempt", now() - t0);
  return null;
}

/** ========= Factory: GET proxy ========= **/
export function makeGETProxyHandler(opts: {
  candidates: Array<{ url: string; withQS?: boolean }>;
  maskAdminAs404?: boolean;
  notFoundHint?: string;
  routeName: string;
}) {
  const { candidates, maskAdminAs404 = true, notFoundHint, routeName } = opts;

  return async function GET(req: NextRequest) {
    const t0 = now();
    const tried: string[] = [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);

    try {
      const isHttps = req.nextUrl.protocol === "https:";
      const passHeaders: Record<string,string> = {
        ...filteredRequestHeaders(req),
        accept: req.headers.get("accept") || "application/json",
      };
      const qs = req.nextUrl.search || "";

      const { access, refresh, incomingCookieHeader, bridgeCookie } = extractTokens(req);

      if (!access && !refresh && !bridgeCookie) {
        const res = NextResponse.json(
          { ok:false, error:"no_access_token", hint:"Login first or include Authorization: Bearer <jwt>" },
          { status: 401, headers: { "x-which-route": routeName, "x-auth-had-token":"0" } }
        );
        pushTiming(res.headers, "proxy_total", now() - t0);
        return withCors(req, res);
      }

      if (access) passHeaders["authorization"] = `Bearer ${access}`;
      passHeaders["cookie"] = buildUpstreamCookieHeader(incomingCookieHeader, access || null, bridgeCookie || null) || "";

      // Identity
      const tmpTimings = new Headers();
      const identity = await resolveIdentity(req, access || null, passHeaders["cookie"], ctrl.signal, tmpTimings);
      if (identity.sellerId || identity.email) {
        passHeaders["X-Org-Identity"] = JSON.stringify({
          sellerId: identity.sellerId ?? undefined,
          email: identity.email ?? undefined,
        });
        if (identity.sellerId && identity.email) {
          try { passHeaders["X-Org-Context"] = await signOrgContext(identity.sellerId, identity.email); } catch {}
        }
      }

      let up = await fetchWithCandidates(candidates, qs, passHeaders, ctrl.signal, tried, maskAdminAs404);

      // 401 → refresh and retry
      let refreshSetCookie: string | undefined;
      if (up.status === 401 && (refresh || bridgeCookie)) {
        const refreshed = await tryRefreshForAccess(BACKEND_BASE, refresh || null, passHeaders["cookie"] || null, ctrl.signal, tmpTimings);
        if (refreshed?.access) {
          passHeaders["authorization"] = `Bearer ${refreshed.access}`;
          passHeaders["cookie"] = buildUpstreamCookieHeader(passHeaders["cookie"] || null, refreshed.access, null) || "";
        }
        if (refreshed?.setCookie) {
          refreshSetCookie = refreshed.setCookie;
          passHeaders["cookie"] = mergeSetCookieIntoCookieHeader(passHeaders["cookie"] || "", refreshSetCookie);
        }
        if (refreshed?.access || refreshed?.setCookie) {
          up = await fetchWithCandidates(candidates, qs, passHeaders, ctrl.signal, tried, maskAdminAs404);
        }
      }

      // --- streaming-aware response ---
      const ct = up.headers.get("content-type") || "";
      const passthrough = isStreamingContentType(ct) || wantsStreaming(req);

      const baseHeaders = filteredResponseHeaders(up);
      const res = new NextResponse(passthrough ? up.body : await up.text(), { status: up.status, headers: baseHeaders });

      res.headers.set("x-upstream-status", String(up.status));
      res.headers.set("x-upstream-tried", tried.join(", "));
      res.headers.set("x-which-route", routeName);
      res.headers.set("cache-control", "no-store, must-revalidate");

      if (refreshSetCookie) applySetCookies(res, refreshSetCookie, isHttps);

      const pre = tmpTimings.get("Server-Timing");
      if (pre) res.headers.set("Server-Timing", pre);
      pushTiming(res.headers, "proxy_total", now() - t0);

      return withCors(req, res);
    } catch (e: any) {
      const name = e?.name || "";
      const msg = String(e?.message || e);
      const status = name === "AbortError" || /timeout/i.test(msg) ? 504 : 502;
      const res = NextResponse.json(
        { error:"upstream_error", detail: msg, backend: BACKEND_BASE },
        { status, headers: { "x-which-route": routeName } }
      );
      pushTiming(res.headers, "proxy_total", now() - t0);
      return withCors(req, res);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** ========= Factory: WRITE proxy (POST / PUT / PATCH) ========= **/
type Normalizer = (raw: any) => any;
export function makeWriteProxyHandler(opts: {
  method: "POST" | "PUT" | "PATCH";
  candidates: string[];           // exact URLs to try in order
  routeName: string;
  normalize?: Normalizer;         // optional: transform/rename fields before forwarding
}) {
  const { method, candidates, routeName, normalize } = opts;

  return async function WRITE(req: NextRequest) {
    const t0 = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);
    const tried: string[] = [];

    try {
      const isHttps = req.nextUrl.protocol === "https:";
      const raw = await readBodyAuto(req);
      const body = normalize ? normalize(raw) : raw;

      const passHeaders: Record<string, string> = {
        ...filteredRequestHeaders(req),
        accept: req.headers.get("accept") || "application/json",
        "content-type": "application/json",
      };

      const { access, refresh, incomingCookieHeader, bridgeCookie } = extractTokens(req);
      if (!access && !refresh && !bridgeCookie) {
        const res = NextResponse.json(
          { ok:false, error:"no_access_token", hint:"Login first or include Authorization: Bearer <jwt>" },
          { status: 401, headers: { "x-which-route": routeName, "x-auth-had-token":"0" } }
        );
        pushTiming(res.headers, "proxy_total", now() - t0);
        return withCors(req, res);
      }

      if (access) passHeaders["authorization"] = `Bearer ${access}`;
      passHeaders["cookie"] = buildUpstreamCookieHeader(incomingCookieHeader, access || null, bridgeCookie || null) || "";

      const tmpTimings = new Headers();
      const identity = await resolveIdentity(req, access || null, passHeaders["cookie"], ctrl.signal, tmpTimings);
      if (identity.sellerId || identity.email) {
        passHeaders["X-Org-Identity"] = JSON.stringify({
          sellerId: identity.sellerId ?? undefined,
          email: identity.email ?? undefined,
        });
        if (identity.sellerId && identity.email) {
          try { passHeaders["X-Org-Context"] = await signOrgContext(identity.sellerId, identity.email); } catch {}
        }
      }

      const doWrite = async (): Promise<Response> => {
        for (const url of candidates) {
          tried.push(url);
          const r = await fetch(url, {
            method,
            headers: passHeaders,
            body: JSON.stringify(body),
            cache: "no-store",
            redirect: "manual",
            signal: ctrl.signal,
          }).catch(() => null as any);
          if (!r) continue;
          if (r.status === 404) continue;
          return r;
        }
        return new Response(JSON.stringify({ ok:false, error:"route_not_found", tried }), { status: 404, headers: { "content-type":"application/json" }});
      };

      let up = await doWrite();

      // 401 → refresh once and retry
      let refreshSetCookie: string | undefined;
      if (up.status === 401 && (refresh || bridgeCookie)) {
        const refreshed = await tryRefreshForAccess(BACKEND_BASE, refresh || null, passHeaders["cookie"] || null, ctrl.signal, tmpTimings);
        if (refreshed?.access) {
          passHeaders["authorization"] = `Bearer ${refreshed.access}`;
          passHeaders["cookie"] = buildUpstreamCookieHeader(passHeaders["cookie"] || null, refreshed.access, null) || "";
        }
        if (refreshed?.setCookie) {
          refreshSetCookie = refreshed.setCookie;
          passHeaders["cookie"] = mergeSetCookieIntoCookieHeader(passHeaders["cookie"] || "", refreshSetCookie);
        }
        if (refreshed?.access || refreshed?.setCookie) {
          up = await doWrite();
        }
      }

      // --- streaming-aware response ---
      const ct = up.headers.get("content-type") || "";
      const passthrough = isStreamingContentType(ct) || wantsStreaming(req);

      const baseHeaders = filteredResponseHeaders(up);
      const res = new NextResponse(passthrough ? up.body : await up.text(), { status: up.status, headers: baseHeaders });

      // Debug for body mapping (kept as before)
      const rawKeys = Object.keys(raw || {});
      const bodyKeys = Object.keys(body || {});
      res.headers.set("x-proxy-body-keys", rawKeys.length ? rawKeys.sort().join(",") : "none");
      res.headers.set("x-proxy-norm-keys", bodyKeys.length ? bodyKeys.sort().join(",") : "none");
      res.headers.set("x-proxy-has-gsheet-url", body?.gsheet_url ? "1" : (bodyKeys.includes("gsheet_url") ? "0-empty" : "0"));

      res.headers.set("x-which-route", routeName);
      res.headers.set("x-upstream-status", String(up.status));
      res.headers.set("x-upstream-tried", tried.join(", "));
      res.headers.set("cache-control", "no-store, must-revalidate");

      if (refreshSetCookie) applySetCookies(res, refreshSetCookie, isHttps);
      const setCookie = up.headers.get("set-cookie");
      if (setCookie) applySetCookies(res, setCookie, isHttps);

      const pre = tmpTimings.get("Server-Timing");
      if (pre) res.headers.set("Server-Timing", pre);
      pushTiming(res.headers, "proxy_total", now() - t0);

      return withCors(req, res);
    } catch (e: any) {
      const name = e?.name || "";
      const msg = String(e?.message || e);
      const status = name === "AbortError" || /timeout/i.test(msg) ? 504 : 502;
      const res = NextResponse.json(
        { error:"upstream_error", detail: msg, backend: BACKEND_BASE },
        { status, headers: { "x-which-route": routeName } }
      );
      pushTiming(res.headers, "proxy_total", now() - t0);
      return withCors(req, res);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** ========= Back-compat POST helper ========= **/
export function makePOSTProxyHandler(opts: {
  candidates: string[];
  routeName: string;
  /** If you want normalization (e.g., store field mapping), pass a function. */
  normalize?: (raw: any) => any;
}) {
  return makeWriteProxyHandler({ method: "POST", ...opts });
}

/** ========= Convenience export for store payloads ========= **/
export const normalizers = {
  store: normalizeStorePayload,
};
