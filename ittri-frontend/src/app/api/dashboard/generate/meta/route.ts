// src/app/api/dashboard/generate/meta/route.ts
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

// POST /api/dashboard/generate/meta → backend meta endpoints
export const POST = makePOSTProxyHandler({
  routeName: "dashboard-ai-content-meta",
  candidates: [
    `${BACKEND_BASE}/api/v1/ai/meta`,          // primary
    `${BACKEND_BASE}/api/ai/content/meta`,     // legacy
    `${BACKEND_BASE}/ai/content/meta`,         // no version
    `${BACKEND_BASE}/api/v1/ai/content/meta`,  // extra fallback
  ],
});

// quick sanity check
export async function GET() {
  return new Response("Use POST", { status: 405 });
}
