
// backend/src/plugins/apiKey.ts
import fp from 'fastify-plugin';
import bcrypt from 'bcryptjs';
import { knex } from '../db/index.js';

export default fp(async function apiKeyPlugin(app) {
  app.decorate('requireApiKey', async (req, reply) => {
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') return reply.code(401).send({ ok: false, error: 'missing_api_key' });
    const rows = await knex('api_keys').where({ active: true });
    for (const row of rows) {
      const ok = await bcrypt.compare(key, row.key_hash);
      if (ok) {
        req.apiKey = { user_id: row.user_id, store_id: row.store_id };
        return;
      }
    }
    return reply.code(401).send({ ok: false, error: 'invalid_api_key' });
  });
});
