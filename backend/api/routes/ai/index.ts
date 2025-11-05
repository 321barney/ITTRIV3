// src/api/routes/ai/index.ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

type Plugin = (app: FastifyInstance, opts?: any) => Promise<void> | void;

async function tryImport(rel: string) {
  try {
    const url = new URL(rel, import.meta.url).href;
    const mod: any = await import(url);
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}
async function firstAvailable<T = any>(cands: string[]): Promise<T | null> {
  for (const c of cands) {
    const mod = await tryImport(c);
    if (mod) return mod as T;
  }
  return null;
}

const AI_HUB_GUARD = Symbol.for('ittri.ai.hub.installed');

async function aiHub(app: FastifyInstance) {
  const g = globalThis as any;
  if (g[AI_HUB_GUARD]) {
    app.log.warn('[ai/hub] already registered — skipping');
    return;
  }
  g[AI_HUB_GUARD] = true;

  const code    = await firstAvailable<Plugin>(['./codegen.ts', './codegen.js', './codegen']);
  const content = await firstAvailable<Plugin>(['./content.ts', './content.js', './content']);
  const seo     = await firstAvailable<Plugin>(['./seo.ts', './seo.js', './seo']);

  const mounts = { code: !!code, content: !!content, seo: !!seo };

  if (code) {
    // Register the codegen plugin under /code prefix
    await app.register(code as any, { prefix: '/code' });
    /*
     * Also register it at the root of this hub so that /gen becomes an alias for
     * /code/gen. Some clients mistakenly call /api/v1/ai/gen; registering
     * codegen without a prefix will expose the same /gen route. Duplicate
     * registrations are safe because Fastify treats them as separate contexts.
     */
    await app.register(code as any, { prefix: '' });
  } else {
    app.log.warn('[ai/hub] codegen missing — installing fallback /code/gen (501)');
    app.post('/code/gen', async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/codegen' }));
    // Fallback for /gen as well
    app.post('/gen', async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/codegen' }));
  }

  if (content) {
    await app.register(content as any, { prefix: '/content' });
  } else {
    app.log.warn('[ai/hub] content missing — installing fallbacks /content/{brief,meta} (501)');
    app.post('/content/brief', async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/content' }));
    app.post('/content/meta',  async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/content' }));
  }

  if (seo) {
    await app.register(seo as any, { prefix: '/seo' });
  } else {
    app.log.warn('[ai/hub] seo missing — installing fallbacks /seo/{enhance,hints} (501)');
    app.post('/seo/enhance', async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/seo' }));
    app.post('/seo/hints',   async () => ({ ok: false, error: 'not_implemented', hint: 'Install routes/ai/seo' }));
  }

  // --- Register messages plugin if available ---
  try {
    const messages = await firstAvailable<Plugin>(['./messages.ts', './messages.js', './messages']);
    if (messages) {
      // Expose chat history at /messages/:sessionId (within the hub)
      await app.register(messages as any, { prefix: '/messages' });
    } else {
      app.log.warn('[ai/hub] messages plugin missing — /messages/:sessionId will not be available');
    }
  } catch (err) {
    app.log.error(err as any, '[ai/hub] Failed to register messages plugin');
  }

  // --- Register sessions plugin if available ---
  try {
    const sessions = await firstAvailable<Plugin>(['./sessions.ts', './sessions.js', './sessions']);
    if (sessions) {
      await app.register(sessions as any, { prefix: '/sessions' });
    } else {
      app.log.warn('[ai/hub] sessions plugin missing — /sessions will not be available');
    }
  } catch (err) {
    app.log.error(err as any, '[ai/hub] Failed to register sessions plugin');
  }

  // --- Register generate plugin if available ---\n  try {\n    const gen = await firstAvailable<Plugin>(['./generate.ts','./generate.js','./generate']);\n    if (gen) {\n      await app.register(gen as any, { prefix: '' });\n    } else {\n      app.log.warn('[ai/hub] generate plugin missing — /ai/generate will not be available');\n    }\n  } catch (err) {\n    app.log.error(err as any, '[ai/hub] Failed to register generate plugin');\n  }\n\n  // --- Register chat plugin if available ---
  try {
    const chat = await firstAvailable<Plugin>(['./chat.ts', './chat.js', './chat']);
    if (chat) {
      await app.register(chat as any, { prefix: '/chat' });
    } else {
      app.log.warn('[ai/hub] chat plugin missing — /chat/send will not be available');
    }
  } catch (err) {
    app.log.error(err as any, '[ai/hub] Failed to register chat plugin');
  }

  app.get('/__health', async () => ({
    ok: true,
    mounts,
    hint: 'Subpaths: <hub>/code/gen, <hub>/content/{brief,meta}, <hub>/seo/{enhance,hints}',
  }));
}

export default fp(aiHub, { name: 'ittri-ai-hub' });
