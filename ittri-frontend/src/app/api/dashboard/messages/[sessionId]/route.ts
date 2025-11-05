// src/app/api/dashboard/messages/[sessionId]/route.ts
import { NextRequest } from "next/server";
import {
  BACKEND_BASE as SHARED_BACKEND_BASE,
  makeGETProxyHandler,
  OPTIONS as SHARED_OPTIONS,
  HEAD as SHARED_HEAD,
} from "@/app/api/_proxy/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_BASE = (
  SHARED_BACKEND_BASE ||
  process.env.NEXT_PUBLIC_BACKEND_BASE ||
  process.env.BACKEND_BASE ||
  "http://localhost:8080"
).replace(/\/+$/, "");

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const id = params.sessionId;

  // Build candidates with the concrete session id; include QS passthrough.
  const candidates = [
    `/api/v1/ai/messages/${id}`, // primary (matches your logs)
    `/api/v1/messages/${id}`,
    `/api/ai/messages/${id}`,
    `/ai/messages/${id}`,
  ].map((p) => ({ url: `${BACKEND_BASE}${p}`, withQS: true }));

  // Use the shared proxy (adds Authorization/cookies, refresh-on-401, identity headers, etc.)
  const handler = makeGETProxyHandler({
    candidates,
    routeName: "dashboard_messages",
    // maskAdminAs404: true (default) — keeps admin-only 403s from leaking
  });

  return handler(req);
}

// CORS / preflight helpers from shared
export const OPTIONS = SHARED_OPTIONS;
export const HEAD = SHARED_HEAD;
