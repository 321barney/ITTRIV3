// src/api/routes/ai/sessions.ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Sessions API for AI chat.
 *
 * Provides two endpoints:
 *   - GET /sessions: list the user's chat sessions in descending order of creation.
 *   - POST /sessions: create a new chat session. Accepts an optional `title` in the body.
 *
 * The plugin requires that the Fastify instance has a `db` decoration (Knex) and
 * optionally a `requireAuth` preHandler. Sessions are scoped to the seller
 * identifier derived from the authenticated user. If no user is present, an
 * unauthorized error is returned.
 */
export default fp(async function sessionsPlugin(app: FastifyInstance) {
  const anyApp = app as any;
  if (anyApp._aiSessionsRegistered) return;
  anyApp._aiSessionsRegistered = true;

  const db: any = anyApp.db;
  if (!db) {
    app.log.warn('[ai/sessions] No database available. Sessions endpoints will not work.');
    return;
  }

  // If authentication is configured, reuse it
  const routeOpts: Record<string, unknown> = {};
  if (app.requireAuth) routeOpts.preHandler = app.requireAuth;

  /**
   * GET /sessions
   *
   * Returns a list of chat sessions for the authenticated seller. Sessions are
   * ordered by creation time descending. Each entry includes its id, title,
   * created_at timestamp, and updated_at timestamp. If the optional `status`
   * column exists on the table, it is also included.
   */
  app.get('/sessions', routeOpts, async (req: FastifyRequest, reply: FastifyReply) => {
    const sellerId = (req as any).user?.id as string | undefined;
    if (!sellerId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    try {
      // Determine if a status column exists at runtime. If it does, select it.
      let hasStatus = false;
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
              ['ai_chat_sessions', 'status']
            )
          )
          .first();
        hasStatus = !!(row as any)?.has_col;
      } catch {
        hasStatus = false;
      }
      const cols = ['id', 'title', 'created_at', 'updated_at'];
      if (hasStatus) cols.push('status');
      const rows = await db('ai_chat_sessions')
        .select(...cols)
        .where({ seller_id: sellerId })
        .orderBy('created_at', 'desc');
      return reply.send({ ok: true, sessions: rows });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message || String(err) }, '[ai/sessions] failed to fetch sessions');
      return reply.code(500).send({ ok: false, error: 'failed_to_fetch_sessions' });
    }
  });

  /**
   * POST /sessions
   *
   * Creates a new chat session for the authenticated seller. Accepts an optional
   * `title` string in the request body. Returns the id of the newly created
   * session. The `metadata` field (or `meta_json`, depending on the schema)
   * is initialized to an empty JSON object. The `status` column is omitted
   * unless present on the table, in which case its default (often 'open') is
   * used implicitly.
   */
  app.post('/sessions', routeOpts, async (req: FastifyRequest, reply: FastifyReply) => {
    const sellerId = (req as any).user?.id as string | undefined;
    if (!sellerId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    const body = (req.body as any) || {};
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : null;
    const storeId = typeof body.storeId === 'string' ? body.storeId : null;
    try {
      // Detect meta column name (metadata or meta_json) on the sessions table
      let metaCol: 'metadata' | 'meta_json' = 'metadata';
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
      const payload: any = {
        seller_id: sellerId,
        title,
      };
      if (storeId) payload.store_id = storeId;
      payload[metaCol] = {};
      const [row] = await db('ai_chat_sessions').insert(payload).returning(['id']);
      return reply.send({ ok: true, id: (row as any).id });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message || String(err) }, '[ai/sessions] failed to create session');
      return reply.code(500).send({ ok: false, error: 'failed_to_create_session' });
    }
  });
}, { name: 'ai-sessions' });