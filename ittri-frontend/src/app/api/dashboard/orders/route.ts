// frontend/src/app/api/dashboard/orders/route.ts
import { BACKEND_BASE, makeGETProxyHandler, OPTIONS, HEAD } from "@/app/api/_proxy/shared";
import type { NextRequest } from "next/server";

export { OPTIONS, HEAD };

/** GET /api/dashboard/orders → backend /api/v1/orders (adds loose=1 fallback) */
export const GET = (req: NextRequest) => {
  const url = new URL(req.url);

  // Copy original query and add a dev-friendly fallback (?loose=1) if not present
  const qs = new URLSearchParams(url.search);
  if (!qs.has("loose")) qs.set("loose", "1");

  // Build a candidate URL that already includes the final querystring.
  const upstream = `${BACKEND_BASE}/api/v1/orders${qs.toString() ? `?${qs.toString()}` : ""}`;

  const handler = makeGETProxyHandler({
    routeName: "dashboard-orders",
    maskAdminAs404: false,
    candidates: [{ url: upstream, withQS: false }], // withQS:false because we already injected the QS
  });

  // @ts-ignore - NextRequest is compatible with the handler's expected type
  return handler(req as any);
};
