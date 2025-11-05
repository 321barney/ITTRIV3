// src/api/routes/ai/codegen.ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getClient } from '../../../ai/llm';
import { ensureSession, appendUserMessage, appendAssistantMessage } from './_chatDb';

//
// Helper: Enhance the user prompt when it is too short.
//
// For very short briefs, the resulting landing page is often generic. This helper
// calls the LLM once to rewrite and expand a brief into a rich, constraint-driven
// prompt. The enhancement is only triggered when the input is fewer than 16
// words. The system prompt is inspired by the seo/enhance endpoint and asks
// the model to return JSON with a "prompt" field. If parsing fails, the
// original prompt is returned unchanged.
async function maybeEnhancePrompt(prompt: string): Promise<string> {
  try {
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 16) return prompt;
    const client = await getClient();
    const sys = [
      'You are a world-class prompt engineer.',
      'Rewrite and expand the user brief into a clear, constraint-driven prompt for an LLM.',
      'Prefer specificity; include inputs/outputs, formatting, and acceptance criteria.',
      'Keep the final prompt under ~300 words.',
    ].join(' ');
    const reqPrompt = [
      'Brief to enhance:',
      '---',
      prompt,
      '---',
      'Return JSON with shape:',
      '{"prompt":"<enhanced prompt>"}',
    ].join('\n');
    const resp: any = await client.generate({ system: sys, prompt: reqPrompt, options: { temperature: 0.3 } });
    const text: string = resp?.response ?? resp?.message?.content ?? resp?.content ?? '';
    try {
      const data = JSON.parse(text);
      const enhanced = String((data as any)?.prompt ?? '').trim();
      return enhanced || prompt;
    } catch {
      const trimmed = String(text || '').trim();
      return trimmed || prompt;
    }
  } catch {
    return prompt;
  }
}

// ---- Zod schema ----
const bodySchema = z.object({
  prompt: z.string().min(1),
  format: z.enum(['html', 'react']).default('html'),
  sections: z.array(z.string()).optional(),
  brand: z.object({
    name: z.string().optional(),
    primaryColor: z.string().optional(),
    font: z.string().optional(),
    logoUrl: z.string().optional(),
  }).partial().optional(),
  stream: z.boolean().optional(),
  options: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
  }).partial().optional(),

  // chat persistence
  sessionId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  title: z.string().trim().max(200).optional(),
});

type Body = z.infer<typeof bodySchema>;

declare module 'fastify' {
  interface FastifyInstance {
    _codegenRegistered?: boolean;
    requireAuth?: any;
    db?: unknown;
  }
}

const CODEGEN_GUARD = Symbol.for('plugin.codegen.registered');

function isAsyncIterable(x: any): x is AsyncIterable<any> {
  return x && typeof x[Symbol.asyncIterator] === 'function';
}
function chunkToText(chunk: any): string {
  if (!chunk) return '';
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);
  return (
    chunk.response ??
    chunk.delta ??
    chunk.message?.content ??
    chunk.content ??
    (typeof chunk.text === 'string' ? chunk.text : '')
  ) || '';
}

export default fp(async (app: FastifyInstance) => {
  const anyApp = app as any;
  if (anyApp[CODEGEN_GUARD] || app._codegenRegistered) {
    app.log.warn('[codegen] Plugin already registered — skipping second registration.');
    return;
  }
  anyApp[CODEGEN_GUARD] = true;
  app._codegenRegistered = true;

  const db: any = anyApp.db;
  const routeOpts: Record<string, unknown> = {};
  if (app.requireAuth) routeOpts.preHandler = app.requireAuth;

  app.post<{ Body: Body }>(
    '/gen',
    routeOpts,
    async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
      }

      let { prompt, format, sections = ['hero', 'features', 'pricing', 'cta'], brand, stream, options } = parsed.data;

      const sellerId = (req as any).user?.id as string | undefined;
      const hdrSession = String(req.headers['x-chat-session-id'] || '') || undefined;

      const sessionId = await ensureSession(db, sellerId, {
        sessionId: parsed.data.sessionId ?? hdrSession,
        storeId: parsed.data.storeId,
        title: parsed.data.title ?? `Codegen: ${format.toUpperCase()}`,
      });

      // Compose a system prompt that strongly biases the generator toward the ITTRI visual identity.
      // In addition to the format and sections, describe the expected look and feel: cosmic gradients,
      // translucent glass surfaces, rounded corners, and futuristic buttons. These cues help ensure
      // that landing pages align with the broader site aesthetic. Classes like `glass`,
      // `btn-futuristic` and the gradient utility should be used whenever possible. The LLM will
      // incorporate these directives into the generated markup. Note: each line is joined with \n.
      const sys = [
        `You are a landing page generator. Format=${format}. Sections=${sections.join(',')}.`,
        brand?.name
          ? `Brand=${brand.name}, PrimaryColor=${brand.primaryColor ?? ''}, Font=${brand.font ?? ''}${brand.logoUrl ? `, LogoUrl=${brand.logoUrl}` : ''}`
          : '',
        // ITTRI design guidelines: cosmic gradients, glass surfaces, and futuristic components
        'Design guidelines: adopt the ITTRI aesthetic — use a cosmic gradient background that transitions from sky to purple to indigo in light mode and from dark neutral tones in dark mode (e.g., bg-gradient-to-b from-sky-50 via-purple-50 to-indigo-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-900). Wrap the page in a min-h-screen container with appropriate padding. Employ semi‑transparent glass panels (like class `glass`) or `bg-white/10` with backdrop-blur for sections and card-like areas. All panels should have rounded corners and subtle borders. Use buttons styled with the `btn-futuristic` class for primary calls to action. Prefer responsive layouts with Tailwind classes and avoid hard-coded colors; instead rely on CSS variables (e.g., var(--foreground), var(--background)).',
        `Output only the ${format === 'html' ? 'complete HTML document' : 'React component (export default App)'} without commentary.`,
        '',
      ].filter(Boolean).join('\n');

      // Optionally enhance short prompts to improve output. The original prompt is
      // replaced if the helper returns a non-empty string. We keep a copy to
      // record meta information about whether enhancement occurred.
      const originalPrompt = prompt;
      try {
        const enhanced = await maybeEnhancePrompt(prompt);
        if (enhanced && enhanced !== prompt) {
          prompt = enhanced;
        }
      } catch {
        /* ignore enhancement errors and use original prompt */
      }

      await appendUserMessage(db, sessionId, [sys, prompt].join('\n'), {
        route: 'codegen/gen',
        format,
        sections,
        brand,
        originalPrompt,
        enhancedPrompt: prompt,
      });

      const client = await getClient();
      const wantStream = Boolean(stream);

      // providers return: GenerateResponse {response: string} OR AsyncIterable<StreamChunk>
      const modelResp = await client.generate({
        prompt: [sys, prompt].join('\n'),
        stream: wantStream,
        options: { temperature: options?.temperature ?? 0.2, max_tokens: options?.max_tokens },
      });

      // ---- Streaming (NDJSON)
      if (wantStream && (isAsyncIterable(modelResp))) {
        reply.hijack();
        reply.raw.setHeader('content-type', 'application/x-ndjson; charset=utf-8');

        const encoder = new TextEncoder();
        let total = 0;
        let assembled = '';

        try {
          for await (const chunk of modelResp) {
            const delta = chunkToText(chunk);
            if (delta) {
              assembled += delta;
              total += Buffer.byteLength(delta);
            }
            reply.raw.write(encoder.encode(JSON.stringify({ type: 'progress', bytes: total }) + '\n'));
          }
        } catch (e) {
          reply.raw.write(encoder.encode(JSON.stringify({ type: 'error', message: String((e as any)?.message || e) }) + '\n'));
        }

        await appendAssistantMessage(db, sessionId, assembled, {
          model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
          format,
        });

        const finalData =
          format === 'html'
            ? { html: assembled, meta: { format, model: 'stream' } }
            : { react: { files: [{ path: 'page.tsx', contents: assembled }] }, meta: { format, model: 'stream' } };

        reply.raw.write(encoder.encode(JSON.stringify({ type: 'final', sessionId, data: finalData }) + '\n'));
        return reply.raw.end();
      }

      // ---- Non-stream
      const nonStream =
        (modelResp as any).response ??
        (modelResp as any).message?.content ??
        (modelResp as any).content ??
        '';

      const saved = await appendAssistantMessage(db, sessionId, String(nonStream), {
        model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
        format,
      });

      const metaModel = (saved as any)?.meta_json?.model || 'unknown';

      if (format === 'html') {
        return reply.send({ ok: true, sessionId, html: String(nonStream), meta: { format, model: metaModel } });
      }
      return reply.send({
        ok: true,
        sessionId,
        react: { files: [{ path: 'page.tsx', contents: String(nonStream) }] },
        meta: { format, model: metaModel },
      });
    }
  );
});
