import { makeGETProxyHandler, makeWriteProxyHandler, OPTIONS, HEAD, BACKEND_BASE } from "@/app/api/_proxy/shared";
export { OPTIONS, HEAD };

/** GET /api/dashboard/orders/:id → backend /api/v1/orders/:id */
export const GET = (req: Request, ctx: { params: { id: string } }) => {
  const id = encodeURIComponent(ctx.params.id);
  const handler = makeGETProxyHandler({
    routeName: "dashboard-order-detail",
    maskAdminAs404: false,
    candidates: [
      { url: `${BACKEND_BASE}/api/v1/orders/${id}`, withQS: true },
    ],
  });
  // @ts-ignore - NextRequest compatible
  return handler(req as any);
};

/** PATCH /api/dashboard/orders/:id → backend /api/v1/orders/:id */
export const PATCH = async (req: Request, ctx: { params: { id: string } }) => {
  const id = encodeURIComponent(ctx.params.id);
  const handler = makeWriteProxyHandler({
    method: "PATCH",
    routeName: "dashboard-order-update",
    candidates: [
      `${BACKEND_BASE}/api/v1/orders/${id}`,
    ],
  });
  // @ts-ignore - NextRequest compatible
  return handler(req as any);
};
