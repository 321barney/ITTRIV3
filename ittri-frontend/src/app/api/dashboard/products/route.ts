import { BACKEND_BASE, makeGETProxyHandler, OPTIONS, HEAD } from "@/app/api/_proxy/shared";

export { OPTIONS, HEAD };

export const GET = makeGETProxyHandler({
  routeName: "products",
  maskAdminAs404: true,
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/seller/products`, withQS: true },
    { url: `${BACKEND_BASE}/seller/products`,        withQS: true },
    { url: `${BACKEND_BASE}/api/v1/products`,        withQS: true },
  ],
});
