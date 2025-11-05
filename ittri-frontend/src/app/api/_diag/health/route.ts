import { NextRequest } from "next/server";
import { proxyToBackend } from "@/app/api/_lib/adminProxy";

export const runtime = "nodejs";

/**
 * GET /api/admin/health
 * Proxies to backend /admin/health to verify:
 *  - cookie -> Authorization promotion works
 *  - admin scope is reachable
 */
export async function GET(req: NextRequest) {
  return proxyToBackend(req, {
    upstreamPath: "/admin/health",
    tag: "admin-health",
  });
}
