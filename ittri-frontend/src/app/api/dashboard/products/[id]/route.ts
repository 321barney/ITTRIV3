import { BACKEND_BASE, makeGETProxyHandler, OPTIONS, HEAD } from "@/app/api/_proxy/shared";
import type { NextRequest } from "next/server";

export { OPTIONS, HEAD };

/** GET /api/products/:id → product detail (seller-first) */
export const GET = async (req: NextRequest, ctx: { params: { id: string } }) => {
  const id = encodeURIComponent(ctx.params.id);

  const handler = makeGETProxyHandler({
    routeName: "product-detail",
    maskAdminAs404: true,
    candidates: [
      { url: `${BACKEND_BASE}/api/v1/seller/products/${id}`, withQS: true },
      { url: `${BACKEND_BASE}/seller/products/${id}`,        withQS: true },
      { url: `${BACKEND_BASE}/api/v1/products/${id}`,        withQS: true },
    ],
  });

  return handler(req);
};
