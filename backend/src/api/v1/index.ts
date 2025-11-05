// src/api/v1/index.ts
import type { FastifyInstance } from 'fastify';

import { installErrorHandler } from '../_shared/errors';
import { rlsOnRequest } from '../_shared/rls';
import { ensureSellerIdHook } from '../_shared/ensureSellerId';
import { requireAdmin } from '../_shared/guards';

// Public
import registerRoot from '../routes/root';
import registerAuthLogin from '../routes/auth.login';
import registerAuthRegister from '../routes/auth.register';
import registerAuthRefresh from '../routes/auth.refresh';
import registerSellerPublic from '../routes/seller.public';
import registerSnapshotPublic from '../routes/snapshot.public';

// Seller (protected) — these modules declare absolute /api/v1/* paths internally,
// so we DO NOT add an extra prefix to avoid /api/v1/api/v1 duplication.
import registerSeller from '../routes/seller';
import registerProduct from '../routes/product';
import registerOrder from '../routes/order';
import registerConversation from '../routes/conversation';
import registerMetric from '../routes/metric'; // will be namespaced at mount time

// Admin (protected + admin-only)
import registerAdmin from '../routes/admin';
import registerSubscriptionAdmin from '../routes/subscription.admin';

// AI
import registerAiHub from '../routes/ai/index';
import registerGenerate from '../routes/ai/generate'; // adds /api/v1/ai/generate alias

// Extras (protected)
import registerEditorFiles from '../routes/editor.files';
// ⬇️ New: generic variable-schema ingest worker (replaces gsheet)
import registerWorkerIngest from '../routes/worker.ingest';
import { INGEST_ENABLED } from '../../utils/flags';

export default async function v1(app: FastifyInstance) {
  installErrorHandler(app);

  const manifest: Array<{ method: string; path: string; protected: boolean }> = [];
  const track = (instance: FastifyInstance, secured: boolean) => {
    instance.addHook('onRoute', (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) manifest.push({ method: m, path: r.url, protected: secured });
    });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // PUBLIC
  await app.register(async (pub) => {
    track(pub, false);

    await pub.register(registerRoot,         { prefix: '/api/v1' });
    await pub.register(registerAuthLogin,    { prefix: '/api/v1/auth' });
    await pub.register(registerAuthRegister, { prefix: '/api/v1/auth' });
    await pub.register(registerAuthRefresh,  { prefix: '/api/v1/auth' });

    await pub.register(registerSellerPublic);                 // defines its own paths
    await pub.register(registerSnapshotPublic, { prefix: '/api/v1' });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SELLER (protected)
  await app.register(async (sec) => {
    sec.addHook('onRequest', app.requireAuth!);
    sec.addHook('onRequest', ensureSellerIdHook(app));
    sec.addHook('onRequest', rlsOnRequest(sec));
    track(sec, true);

    // These modules already expose /api/v1/* internally — mount as-is:
    await sec.register(registerSeller);
    await sec.register(registerProduct);
    await sec.register(registerOrder);
    await sec.register(registerConversation);

    // ✅ Namespace metrics to avoid clashing and keep URLs tidy
    // Any internal paths will live under /api/v1/metric/*
    await sec.register(registerMetric, { prefix: '/api/v1/metric' });

    // Editor files
    await sec.register(registerEditorFiles);

    // Ingestion management routes
    await sec.register((await import('../routes/ingestion')).default);

    // 🔄 Variable-schema ingest worker (enabled via INGEST_ENABLED)
    if (INGEST_ENABLED) {
      await sec.register(registerWorkerIngest);
    } else {
      // Optional stubs so clients get a clear signal when disabled
      sec.get('/api/v1/worker/ingest/health', async () => ({ ok: false, error: 'ingest_disabled' }));
      sec.get('/api/v1/worker/ingest/warm',   async () => ({ ok: false, error: 'ingest_disabled' }));
      sec.post('/api/v1/worker/ingest/kick',  async () => ({ ok: false, error: 'ingest_disabled' }));
      sec.post('/api/v1/worker/ingest/upload',async () => ({ ok: false, error: 'ingest_disabled' }));
    }

    // AI hub under /api/v1/ai — do NOT track inside this nested scope to avoid duplicates
    await sec.register(
      async (aiScope) => {
        await aiScope.register(registerAiHub);     // chat, gen (/gen), sessions, messages
        await aiScope.register(registerGenerate);  // explicit /api/v1/ai/generate
      },
      { prefix: '/api/v1/ai' }
    );

    // Convenience
    sec.get('/api/v1/whoami', async (req) => {
      const u: any = (req as any).user || {};
      return { ok: true, user: { id: u.id, sellerId: u.id, email: u.email, role: u.role, method: u.method } };
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ADMIN (protected + admin-only)
  await app.register(async (adm) => {
    adm.addHook('onRequest', app.requireAuth!);
    adm.addHook('onRequest', requireAdmin(app));
    adm.addHook('onRequest', rlsOnRequest(adm));
    track(adm, true);

    await adm.register(registerAdmin,             { prefix: '/api/v1' });
    await adm.register(registerSubscriptionAdmin, { prefix: '/api/v1' });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Manifest (dedupe by method+path to avoid double entries from nested trackers)
  app.get('/api/v1/__routes', async () => {
    const uniq = new Map<string, { method: string; path: string; protected: boolean }>();
    for (const r of manifest) uniq.set(`${r.method} ${r.path}`, r);
    const rows = Array.from(uniq.values());
    rows.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
    return { ok: true, data: rows };
  });
}
