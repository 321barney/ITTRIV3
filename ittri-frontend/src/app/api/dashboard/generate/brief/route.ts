// src/app/api/dashboard/generate/brief/route.ts
import {
  BACKEND_BASE,
  makePOSTProxyHandler,
  OPTIONS as SHARED_OPTIONS,
  HEAD as SHARED_HEAD,
} from "@/app/api/_proxy/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = SHARED_OPTIONS;
export const HEAD = SHARED_HEAD;

// POST /api/dashboard/generate/brief -> backend brief endpoints
export const POST = makePOSTProxyHandler({
  routeName: "dashboard-ai-content-brief",
  candidates: [
    `${BACKEND_BASE}/api/v1/ai/brief`,        // primary
    `${BACKEND_BASE}/api/ai/content/brief`,   // legacy
    `${BACKEND_BASE}/ai/content/brief`,       // no version
    `${BACKEND_BASE}/api/v1/ai/content/brief` // extra fallback
  ],
});

// Optional sanity check
export async function GET() {
  return new Response("Use POST", { status: 405 });
}
