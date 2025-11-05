// src/app/api/admin/stores/[id]/route.ts
import { NextRequest } from "next/server";
import { proxyToBackend } from "@/app/api/_lib/adminProxy";

export const runtime = "nodejs";

/**
 * GET /api/admin/stores/:id
 * Fetch one store (details, integrations, etc.)
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  return proxyToBackend(req, {
    upstreamPath: `/admin/stores/${encodeURIComponent(id)}`,
    tag: "admin-stores-read",
  });
}

/**
 * PATCH /api/admin/stores/:id
 * Update store fields (e.g., status, name, gsheet_url, metadata...) depending on backend support.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  return proxyToBackend(req, {
    upstreamPath: `/admin/stores/${encodeURIComponent(id)}`,
    tag: "admin-stores-update",
    passThroughBody: true,
  });
}
