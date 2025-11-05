// src/api/routes/editor.files.ts
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveDb } from '../_shared/rls';

const IdParam = z.object({ id: z.string().uuid() });

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
  }
}

export default fp(async function registerEditorFiles(app: FastifyInstance) {
  const db = resolveDb(app);

  // Build route options with auth
  const routeOpts: any = {};
  if (app.requireAuth) {
    routeOpts.preHandler = app.requireAuth;
  }

  // List files for current seller
  app.get('/api/v1/editor/files', routeOpts, async (req) => {
    const sellerId = (req as any).user?.id;
    const rows = await db('editor_files').select('*').where({ seller_id: sellerId }).orderBy('updated_at','desc');
    return { ok: true, files: rows };
  });

  // Create file (and initial version)
  app.post('/api/v1/editor/files', routeOpts, async (req, reply) => {
    const body = (req as any).body || {};
    const sellerId = (req as any).user?.id;
    const storeId  = (req as any).user?.storeId || null;
    const Parsed = z.object({
      name: z.string().min(1),
      path: z.string().optional(),
      kind: z.enum(['code','document','asset','prompt']).default('code'),
      content: z.string().min(1),
      metadata: z.record(z.any()).optional(),
    }).safeParse(body);
    if (!Parsed.success) return reply.code(400).send({ ok: false, error: 'bad_request', details: Parsed.error.flatten() });
    const { name, path, kind, content, metadata } = Parsed.data;
    const [file] = await db('editor_files')
      .insert({ seller_id: sellerId, store_id: storeId, name, path, kind, metadata: metadata || {} })
      .returning('*');
    await db('editor_file_versions').insert({ file_id: file.id, content, metadata: { route: 'create' } });
    const latest = await db('editor_files').where({ id: file.id }).first();
    return { ok: true, file: latest };
  });

  // Get file + latest version content
  app.get('/api/v1/editor/files/:id', routeOpts, async (req, reply) => {
    const params = IdParam.safeParse((req as any).params);
    if (!params.success) return reply.code(400).send({ ok: false, error: 'bad_request' });
    const sellerId = (req as any).user?.id;
    const file = await db('editor_files').where({ id: params.data.id, seller_id: sellerId }).first();
    if (!file) return reply.code(404).send({ ok: false, error: 'not_found' });
    const v = await db('editor_file_versions').where({ file_id: file.id }).orderBy('version','desc').first();
    return { ok: true, file, version: v };
  });

  // Update (optionally create new version)
  app.put('/api/v1/editor/files/:id', routeOpts, async (req, reply) => {
    const params = IdParam.safeParse((req as any).params);
    if (!params.success) return reply.code(400).send({ ok: false, error: 'bad_request' });
    const sellerId = (req as any).user?.id;
    const body = (req as any).body || {};
    const Parsed = z.object({
      name: z.string().min(1).optional(),
      path: z.string().optional(),
      kind: z.enum(['code','document','asset','prompt']).optional(),
      metadata: z.record(z.any()).optional(),
      content: z.string().optional(), // if provided → new version
    }).safeParse(body);
    if (!Parsed.success) return reply.code(400).send({ ok: false, error: 'bad_request', details: Parsed.error.flatten() });

    const exists = await db('editor_files').where({ id: params.data.id, seller_id: sellerId }).first();
    if (!exists) return reply.code(404).send({ ok: false, error: 'not_found' });

    const patch: any = {};
    for (const k of ['name','path','kind','metadata'] as const) {
      if (Parsed.data[k] !== undefined) patch[k] = (Parsed.data as any)[k];
    }
    if (Object.keys(patch).length) {
      patch.updated_at = db.fn.now();
      await db('editor_files').where({ id: params.data.id }).update(patch);
    }
    if (Parsed.data.content !== undefined) {
      await db('editor_file_versions').insert({ file_id: params.data.id, content: Parsed.data.content, metadata: { route: 'update' } });
    }
    const file = await db('editor_files').where({ id: params.data.id }).first();
    const v = await db('editor_file_versions').where({ file_id: params.data.id }).orderBy('version','desc').first();
    return { ok: true, file, version: v };
  });

  // List versions
  app.get('/api/v1/editor/files/:id/versions', routeOpts, async (req, reply) => {
    const params = IdParam.safeParse((req as any).params);
    if (!params.success) return reply.code(400).send({ ok: false, error: 'bad_request' });
    const sellerId = (req as any).user?.id;
    const file = await db('editor_files').where({ id: params.data.id, seller_id: sellerId }).first();
    if (!file) return reply.code(404).send({ ok: false, error: 'not_found' });
    const rows = await db('editor_file_versions').where({ file_id: params.data.id }).orderBy('version','desc');
    return { ok: true, versions: rows };
  });
}, { name: 'editor-files' });
