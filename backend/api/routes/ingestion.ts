// src/api/routes/ingestion.ts

import type { FastifyInstance } from 'fastify';
import { preflightFromSource } from '../../worker/ingest';
import { suggestMapping } from '../../utils/ingest-map';

export default async function ingestionRoutes(fastify: FastifyInstance) {
  const db = (fastify as any).db;
  
  // Get auth middleware from app
  const requireAuth = (fastify as any).requireAuth ?? ((_req: any, _rep: any, done: any) => done());
  const requireSeller = async (req: any, rep: any) => {
    const sellerId = (req.user as any)?.seller_id || (req.user as any)?.id;
    if (!sellerId) {
      return rep.code(403).send({ error: 'Seller access required' });
    }
  };

  /**
   * GET /api/v1/ingestion/sheets
   * List all sheets for the current seller's stores
   */
  fastify.get(
    '/api/v1/ingestion/sheets',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const sellerId = (request.user as any)?.seller_id;

      const sheets = await db('public.store_sheets as ss')
        .select(
          'ss.id',
          'ss.store_id',
          'ss.gsheet_url',
          'ss.enabled',
          'ss.created_at',
          'ss.updated_at',
          's.name as store_name'
        )
        .join('public.stores as s', 's.id', 'ss.store_id')
        .where('s.seller_id', sellerId)
        .orderBy('ss.updated_at', 'desc');

      return reply.send({ sheets });
    }
  );

  /**
   * GET /api/v1/ingestion/sheets/:id/preflight
   * Preview sheet data and suggested mapping
   */
  fastify.get(
    '/api/v1/ingestion/sheets/:id/preflight',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const sellerId = (request.user as any)?.seller_id;

      // Verify ownership
      const sheet = await db('public.store_sheets as ss')
        .select('ss.*', 's.seller_id')
        .join('public.stores as s', 's.id', 'ss.store_id')
        .where({ 'ss.id': id })
        .first();

      if (!sheet || sheet.seller_id !== sellerId) {
        return reply.code(404).send({ error: 'Sheet not found' });
      }

      try {
        const result = await preflightFromSource(db, sheet.store_id);

        if (!result.ok) {
          return reply.code(400).send({ error: result.reason });
        }

        const { headers, firstRow } = result;

        // Suggest mapping
        const mapping = await suggestMapping(headers, 'orders', {
          sampleRows: firstRow ? [firstRow] : [],
        });

        return reply.send({
          success: true,
          headers,
          sampleRows: [firstRow].filter(Boolean).slice(0, 5),
          suggestedMapping: mapping,
        });
      } catch (error: any) {
        fastify.log.error({ error: error.message, sheetId: id }, 'preflight_failed');
        return reply.code(500).send({ error: 'Failed to preview sheet' });
      }
    }
  );

  /**
   * POST /api/v1/ingestion/sheets/:id/mapping
   * Save custom field mapping for a sheet
   */
  fastify.post(
    '/api/v1/ingestion/sheets/:id/mapping',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { mapping, uniqueKey } = request.body as { mapping: Record<string, string>; uniqueKey?: string };
      const sellerId = (request.user as any)?.seller_id;

      // Verify ownership
      const sheet = await db('public.store_sheets as ss')
        .select('ss.*', 's.seller_id')
        .join('public.stores as s', 's.id', 'ss.store_id')
        .where({ 'ss.id': id })
        .first();

      if (!sheet || sheet.seller_id !== sellerId) {
        return reply.code(404).send({ error: 'Sheet not found' });
      }

      // Create mapping config object
      const mappingConfig = {
        fields: mapping,
        uniqueKey: uniqueKey || 'order_id',
        updated_at: new Date().toISOString(),
      };

      // FIXED: Actually persist the mapping as JSON
      // We use JSONB column if it exists, or create a TEXT column and store JSON string
      try {
        await db('public.store_sheets')
          .where({ id })
          .update({
            field_mapping: db.raw('?::jsonb', [JSON.stringify(mappingConfig)]),
            updated_at: db.fn.now(),
          });
      } catch (err: any) {
        // If field_mapping column doesn't exist, use raw_payload_json as fallback
        if (err?.message?.includes('column "field_mapping"')) {
          await db('public.store_sheets')
            .where({ id })
            .update({
              raw_payload_json: db.raw('?::jsonb', [JSON.stringify({ mapping: mappingConfig })]),
              updated_at: db.fn.now(),
            });
        } else {
          throw err;
        }
      }

      return reply.send({ success: true, mapping: mappingConfig });
    }
  );

  /**
   * PATCH /api/v1/ingestion/sheets/:id
   * Update sheet configuration (enable/disable, URL)
   */
  fastify.patch(
    '/api/v1/ingestion/sheets/:id',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { enabled, gsheet_url } = request.body as { enabled?: boolean; gsheet_url?: string };
      const sellerId = (request.user as any)?.seller_id;

      // Verify ownership
      const sheet = await db('public.store_sheets as ss')
        .select('ss.*', 's.seller_id')
        .join('public.stores as s', 's.id', 'ss.store_id')
        .where({ 'ss.id': id })
        .first();

      if (!sheet || sheet.seller_id !== sellerId) {
        return reply.code(404).send({ error: 'Sheet not found' });
      }

      const updates: any = { updated_at: db.fn.now() };
      if (enabled !== undefined) updates.enabled = enabled;
      if (gsheet_url) updates.gsheet_url = gsheet_url;

      await db('public.store_sheets').where({ id }).update(updates);

      return reply.send({ success: true });
    }
  );

  /**
   * POST /api/v1/ingestion/sheets
   * Create a new sheet configuration
   */
  fastify.post(
    '/api/v1/ingestion/sheets',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const { store_id, gsheet_url } = request.body as { store_id: string; gsheet_url: string };
      const sellerId = (request.user as any)?.seller_id;

      // Verify store ownership
      const store = await db('public.stores')
        .where({ id: store_id, seller_id: sellerId })
        .first();

      if (!store) {
        return reply.code(404).send({ error: 'Store not found' });
      }

      const [sheet] = await db('public.store_sheets')
        .insert({
          id: db.raw('gen_random_uuid()'),
          store_id,
          gsheet_url,
          enabled: false,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('*');

      return reply.send({ success: true, sheet });
    }
  );

  /**
   * DELETE /api/v1/ingestion/sheets/:id
   * Delete a sheet configuration
   */
  fastify.delete(
    '/api/v1/ingestion/sheets/:id',
    { preHandler: [requireAuth, requireSeller] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const sellerId = (request.user as any)?.seller_id;

      // Verify ownership
      const sheet = await db('public.store_sheets as ss')
        .select('ss.*', 's.seller_id')
        .join('public.stores as s', 's.id', 'ss.store_id')
        .where({ 'ss.id': id })
        .first();

      if (!sheet || sheet.seller_id !== sellerId) {
        return reply.code(404).send({ error: 'Sheet not found' });
      }

      await db('public.store_sheets').where({ id }).delete();

      return reply.send({ success: true });
    }
  );
}
