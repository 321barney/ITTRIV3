// src/api/routes/ai/chat.ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getClient } from '../../../ai/llm';
import { ensureSession, appendUserMessage, appendAssistantMessage } from './_chatDb';

/**
 * Chat API for AI interactions.
 *
 * Exposes a POST /chat/send endpoint that accepts a user message and optionally
 * a session identifier. If no sessionId is provided or the specified session
 * does not exist, a new session is created. The endpoint supports streaming
 * responses from the underlying LLM provider when `stream` is true. It also
 * supports updating a `user_need` field within the session metadata when
 * `updateNeed` is provided.
 */
export default fp(async function chatPlugin(app: FastifyInstance) {
  const anyApp = app as any;
  if (anyApp._aiChatRegistered) return;
  anyApp._aiChatRegistered = true;

  const db: any = anyApp.db;
  if (!db) {
    app.log.warn('[ai/chat] No database available. Chat endpoint will not work.');
    return;
  }

  const routeOpts: Record<string, unknown> = {};
  if (app.requireAuth) routeOpts.preHandler = app.requireAuth;

  // Define the expected request body using Zod for runtime validation
  const BodySchema = z.object({
    sessionId: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
    message: z.string().min(1),
    updateNeed: z.string().min(1).optional(),
    stream: z.boolean().optional().default(false),
  });

  app.post('/chat/send', routeOpts, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = BodySchema.safeParse((req as any).body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
    }
    const { sessionId: maybeSession, storeId, message, updateNeed, stream } = parsed.data;
    const sellerId = (req as any).user?.id as string | undefined;
    if (!sellerId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    try {
      // Determine or create a session. A title derived from the message is used when creating.
      const title = message.slice(0, 64);
      const sessionId = await ensureSession(db, sellerId, {
        sessionId: maybeSession,
        storeId: storeId ?? undefined,
        title,
      });
      // Append the user message to the database
      await appendUserMessage(db, sessionId, message, { route: 'chat/send' });
      // Update the session's user_need if provided
      if (updateNeed) {
        // Detect which meta column exists: meta_json or metadata
        let metaCol: 'meta_json' | 'metadata' = 'metadata';
        try {
          const row = await db
            .select(
              db.raw(
                `EXISTS(
                  SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = ?
                    AND column_name = ?
                ) AS has_col`,
                ['ai_chat_sessions', 'meta_json']
              )
            )
            .first();
          metaCol = (row as any)?.has_col ? 'meta_json' : 'metadata';
        } catch {
          metaCol = 'metadata';
        }
        const updateJson = JSON.stringify({ user_need: updateNeed });
        await db('ai_chat_sessions')
          .where({ id: sessionId, seller_id: sellerId })
          .update({
            [metaCol]: db.raw(`coalesce(${metaCol}, '{}'::jsonb) || ?::jsonb`, updateJson),
          });
      }
      // Get the LLM client
      const client = await getClient();
      const sysPrompt = 'You are a helpful assistant. Keep answers concise.';
      const wantStream = Boolean(stream);
      const llmResp = await client.chat({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: message },
        ],
        stream: wantStream,
        options: { temperature: 0.2, max_tokens: 600 },
      });
      if (wantStream && Symbol.asyncIterator in Object(llmResp)) {
        // Hijack the response to stream NDJSON chunks
        reply.hijack();
        reply.raw.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
        const enc = new TextEncoder();
        let full = '';
        try {
          for await (const chunk of llmResp as any) {
            const delta =
              (chunk as any)?.delta ??
              (chunk as any)?.content ??
              (chunk as any)?.response ??
              (chunk as any)?.text ??
              '';
            if (!delta) continue;
            full += delta;
            reply.raw.write(enc.encode(JSON.stringify({ delta }) + '\n'));
          }
        } catch (streamErr: any) {
          req.log?.error?.({ err: streamErr?.message || String(streamErr) }, '[ai/chat] streaming error');
        } finally {
          await appendAssistantMessage(db, sessionId, full, { route: 'chat/send' });
          reply.raw.end();
        }
        return;
      }
      // Non-streaming: extract text response
      const text = (llmResp as any)?.response ?? String(llmResp ?? '');
      await appendAssistantMessage(db, sessionId, text, { route: 'chat/send' });
      return reply.send({ ok: true, sessionId, reply: text });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message || String(err) }, '[ai/chat] failed to process chat');
      return reply.code(500).send({ ok: false, error: 'failed_to_process_chat' });
    }
  });
}, { name: 'ai-chat' });