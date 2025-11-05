// src/app/api/dashboard/generate/prompt/enhance/route.ts
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

// POST /api/dashboard/generate/prompt/enhance → backend /api/ai/seo/enhance
export const POST = makePOSTProxyHandler({
  routeName: "dashboard-ai-prompt-enhance",
  candidates: [
    `${BACKEND_BASE}/api/v1/ai/enhance`,        // primary (unified)
    `${BACKEND_BASE}/api/ai/seo/enhance`,      // legacy SEO
    `${BACKEND_BASE}/ai/seo/enhance`,          // no version
    `${BACKEND_BASE}/api/v1/ai/seo/enhance`,   // v1 fallback
  ],
});

// Optional sanity check
export async function GET() {
  return new Response("Use POST", { status: 405 });
}
