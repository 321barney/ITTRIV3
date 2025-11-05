// src/api/routes/ai/messages.ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Messages API for AI chat sessions.
 *
 * Exposes a read-only endpoint to fetch all messages belonging to a given
 * `sessionId`. Messages are ordered chronologically. This enables
 * clients to hydrate chat history from the database instead of relying
 * on localStorage. Requires that the `db` and optional auth preHandler
 * decorations be present on the Fastify instance.
 */
export default fp(async function messagesPlugin(app: FastifyInstance) {
  // Only register once
  const anyApp = app as any;
  if (anyApp._aiMessagesRegistered) return;
  anyApp._aiMessagesRegistered = true;

  const db: any = anyApp.db;
  if (!db) {
    app.log.warn('[ai/messages] No database available. Messages endpoint will not work.');
    return;
  }

  // PreHandler (if requireAuth exists) ensures only authenticated users can access chat history
  const routeOpts: Record<string, unknown> = {};
  if (app.requireAuth) routeOpts.preHandler = app.requireAuth;

  /**
   * GET /messages/:sessionId
   *
   * Returns an array of messages for the specified session. Each message
   * includes its id, role, content, and timestamp. Meta fields are omitted.
   */
  app.get('/messages/:sessionId', routeOpts, async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = (req.params as any) || {};
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: 'sessionId required' });
    }
    try {
      const rows = await db('ai_chat_messages')
        .select('id', 'role', 'content', 'created_at')
        .where({ session_id: sessionId })
        .orderBy('created_at', 'asc');
      const messages = rows.map((r: any) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        timestamp: new Date(r.created_at).getTime(),
      }));
      return reply.send({ ok: true, sessionId, messages });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message || String(err) }, 'Failed to fetch chat messages');
      return reply.code(500).send({ ok: false, error: 'failed_to_fetch_messages' });
    }
  });
}, { name: 'ai-messages' });