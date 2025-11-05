// src/api/routes/ai/seo.ts
// Repurposed: prompt-generation enhancement utilities (no SEO).
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getClient } from '../../../ai/llm';
import { ensureSession, appendUserMessage, appendAssistantMessage } from './_chatDb';

const enhanceBody = z.object({
  brief: z.string().min(1, 'brief is required'),
  tone: z.enum(['neutral', 'friendly', 'professional', 'playful', 'bold']).optional(),
  audience: z.string().optional(),
  goals: z.array(z.string()).optional(),
  max_words: z.number().int().positive().max(4000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
});

const hintsBody = z.object({
  topic: z.string().min(1, 'topic is required'),
  style: z.enum(['concise', 'detailed', 'technical', 'story', 'list']).optional(),
  include_keywords: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
    db?: unknown;
    _seoRegistered?: boolean;
  }
}

// Unique symbol to be resilient across multiple bundles
const SEO_GUARD = Symbol.for('plugin.ai.seo.registered');

export default fp(async function seoPlugin(app: FastifyInstance) {
  const anyApp = app as any;
  if (anyApp[SEO_GUARD] || app._seoRegistered) {
    app.log.warn('[ai/seo] Plugin already registered — skipping.');
    return;
  }
  anyApp[SEO_GUARD] = true;
  app._seoRegistered = true;

  const db: any = anyApp.db;

  // Build route opts so we don't pass undefined preHandler
  const baseRouteOpts: Record<string, unknown> = {};
  if (app.requireAuth) baseRouteOpts.preHandler = app.requireAuth;

  // POST /api/.../seo/enhance
  app.post<{ Body: z.infer<typeof enhanceBody> }>(
    '/enhance',
    { ...baseRouteOpts },
    async (req: FastifyRequest<{ Body: z.infer<typeof enhanceBody> }>, rep: FastifyReply) => {
      const parsed = enhanceBody.safeParse(req.body);
      if (!parsed.success) {
        return rep.code(400).send({ ok: false, error: parsed.error.flatten() });
      }

      const user = (req as any).user;
      const { brief, tone, audience, goals = [], max_words, temperature = 0.3, top_p } = parsed.data;

      const sys = [
        'You are a world-class prompt engineer.',
        'Rewrite and expand the user brief into a clear, constraint-driven prompt for an LLM.',
        'Prefer specificity; include inputs/outputs, formatting, and acceptance criteria.',
        tone ? `Desired tone: ${tone}.` : null,
        audience ? `Intended audience: ${audience}.` : null,
        goals.length ? `Primary goals: ${goals.join('; ')}.` : null,
        max_words ? `Keep the final prompt under ~${max_words} words.` : null,
      ]
        .filter(Boolean)
        .join(' ');

      const client = await getClient();
      const modelResp: any = await client.generate({
        system: sys,
        prompt: [
          'Brief to enhance:',
          '---',
          brief,
          '---',
          'Return JSON with shape:',
          `{"prompt":"<enhanced prompt>", "tips":["...","..."], "checks":["...","..."]}`,
        ].join('\n'),
        options: { temperature, top_p },
      });

      const text = modelResp?.response ?? modelResp?.message?.content ?? '';
      let data: { prompt: string; tips?: string[]; checks?: string[] };
      try {
        data = JSON.parse(text);
      } catch {
        data = { prompt: String(text || '').trim(), tips: [], checks: [] };
      }

      // Persist conversation via unified chat session storage
      try {
        const sessionId = await ensureSession(db, user?.id ?? null, {
          title: `SEO Enhance: ${brief.slice(0, 60)}`,
        });
        // User message
        await appendUserMessage(db, sessionId, brief, {
          route: 'seo/enhance',
          tone,
          audience,
          goals,
          max_words,
        });
        // Assistant message
        await appendAssistantMessage(db, sessionId, data.prompt, {
          model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
          tips: data.tips ?? [],
          checks: data.checks ?? [],
        });
      } catch (e: any) {
        req.log?.warn?.({ err: e?.message || String(e) }, 'chat session insert failed (continuing)');
      }

      return rep.send({ ok: true, ...data });
    }
  );

  // POST /api/.../seo/hints
  app.post<{ Body: z.infer<typeof hintsBody> }>(
    '/hints',
    { ...baseRouteOpts },
    async (req: FastifyRequest<{ Body: z.infer<typeof hintsBody> }>, rep: FastifyReply) => {
      const parsed = hintsBody.safeParse(req.body);
      if (!parsed.success) {
        return rep.code(400).send({ ok: false, error: parsed.error.flatten() });
      }

      const user = (req as any).user;
      const {
        topic,
        style = 'concise',
        include_keywords = [],
        avoid = [],
        temperature = 0.2,
        top_p,
      } = parsed.data;

      const prompt = [
        'Produce structured prompt-building hints for the given topic.',
        `Topic: ${topic}`,
        `Style: ${style}`,
        include_keywords.length ? `Must-include terms: ${include_keywords.join(', ')}` : null,
        avoid.length ? `Avoid: ${avoid.join(', ')}` : null,
        '',
        'Return JSON with shape:',
        `{"constraints":["..."], "sections":[{"title":"...","guide":"..."}], "sample_openers":["...","..."]}`,
      ]
        .filter(Boolean)
        .join('\n');

      const client = await getClient();
      const modelResp: any = await client.generate({
        system: 'You are concise and practical. Focus on actionable constraints and structure.',
        prompt,
        options: { temperature, top_p },
      });

      const text = modelResp?.response ?? modelResp?.message?.content ?? '';
      let data:
        | { constraints: string[]; sections: Array<{ title: string; guide: string }>; sample_openers: string[] }
        | undefined;
      try {
        data = JSON.parse(text);
      } catch {
        data = { constraints: [], sections: [], sample_openers: [String(text || '').trim()] };
      }

      // Persist chat session
      try {
        const sessionId = await ensureSession(db, user?.id ?? null, {
          title: `SEO Hints: ${topic.slice(0, 60)}`,
        });
        await appendUserMessage(db, sessionId, JSON.stringify({ topic, style, include_keywords, avoid }), {
          route: 'seo/hints',
        });
        await appendAssistantMessage(db, sessionId, JSON.stringify(data), {
          model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
        });
      } catch (e: any) {
        req.log?.warn?.({ err: e?.message || String(e) }, 'chat session insert failed (continuing)');
      }

      return rep.send({ ok: true, ...data! });
    }
  );
});
