"use client";

// Streams from /api/dashboard/generate and persists chat locally.
// Now supports mode selection (code/brief/meta/enhance/hints) + SSE/NDJSON.
// UPDATED: format normalization to backend-safe "html" | "react" + filename extension fix.

export type ChatItem = { id: string; role: "user" | "assistant"; text: string; at: number };

const CHAT_KEY = "ittri.chat";
const CONV_KEY = "ittri.conversation";
const GENERATE_API = "/api/v1/ai/generate";

// --- Utils ---
function wordCount(s: string) {
  return (s.trim().match(/\b[\w#@.-]+\b/g) || []).length;
}

// Heuristic: decide if a prompt is "rich"
export function isRichPrompt(s: string) {
  const wc = wordCount(s);
  const hasSignals = /(?:https?:\/\/|<\w|function\s|class\s|#\w|:\s|\d{4}|SQL|SELECT|INSERT|UPDATE|DELETE|\{|\}|\(|\)|;)/i.test(s);
  return wc >= 24 || hasSignals;
}

export function enhancePromptBase(s: string) {
  const trimmed = s.trim();
  return [
    `Goal: ${trimmed}`,
    "Audience: [who is this for?]",
    "Tone: [friendly / formal / playful]",
    "Key points: [3 bullets]",
    "Constraints: [length, brand words, do/don't]",
  ].join("\n");
}

// UUID-ish fallback
function uid() {
  try { return crypto.randomUUID(); } catch { return String(Date.now()) + Math.random().toString(16).slice(2); }
}

// Storage helpers
function readChat(): ChatItem[] {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]") as ChatItem[]; } catch { return []; }
}
function writeChat(arr: ChatItem[]) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(arr)); } catch {}
}
function writeConversationMeta(input: string, when: number) {
  try {
    const conv = { id: uid(), provider: "openai", createdAt: when, title: input.slice(0, 64), lastAt: when, messageCount: readChat().length };
    localStorage.setItem(CONV_KEY, JSON.stringify(conv));
  } catch {}
}

// --- Networked generator ---
type Mode = "code" | "brief" | "meta" | "enhance" | "hints";

type StartLandingOpts = {
  mode?: Mode;                       // selects backend route (default: "code")
  sessionId?: string;                // forwarded as x-chat-session-id
  fileName?: string;                 // used for code mode
  format?: "text" | "html" | "react" | "markdown" | "css" | "code" | "htm" | "tsx" | "jsx";
  source?: string;                   // current editor content (optional)
  extra?: Record<string, any>;       // extra payload fields to send
  onDelta?: (delta: string, full: string) => void;
  onDone?: (full: string) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;              // optional external abort
};

// --- NEW: normalize format + filename ---
function normalizeFormat(fmt?: StartLandingOpts["format"], fileName?: string): "html" | "react" {
  const f = String(fmt || "").toLowerCase();

  if (f === "react" || f === "tsx" || f === "jsx") return "react";
  if (f === "html" || f === "htm") return "html";

  // Infer from filename if not explicit
  const low = (fileName || "").toLowerCase();
  if (low.endsWith(".tsx") || low.endsWith(".jsx")) return "react";
  return "html";
}

function ensureFileName(name: string, fmt: "html" | "react"): string {
  const low = name.toLowerCase().trim();
  if (fmt === "react") {
    if (low.endsWith(".tsx") || low.endsWith(".jsx")) return name;
    return name.replace(/\.html?$/i, "").replace(/\.(md|txt|js|css)$/i, "") + ".tsx";
  }
  // html
  if (low.endsWith(".html")) return name;
  return name.replace(/\.(tsx|jsx)$/i, "").replace(/\.(md|txt|js|css)$/i, "") + ".html";
}

/**
 * Starts a landing conversation and streams an assistant reply
 * from /api/dashboard/generate. Returns an abort() handle.
 */
export function startLanding(arg: string, opts: StartLandingOpts = {}) {
  const input = String(arg || "").trim();
  if (!input) return { abort: () => {} };

  const now = Date.now();
  const userMsg: ChatItem = { id: uid(), role: "user", text: input, at: now };

  // Optimistic placeholder we’ll stream into
  const assistantId = uid();
  const placeholder = isRichPrompt(input)
    ? "Thinking…"
    : `Your prompt was brief; here's a clearer working brief while I generate a first pass:\n\n${enhancePromptBase(input)}\n\n---\nGenerating…`;

  const asstMsg: ChatItem = { id: assistantId, role: "assistant", text: placeholder, at: now + 1 };

  // Persist
  const chat = readChat();
  chat.push(userMsg, asstMsg);
  writeChat(chat);
  writeConversationMeta(input, now);

  // Build payload
  const mode: Mode = opts.mode ?? "code";
  const payload: any = {
    mode,                                 // lets the proxy pick /api/ai/* correctly
    stream: true,
    ...(opts.extra || {}),
  };

  // Map common shapes per mode
  if (mode === "code") {
    // Normalize format + filename so backend always sees "html" or "react"
    const fmt = normalizeFormat(opts.format, opts.fileName);
    // When no fileName is provided, default to 'landing.html' for HTML or 'App.tsx' for React. Using
    // 'landing.html' avoids overwriting the main index file.
    const defaultName = fmt === 'react' ? 'App.tsx' : 'landing.html';
    const fname = ensureFileName(opts.fileName ?? defaultName, fmt);

    payload.prompt   = input;
    payload.input    = input; // some backends use "input"
    payload.fileName = fname;
    payload.format   = fmt;
    if (opts.source) payload.source = opts.source;
  } else if (mode === "brief") {
    // content brief expects topic, audience/tone optional
    payload.topic            = input;
    payload.include_outline  = payload.include_outline ?? true;
  } else if (mode === "meta") {
    // meta often expects a URL; if you passed extra.url we'll use that
    payload.url = payload.url ?? input;
  } else if (mode === "enhance" || mode === "hints") {
    // SEO helpers typically expect "brief"
    payload.brief = payload.brief ?? input;
  }

  const controller = new AbortController();
  const signal = opts.signal ? new AbortSignalProxy(opts.signal, controller).signal : controller.signal;

  (async () => {
    try {
      const res = await fetch(GENERATE_API, {
        method: "POST",
        // In order to forward cookies (e.g. user_id and user_email) to the
        // Next.js proxy for authentication, credentials must be included.
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/x-ndjson, application/json, text/plain, */*",
          ...(opts.sessionId ? { "x-chat-session-id": opts.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const errTxt = await safeText(res);
        throw new Error(errTxt || `Request failed with status ${res.status}`);
      }

      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      let full = "";

      const isSSE    = ctype.includes("text/event-stream");
      const isNDJSON = ctype.includes("ndjson") || ctype.includes("application/x-ndjson");
      const isText   = ctype.startsWith("text/") || ctype === "" /* some servers forget ctype */;

      if (res.body && (isSSE || isNDJSON || isText)) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        const push = (delta: string) => {
          if (!delta) return;
          full += delta;
          updateAssistantMessage(assistantId, full);
          opts.onDelta?.(delta, full);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // Split on either \n or \r\n
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);

            line = line.replace(/\r$/, "");
            if (!line.trim()) continue;

            // If SSE, strip "data: " prefix
            if (isSSE) {
              const m = line.match(/^data:\s*(.*)$/i);
              if (m) line = m[1];
              // Some SSE streams send [DONE]
              if (line.trim() === "[DONE]") continue;
            }

            // Try to parse JSON
            try {
              const evt = JSON.parse(line);
              if (evt?.error) throw new Error(evt.error);

              // Handle NDJSON event types
              if (typeof evt?.type === "string") {
                if (evt.type === "progress") {
                  // ignore progress events
                  continue;
                }
              if (evt.type === "final") {
                  // Persist sessionId (for chat history) if provided
                  const sid = (evt.sessionId || evt.session_id) as string | undefined;
                  if (sid) {
                    try {
                      localStorage.setItem('studio.sessionId', sid);
                    } catch {}
                  }

                  const data = evt.data ?? {};
                  let out = "";
                  if (data?.html) {
                    out = String(data.html);
                  } else if (data?.react?.files?.[0]?.contents) {
                    out = String(data.react.files[0].contents);
                  } else if (typeof data?.content === "string") {
                    out = data.content;
                  }
                  full = out;
                  updateAssistantMessage(assistantId, full || "");
                  opts.onDelta?.(out, full);
                  continue;
                }
                // unknown type: fall through
              }

              // Fallback to legacy fields
              const delta =
                (typeof evt?.delta === "string" && evt.delta) ||
                (typeof evt?.content === "string" && evt.content) ||
                (typeof evt?.text === "string" && evt.text) ||
                "";
              if (delta) {
                push(delta);
              } else {
                // Unknown shape: append raw line
                push(line + "\n");
              }
            } catch {
              // Not JSON → treat as raw text
              push(line + "\n");
            }
          }
        }

        // Flush any trailing buffer (as plain text)
        if (buf.trim()) {
          push(buf);
          buf = "";
        }
      } else if (ctype.includes("application/json")) {
        const data = await res.json();
        full = data?.content ?? data?.html ?? data?.result ?? data?.text ?? "";
        updateAssistantMessage(assistantId, full || "(empty)");
      } else {
        full = await res.text();
        updateAssistantMessage(assistantId, full || "(empty)");
      }

      opts.onDone?.(full);
      writeConversationMeta(input, Date.now());
    } catch (e: any) {
      if (e?.name === "AbortError") {
        updateAssistantMessage(assistantId, "(cancelled)");
        return;
      }
      const msg = `Generation failed.\n\n${String(e?.message || e)}`;
      updateAssistantMessage(assistantId, msg);
      opts.onError?.(e);
    }
  })();

  return { abort: () => controller.abort() };
}

// --- Internal helpers ---
function updateAssistantMessage(id: string, text: string) {
  const arr = readChat();
  const idx = arr.findIndex((m) => m.id === id && m.role === "assistant");
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], text, at: Date.now() };
    writeChat(arr);
  }
}

async function safeText(res: Response) {
  try { return await res.text(); } catch { return ""; }
}

/** Merge two AbortSignals so aborting either cancels the request. */
class AbortSignalProxy {
  public signal: AbortSignal;
  constructor(external: AbortSignal, internalController: AbortController) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(external.reason);
    const onInternalAbort = () => controller.abort(internalController.signal.reason);
    external.addEventListener("abort", onExternalAbort, { once: true });
    internalController.signal.addEventListener("abort", onInternalAbort, { once: true });
    this.signal = controller.signal;
  }
}
