// src/api/routes/ai/index.ts
// Aggregates AI sub-plugins and keeps a temporary legacy mount if present.

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

// Lazy-import helpers so build tools/tree-shaking stay happy
async function load<T = any>(specifier: string): Promise<T | null> {
  try {
    const mod: any = await import(specifier);
    return (mod?.default ?? mod) as T;
  } catch {
    return null;
  }
}

export default fp(async function aiRoutes(app: FastifyInstance, opts: any) {
  // Required sub-plugins
  const code   = await load('./codegen');
  const content= await load('./content');
  const seo    = await load('./seo');

  if (!code)   app.log.warn('AI codegen plugin missing (./codegen)');
  if (!content)app.log.warn('AI content plugin missing (./content)');
  if (!seo)    app.log.warn('AI SEO plugin missing (./seo)');

  if (code)    await app.register(code as any,    { prefix: '/code',    ...opts });
  if (content) await app.register(content as any, { prefix: '/content', ...opts });
  if (seo)     await app.register(seo as any,     { prefix: '/seo',     ...opts });

  // Optional: mount previous monolithic AI plugin (if exists) under /legacy
  // This helps you transition clients off old endpoints safely.
  const legacy = await load('../ai');        // try compiled sibling
  const legacyAlt = legacy ? null : await load('../../ai'); // try src sibling

  if (legacy || legacyAlt) {
    await app.register((legacy || legacyAlt) as any, { prefix: '/legacy', ...opts });
    app.log.warn('AI legacy routes mounted at /api/ai/legacy/* (temporary)');
  }
});
