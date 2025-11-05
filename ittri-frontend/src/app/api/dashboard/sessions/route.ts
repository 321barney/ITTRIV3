// src/app/api/dashboard/sessions/route.ts
import {
  BACKEND_BASE,
  makeGETProxyHandler,
  makePOSTProxyHandler,
  OPTIONS as SHARED_OPTIONS,
  HEAD as SHARED_HEAD,
} from "@/app/api/_proxy/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET sessions (with QS passthrough)
export const GET = makeGETProxyHandler({
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/ai/sessions`, withQS: true }, // primary
    { url: `${BACKEND_BASE}/api/ai/sessions`, withQS: true },
    { url: `${BACKEND_BASE}/ai/sessions`, withQS: true },
    { url: `${BACKEND_BASE}/api/v1/sessions`, withQS: true },    // extra fallback
  ],
  routeName: "dashboard_sessions_get",
});

// POST create session
export const POST = makePOSTProxyHandler({
  candidates: [
    `${BACKEND_BASE}/api/v1/ai/sessions`, // primary
    `${BACKEND_BASE}/api/ai/sessions`,
    `${BACKEND_BASE}/ai/sessions`,
    `${BACKEND_BASE}/api/v1/sessions`,    // extra fallback
  ],
  routeName: "dashboard_sessions_post",
  // If you want to enforce a default title:
  // normalize: (raw: any) => ({ title: raw?.title ?? "Studio Chat", ...raw }),
});

// Preflight / HEAD via shared CORS helpers
export const OPTIONS = SHARED_OPTIONS;
export const HEAD = SHARED_HEAD;
