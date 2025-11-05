// app/api/dashboard/stores/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND_BASE,
  withCors,
  filteredResponseHeaders,
  filteredRequestHeaders,
  extractTokens,
  buildUpstreamCookieHeader,
} from "@/app/api/_proxy/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Build headers for upstream (auth + identity hints already handled by shared helpers upstream of this file) */
function buildUpstreamHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {
    ...filteredRequestHeaders(req),
    accept: "application/json",
  };

  // Authorization passthrough
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;

  const xAccess = req.headers.get("x-access-token");
  if (xAccess && !headers.authorization) headers.authorization = `Bearer ${xAccess}`;

  // Pass through org identity/context if present (the backend supports these)
  const orgIdentity = req.headers.get("x-org-identity");
  if (orgIdentity) headers["x-org-identity"] = orgIdentity;
  const orgContext = req.headers.get("x-org-context");
  if (orgContext) headers["x-org-context"] = orgContext;

  // Dev fallback (mirror what worked for /metric/*)
  const devId =
    req.headers.get("x-user-id") ||
    process.env.DEV_USER_ID ||
    process.env.NEXT_PUBLIC_DEV_USER_ID ||
    "";
  if (devId) {
    headers["x-user-id"] = devId;
    if (!headers["x-org-identity"]) {
      const devEmail =
        process.env.DEV_USER_EMAIL || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || "";
      headers["x-org-identity"] = JSON.stringify({
        sellerId: devId,
        email: devEmail || undefined,
      });
    }
  }

  // Cookie fallback identity if header not set
  if (!headers["x-org-identity"]) {
    const cookieUserId =
      req.cookies.get("user_id")?.value ||
      req.cookies.get("seller_id")?.value ||
      "";
    const cookieEmail =
      req.cookies.get("user_email")?.value ||
      req.cookies.get("email")?.value ||
      "";
    if (cookieUserId || cookieEmail) {
      headers["x-org-identity"] = JSON.stringify({
        sellerId: cookieUserId || undefined,
        email: cookieEmail || undefined,
      });
    }
  }

  return headers;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}
export async function HEAD(req: NextRequest) {
  return withCors(req, new NextResponse(null, { status: 200 }));
}

/** GET one store (proxy) */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = `${BACKEND_BASE}/api/v1/seller/stores/${encodeURIComponent(params.id)}`;
    const { access, incomingCookieHeader } = extractTokens(req);
    const headers = buildUpstreamHeaders(req);
    headers.cookie = buildUpstreamCookieHeader(incomingCookieHeader || null, access || null) || "";

    const up = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    const text = await up.text();
    const res = new NextResponse(text, {
      status: up.status,
      headers: filteredResponseHeaders(up),
    });

    res.headers.set("x-which-route", "store-get-one");
    res.headers.set("cache-control", "no-store, must-revalidate");
    return withCors(req, res);
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, error: "proxy_error", detail: String(e?.message || e) },
      { status: 502 },
    );
    res.headers.set("x-which-route", "store-get-one");
    return withCors(req, res);
  }
}

/** Normalize various front-end field names → backend contract */
function normalizeBody(incoming: any) {
  const body = { ...(incoming || {}) };

  // Accept multiple spellings for sheet URL
  const gsheetCandidates = [
    body.gsheet_url,
    body.google_sheet_url,
    body.sheet_url,
    body.sheetUrl,
  ];
  let gsheet_url: string | null | undefined = gsheetCandidates.find(
    (v: any) => typeof v === "string" && v.trim().length > 0,
  );
  if (typeof gsheet_url === "string") gsheet_url = gsheet_url.trim();
  // If an explicit empty string was sent, treat as null (disable)
  if (Object.prototype.hasOwnProperty.call(body, "gsheet_url") && (body.gsheet_url === "" || body.gsheet_url === null)) {
    gsheet_url = null;
  }

  // Accept multiple spellings for tab name
  const sheet_tab =
    typeof body.sheet_tab === "string"
      ? body.sheet_tab
      : typeof body.tab === "string"
      ? body.tab
      : undefined;

  const status = typeof body.status === "string" ? body.status : undefined;
  const name = typeof body.name === "string" ? body.name : undefined;

  // Pass through whatsapp as-is if present
  const whatsapp = body.whatsapp && typeof body.whatsapp === "object" ? body.whatsapp : undefined;

  const out: any = {};
  if (typeof name === "string") out.name = name;
  if (typeof status === "string") out.status = status as any;
  if (gsheet_url !== undefined) out.gsheet_url = gsheet_url;
  if (sheet_tab !== undefined) out.sheet_tab = sheet_tab;
  if (whatsapp) out.whatsapp = whatsapp;
  return out;
}

/** PUT update store (proxy + activation helper) */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const storeId = params.id;

  try {
    const upstreamUrl = `${BACKEND_BASE}/api/v1/seller/stores/${encodeURIComponent(storeId)}`;
    const { access, incomingCookieHeader } = extractTokens(req);
    const headers = { ...buildUpstreamHeaders(req), "content-type": "application/json" } as Record<string, string>;
    headers.cookie = buildUpstreamCookieHeader(incomingCookieHeader || null, access || null) || "";

    // Body from client (normalize)
    const rawIncoming = await req.json().catch(() => ({} as any));
    const proxyBody = normalizeBody(rawIncoming);

    // If trying to activate but client didn't include gsheet_url, fetch the store first and inject it
    const isActivating = proxyBody?.status === "active";
    const hasSheetInBody = Object.prototype.hasOwnProperty.call(proxyBody, "gsheet_url");

    if (isActivating && !hasSheetInBody) {
      const getUrl = `${BACKEND_BASE}/api/v1/seller/stores/${encodeURIComponent(storeId)}`;
      const pre = await fetch(getUrl, {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "manual",
      }).catch(() => null as any);

      if (pre && pre.ok) {
        const j = await pre.json().catch(() => null);
        const urlFromStore = j?.store?.gsheet_url || null;
        if (urlFromStore) {
          proxyBody.gsheet_url = urlFromStore; // inject so backend activation passes
          headers["x-proxy-has-gsheet-url"] = "1";
        } else {
          headers["x-proxy-has-gsheet-url"] = "0";
        }
      } else {
        headers["x-proxy-has-gsheet-url"] = "0";
        headers["x-proxy-preget-status"] = String(pre?.status ?? "n/a");
      }
    }

    // Helpful debug headers
    const keys = Object.keys(proxyBody);
    headers["x-proxy-body-keys"] = keys.length ? keys.join(",") : "none";
    if (proxyBody.status) headers["x-proxy-status"] = String(proxyBody.status);

    const up = await fetch(upstreamUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(proxyBody),
      cache: "no-store",
      redirect: "manual",
    });

    const text = await up.text();
    const res = new NextResponse(text, { status: up.status, headers: filteredResponseHeaders(up) });
    res.headers.set("x-which-route", "store-update-one");
    res.headers.set("cache-control", "no-store, must-revalidate");
    return withCors(req, res);
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, error: "proxy_error", detail: String(e?.message || e) },
      { status: 502 },
    );
    res.headers.set("x-which-route", "store-update-one");
    return withCors(req, res);
  }
}
