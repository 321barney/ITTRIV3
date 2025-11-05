// src/app/api/dashboard/chat/send/route.ts
import {
  BACKEND_BASE,
  makePOSTProxyHandler,
  OPTIONS,
  HEAD,
} from "@/app/api/_proxy/shared";

export { OPTIONS, HEAD };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Normalize inbound shapes to what most backends accept.
 * We send *both* styles so whichever upstream path matches will be happy:
 * - /api/v1/ai/messages (create message) → { session_id, role, content, store }
 * - /api/v1/ai/chat/send                → { sessionId, message, store }
 */
const normalize = (raw: any) => {
  const msg =
    raw?.message ??
    raw?.text ??
    raw?.prompt ??
    raw?.input ??
    "";

  const session =
    raw?.sessionId ??
    raw?.session_id ??
    null;

  // default model is optional; include if your backend needs it
  const model = raw?.model ?? undefined;

  return {
    ...raw,
    // chat/send-style fields
    message: String(msg || "").trim(),
    sessionId: session ?? undefined,
    session_id: session ?? undefined,
    store: true,
    stream: raw?.stream === true,

    // messages-create-style fields
    role: "user",
    content: String(msg || "").trim(),

    // optional hint for some hubs
    model,
  };
};

export const POST = makePOSTProxyHandler({
  routeName: "dashboard_chat_send",
  candidates: [
    // Prefer message creation API first (this is the one that pairs with your GET /api/v1/ai/messages/:id)
    `${BACKEND_BASE}/api/v1/ai/messages`,
    `${BACKEND_BASE}/api/ai/messages`,
    `${BACKEND_BASE}/ai/messages`,

    // Then classic chat send endpoints
    `${BACKEND_BASE}/api/v1/ai/chat/send`,
    `${BACKEND_BASE}/api/ai/chat/send`,
    `${BACKEND_BASE}/ai/chat/send`,

    // Generic “send” fallbacks
    `${BACKEND_BASE}/api/v1/ai/send`,
    `${BACKEND_BASE}/api/ai/send`,
    `${BACKEND_BASE}/ai/send`,

    // Last resort: codegen endpoint (still includes store+session so it can persist)
    `${BACKEND_BASE}/api/v1/ai/gen`,
  ],
  normalize,
});
