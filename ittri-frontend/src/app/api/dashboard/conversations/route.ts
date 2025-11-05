import { BACKEND_BASE, makeGETProxyHandler, OPTIONS, HEAD } from "@/app/api/_proxy/shared";

export { OPTIONS, HEAD };

export const GET = makeGETProxyHandler({
  routeName: "conversations-list",
  maskAdminAs404: true,
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/conversations`, withQS: true },
    { url: `${BACKEND_BASE}/conversations`,        withQS: true },
  ],
});
