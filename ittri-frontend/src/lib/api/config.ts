// src/lib/api/config.ts
const pick = (...vals: (string | undefined | null)[]) => vals.find(Boolean) ?? "";

/** Read from multiple env names so different deploys still work */
const rawBase = pick(
  process.env.API_INTERNAL_BASE,       // preferred for internal/proxy calls
  process.env.BACKEND_URL,             // common alt
  process.env.NEXT_PUBLIC_BACKEND_BASE // last resort (client-visible)
)
  .trim()
  .replace(/\/+$/, "");

if (!rawBase) {
  throw new Error(
    "BACKEND_URL or API_INTERNAL_BASE must be set (e.g. https://<backend-host>.replit.dev:8000)"
  );
}

/** Basic URL sanity check (protocol + host) */
function assertValidAbsoluteUrl(u: string) {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`Invalid BACKEND_BASE URL: ${u}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`BACKEND_BASE must be http(s): ${u}`);
  }
  if (!parsed.hostname) {
    throw new Error(`BACKEND_BASE is missing hostname: ${u}`);
  }
}
assertValidAbsoluteUrl(rawBase);

/** Optional API prefix (matches backend API_PREFIX when used) */
const rawPrefix = pick(
  process.env.NEXT_PUBLIC_BACKEND_API_PREFIX,
  process.env.BACKEND_API_PREFIX,
  process.env.API_PREFIX
).trim();

function normalizePrefix(p: string) {
  if (!p || p === "/") return "";
  return `/${p.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}
export const BACKEND_API_PREFIX: string = normalizePrefix(rawPrefix);

/** Public exports */
export const BACKEND_BASE: string = rawBase;

/** Helper to build backend URLs safely (base + optional prefix + path) */
export const backendUrl = (path: string) => {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_BASE}${BACKEND_API_PREFIX}${clean}`;
};

/** Allowlist of proxied path prefixes (no wildcard access to backend) */
export const ALLOWLIST_PREFIXES = [
  "/auth/",
  "/seller/",
  "/admin/",
  "/orders",
  "/products",
  "/ai/",
  "/ittri/",
  "/diag/",
] as const;

/** Size & timeout limits */
export const BODY_LIMIT_BYTES = 512 * 1024; // 512 KB
export const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 10000);

/** Security toggles */
export const REQUIRE_CSRF = process.env.NODE_ENV !== "development";

/** Optional: expose useful flags */
export const IS_DEV = process.env.NODE_ENV !== "production";
export const BUILD_TIME = process.env.BUILD_TIME ?? "";

/** 🔐 NEW: optional shared secret the proxy sends to backend */
export const PROXY_TOKEN = process.env.PROXY_TOKEN || "";
