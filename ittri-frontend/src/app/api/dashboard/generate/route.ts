// src/app/api/dashboard/generate/route.ts
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
 * Normalize generator input to typical codegen contract.
 * Keeps your fields but guarantees the common names are present.
 */
const normalize = (raw: any) => {
  const out: any = { ...raw };

  // unified “code” mode
  out.mode = "code";

  // prompt & source
  out.prompt =
    typeof out.prompt === "string"
      ? out.prompt
      : (out.instructions ?? out.message ?? "");

  out.source = typeof out.source === "string" ? out.source : (out.input ?? "");

  // file + format
  out.fileName = out.fileName ?? "index.html";
  out.format = String(out.format || "").toLowerCase() === "react" ? "react" : "html";

  // session persistence (if present, store into the same thread)
  const sid = out.sessionId ?? out.session_id ?? null;
  if (sid) {
    out.store = true;
    out.sessionId = sid;
    out.session_id = sid;
  }

  // streaming flag
  out.stream = out.stream === true;

  return out;
};

export const POST = makePOSTProxyHandler({
  routeName: "dashboard_generate_code",
  candidates: [
    `${BACKEND_BASE}/api/v1/ai/gen`,
    `${BACKEND_BASE}/api/v1/ai/code/gen`,
    `${BACKEND_BASE}/api/ai/code/gen`,
    `${BACKEND_BASE}/api/ai/generate`,
    `${BACKEND_BASE}/api/generate`,
    `${BACKEND_BASE}/generate`,
  ],
  normalize,
});
