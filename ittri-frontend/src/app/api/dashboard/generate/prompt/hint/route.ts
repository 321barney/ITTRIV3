import {
  BACKEND_BASE,
  makePOSTProxyHandler,
  OPTIONS,
  HEAD,
} from "@/app/api/_proxy/shared";

export { OPTIONS, HEAD };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/dashboard/generate/prompt/hints → backend /api/ai/seo/hints
export const POST = makePOSTProxyHandler({
  routeName: "dashboard-ai-prompt-hints",
  maskAdminAs404: true,
  notFoundHint: "ai_route_not_found",
  // Prefer new unified hints endpoint first
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/ai/hints`, withQS: true },            // new unify
    { url: `${BACKEND_BASE}/api/ai/seo/hints`, withQS: true },           // old SEO
    { url: `${BACKEND_BASE}/ai/seo/hints`, withQS: true },               // no version
    { url: `${BACKEND_BASE}/api/v1/ai/seo/hints`, withQS: true },        // fallback v1 path
  ],
});

// quick sanity check
export async function GET() {
  return new Response("Use POST", { status: 405 });
}
