// backend/src/ai/providers/select.ts
import * as openai from "./openai";
import * as ollama from "./ollama";

/** Arguments both providers accept. Keep in sync with your provider files. */
export type CodegenArgs = {
  prompt: string;
  format: "html" | "react";
  source?: string;
  fileName?: string;
  stream?: boolean;
};

/** Minimal provider interface that both concrete providers satisfy. */
export interface CodegenProvider {
  name: "openai" | "ollama";
  generate(args: CodegenArgs): Promise<
    | { content: string }                                         // non-stream
    | { stream: NodeJS.ReadableStream; contentType?: string }     // stream
  >;
}

/** 0 => ollama, 1 => openai (default). Also accept strings like "ollama"/"openai". */
function pickProviderId() {
  const raw =
    (process.env.LLM_PROVIDER_ID ?? process.env.LLM_PROVIDER ?? "1")
      .toString()
      .trim()
      .toLowerCase();
  if (raw === "0" || raw === "ollama") return 0;
  if (raw === "1" || raw === "openai") return 1;
  return 1; // default to OpenAI
}

export function getProvider(): CodegenProvider {
  const id = pickProviderId();
  if (id === 0) {
    return { name: "ollama", generate: (args) => ollama.generate(args as any) };
  }
  // Default: OpenAI
  return { name: "openai", generate: (args) => openai.generate(args as any) };
}
