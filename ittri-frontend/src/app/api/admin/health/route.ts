// --- ADMIN HEALTH ---
app.get('/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const baseDb: any = (app as any).db;

    const payload = await withAdmin(baseDb, async (db) => {
      // quick DB ping + version (best-effort)
      const [{ now }] = (await db.raw(`SELECT NOW() AS now`)).rows;
      let version: any = null;
      try {
        const kv = await db('app_kv').select('value').where({ key: 'app_version' }).first();
        version = kv?.value ?? null;
      } catch { /* ignore */ }

      return {
        ok: true,
        service: 'admin',
        db_time: now,
        version,
      };
    });

    return reply.send(payload);
  } catch (error) {
    request.log.error({ error }, 'admin_health_failed');
    return reply.code(500).send({ ok: false, error: 'admin_health_failed' });
  }
});
