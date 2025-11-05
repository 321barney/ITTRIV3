/* eslint-disable @typescript-eslint/no-explicit-any */
import { SignJWT, importPKCS8, decodeJwt } from "jose";
import { BACKEND_BASE } from "@/lib/api/config";

const ORG_CONTEXT_ISSUER   = process.env.ORG_CONTEXT_ISSUER!;
const ORG_CONTEXT_AUDIENCE = process.env.ORG_CONTEXT_AUDIENCE!;
const ORG_CONTEXT_PRIVATE_KEY_PKCS8 = process.env.ORG_CONTEXT_PRIVATE_KEY_PKCS8!;

let _orgCtxKeyPromise: Promise<CryptoKey> | null = null;
function importOrgCtxKey() {
  if (!_orgCtxKeyPromise) _orgCtxKeyPromise = importPKCS8(ORG_CONTEXT_PRIVATE_KEY_PKCS8, "EdDSA");
  return _orgCtxKeyPromise;
}
export async function signOrgContext(sellerId: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importOrgCtxKey();
  return new SignJWT({ context: { sellerId, email } })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setIssuer(ORG_CONTEXT_ISSUER)
    .setAudience(ORG_CONTEXT_AUDIENCE)
    .sign(key);
}

function isLikelyJwt(s?: string | null) { return !!s && /^[-\w]+\.[-\w]+\.[-\w]+$/.test(s); }
function decodeJwtSafe(token?: string | null): Record<string, any> | null {
  try { return token ? (decodeJwt(token) as any) : null; } catch { return null; }
}

export function extractTokens(req: Request) {
  // @ts-ignore - NextRequest has .cookies but we support plain Request via headers too
  const cookies = (req as any).cookies?.get
    ? (req as any).cookies
    : null;

  const headerCookie = req.headers.get("cookie") || null;

  const accessCookie =
    (cookies?.get("__Host-access_token")?.value) ||
    (cookies?.get("__Secure-access_token")?.value) ||
    (cookies?.get("access_token")?.value) ||
    (cookies?.get("accessToken")?.value) ||
    (cookies?.get("id_token")?.value) ||
    null;

  const refresh =
    (cookies?.get("__Host-refresh_token")?.value) ||
    (cookies?.get("__Secure-refresh_token")?.value) ||
    (cookies?.get("refresh_token")?.value) ||
    (cookies?.get("refreshToken")?.value) ||
    null;

  let accessHeader: string | null = null;
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && /^Bearer\s+(.+)/i.test(auth)) accessHeader = auth.replace(/^Bearer\s+/i, "").trim();
  if (!accessCookie && !accessHeader) {
    const x = req.headers.get("x-access-token");
    if (isLikelyJwt(x)) accessHeader = x!;
  }

  return {
    access: accessCookie || accessHeader,
    refresh,
    headerCookie,
  };
}

export function buildCookieHeader(existing: string | null, accessToken: string | null) {
  let cookie = existing || "";
  if (accessToken && !/(^|;\s*)access_token=/.test(cookie)) {
    cookie = cookie ? `${cookie}; access_token=${encodeURIComponent(accessToken)}` : `access_token=${encodeURIComponent(accessToken)}`;
  }
  return cookie || null;
}

export function identityFromJwtOrCookies(req: any, accessToken: string | null) {
  const p = decodeJwtSafe(accessToken);
  let sellerId: string | null =
    (p?.sellerId as string) || (p?.sub as string) || (p?.user_id as string) || null;
  let email: string | null =
    (p?.email as string) || (p?.user_email as string) || (p?.preferred_username as string) || (p?.upn as string) || null;

  if (!sellerId) sellerId = req.cookies?.get?.("user_id")?.value || null;
  if (!email)    email    = req.cookies?.get?.("user_email")?.value || null;

  return { sellerId, email };
}

export function backendUrl(path: string) {
  const base = BACKEND_BASE.replace(/\/+$/,'');
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
