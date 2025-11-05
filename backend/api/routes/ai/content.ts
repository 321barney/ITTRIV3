// src/api/routes/ai/content.ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClient } from '../../../ai/llm';
import { ensureSession, appendUserMessage, appendAssistantMessage } from './_chatDb';

const briefBody = z.object({
  topic: z.string().trim().min(1),
  audience: z.string().trim().optional(),
  tone: z.string().trim().optional(),
  include_outline: z.boolean().optional(),
  sessionId: z.string().uuid().optional(),         // optional explicit session
  storeId: z.string().uuid().optional(),           // optional for grouping
  title: z.string().trim().max(200).optional(),    // session title (first time)
});

const metaBody = z.object({
  url: z.string().url(),
  sessionId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  title: z.string().trim().max(200).optional(),
});

export default fp(async (app: FastifyInstance) => {
  const db: any = (app as any).db;

  // Create a concise brief for a topic
  app.post('/brief', { preHandler: app.requireAuth }, async (req, reply) => {
    const parse = briefBody.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ ok: false, error: parse.error.flatten() });

    const sellerId = (req as any).user?.id as string;
    const hdrSession = String(req.headers['x-chat-session-id'] || '') || undefined;

    const sessionId = await ensureSession(db, sellerId, {
      sessionId: parse.data.sessionId ?? hdrSession,
      storeId: parse.data.storeId,
      title: parse.data.title ?? `Brief: ${parse.data.topic.slice(0, 60)}`,
    });

    // USER message
    const userPrompt = [
      `Create a concise content brief.`,
      `Topic: ${parse.data.topic}`,
      parse.data.audience ? `Audience: ${parse.data.audience}` : '',
      parse.data.tone ? `Tone: ${parse.data.tone}` : '',
      parse.data.include_outline ? `Include an outline section.` : '',
    ].filter(Boolean).join('\n');

    await appendUserMessage(db, sessionId, userPrompt, { route: 'content/brief' });

    // LLM call
    const client = await getClient();
    const resp = await client.generate({
      prompt: userPrompt,
      options: { temperature: 0.4 },
    });

    const text =
      (resp as any).response ??
      (resp as any).message?.content ??
      JSON.stringify(resp);

    // ASSISTANT message
    const assistant = await appendAssistantMessage(db, sessionId, String(text), {
      model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
    });

    return reply.send({ ok: true, sessionId, message: assistant });
  });

  // Extract SEO meta for a given URL
  app.post('/meta', { preHandler: app.requireAuth }, async (req, reply) => {
    const parse = metaBody.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ ok: false, error: parse.error.flatten() });

    const sellerId = (req as any).user?.id as string;
    const hdrSession = String(req.headers['x-chat-session-id'] || '') || undefined;

    const sessionId = await ensureSession(db, sellerId, {
      sessionId: parse.data.sessionId ?? hdrSession,
      storeId: parse.data.storeId,
      title: parse.data.title ?? `SEO meta: ${parse.data.url.slice(0, 80)}`,
    });

    const userPrompt = `Extract SEO title, description and keywords from this page (return as JSON): ${parse.data.url}`;
    await appendUserMessage(db, sessionId, userPrompt, { route: 'content/meta' });

    const client = await getClient();
    const resp = await client.generate({
      prompt: userPrompt,
      options: { temperature: 0.1 },
    });

    const text =
      (resp as any).response ??
      (resp as any).message?.content ??
      JSON.stringify(resp);

    const assistant = await appendAssistantMessage(db, sessionId, String(text), {
      model: process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
      format: 'json-preferred',
    });

    return reply.send({ ok: true, sessionId, message: assistant });
  });
});
