// src/app/api/admin/stores/route.ts
import { NextRequest } from "next/server";
import { proxyToBackend } from "@/app/api/_lib/adminProxy";

export const runtime = "nodejs";

/**
 * GET /api/admin/stores
 * Passthrough to backend /admin/stores with any query params:
 *   ?page=1&limit=20&status=active&search=...&seller_id=... (if supported by backend)
 */
export async function GET(req: NextRequest) {
  return proxyToBackend(req, {
    upstreamPath: "/admin/stores",
    tag: "admin-stores-list",
  });
}
