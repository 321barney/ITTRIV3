// API: list/create stores under /api/dashboard/stores

import {
  BACKEND_BASE,
  makeGETProxyHandler,
  makePOSTProxyHandler,
  normalizers,
  OPTIONS as SHARED_OPTIONS,
  HEAD as SHARED_HEAD,
} from "@/app/api/_proxy/shared";

// Pass through OPTIONS/HEAD for CORS & probes
export const OPTIONS = SHARED_OPTIONS;
export const HEAD = SHARED_HEAD;

// GET /api/dashboard/stores → proxy to seller-scoped list (keeps ?status=…)
export const GET = makeGETProxyHandler({
  routeName: "dashboard-stores-list",
  maskAdminAs404: true,
  candidates: [
    { url: `${BACKEND_BASE}/api/v1/seller/stores`, withQS: true },
    { url: `${BACKEND_BASE}/seller/stores`,        withQS: true },
  ],
});

// POST /api/dashboard/stores → create (plan-capped; idempotent reuse)
export const POST = makePOSTProxyHandler({
  routeName: "dashboard-stores-create",
  candidates: [
    `${BACKEND_BASE}/api/v1/seller/stores`,
    `${BACKEND_BASE}/seller/stores`,
  ],
  normalize: normalizers.store, // maps name/gsheet_url/etc from frontend keys
});
