import { BACKEND_BASE, makeGETProxyHandler, OPTIONS, HEAD } from "@/app/api/_proxy/shared";

export { OPTIONS, HEAD };

// Try seller-safe metrics first; attach ?period=… to overview endpoints.
export const GET = makeGETProxyHandler({
  routeName: "dashboard-metrics",
  maskAdminAs404: true,
  notFoundHint: "seller_endpoint_required",
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/metric/overview`, withQS: true },
    { url: `${BACKEND_BASE}/metric/overview`,        withQS: true },
    { url: `${BACKEND_BASE}/api/v1/seller/dashboard` },
    { url: `${BACKEND_BASE}/seller/dashboard`        },
  ],
});
