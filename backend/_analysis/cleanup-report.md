# Cleanup & Verification Report (dry run)

**Scope analyzed**: `/mnt/data/latest_src` (looks like a `src/`-only bundle; no `package.json`/`tsconfig.json` were found here)

## Summary
- Total code files scanned: **0** at top level; recursively: **84** items
- Imports (external) referenced: **72** across **24** packages
- Files with unresolved relative imports: **26**
- Entry points detected: **0** (this bundle likely excludes repo root with `package.json`)

## Top unresolved relative imports
- `/mnt/data/latest_src/src/ai/index.js` → 13 unresolved: `../ai/index.js`, `./ollama.js`, `./ittriClient.js`, `./prompt.js`, `./tools.js`, `./extract.js`
- `/mnt/data/latest_src/src/convo/convoWorker.ts` → 7 unresolved: `../queues/index.js`, `../db/index.js`, `./storeApiSelector.js`, `./waClient.js`, `./dbConvo.js`, `./prompt.js`, `../ai/ollamaClient.js`
- `/mnt/data/latest_src/src/convo/sheetsIngestor.ts` → 6 unresolved: `../queues/index.js`, `../db/index.js`, `../utils/sheets.js`, `../ai/embeddings.js`, `../vector/pgvector.js`, `./normalize.js`
- `/mnt/data/latest_src/src/api/routes/ittri-router.ts` → 4 unresolved: `../../../shared/src/env.js`, `../../../shared/src/http.js`, `./ittriClient.js`, `./lang.js`
- `/mnt/data/latest_src/src/config.ts` → 3 unresolved: `./config.js`, `../utils/schemaSync.js`, `../utils/migrate.js`
- `/mnt/data/latest_src/src/main.ts` → 3 unresolved: `./api/server.js`, `./db/index.js`, `./ai/ollama.js`
- `/mnt/data/latest_src/src/api/aiAgentWorker.ts` → 3 unresolved: `../queues/index.js`, `../db/index.js`, `../ai/index.js`
- `/mnt/data/latest_src/src/api/server.ts` → 3 unresolved: `../db/index.js`, `./routes/ai.js`, `../plugins/apiKey.js`
- `/mnt/data/latest_src/src/convo/semanticLookup.ts` → 3 unresolved: `../ai/embeddings.js`, `../vector/pgvector.js`, `../db/index.js`
- `/mnt/data/latest_src/src/db/index.ts` → 3 unresolved: `./config.js`, `../utils/schemaSync.js`, `../utils/migrate.js`
- `/mnt/data/latest_src/src/api/scheduler.ts` → 2 unresolved: `../db/index.js`, `../queues/index.js`
- `/mnt/data/latest_src/src/api/routes/admin.ts` → 2 unresolved: `../../utils/pii.js`, `../../utils/conversations.js`
- `/mnt/data/latest_src/src/api/routes/ai.ts` → 2 unresolved: `../../ai/ollama.js`, `../../ai/embeddings.js`
- `/mnt/data/latest_src/src/ai/extract.ts` → 1 unresolved: `./ittriClient.js`
- `/mnt/data/latest_src/src/ai/ittriClient.ts` → 1 unresolved: `./ollama.js`
- `/mnt/data/latest_src/src/api/routes/auth.login.ts` → 1 unresolved: `../../db/index.js`
- `/mnt/data/latest_src/src/api/routes/auth.register.ts` → 1 unresolved: `../../db/index.js`
- `/mnt/data/latest_src/src/api/routes/order.ts` → 1 unresolved: `../../utils/conversations.js`
- `/mnt/data/latest_src/src/convo/normalize.ts` → 1 unresolved: `../ai/ollamaClient.js`
- `/mnt/data/latest_src/src/db/scripts/migrate.ts` → 1 unresolved: `../config.js`
- `/mnt/data/latest_src/src/db/scripts/test-connection.ts` → 1 unresolved: `../index.js`
- `/mnt/data/latest_src/src/db/scripts/verify-setup.ts` → 1 unresolved: `../index.js`
- `/mnt/data/latest_src/src/utils/bus.ts` → 1 unresolved: `../lib/bus`
- `/mnt/data/latest_src/src/utils/conversations.ts` → 1 unresolved: `./pii.js`
- `/mnt/data/latest_src/src/vector/index.ts` → 1 unresolved: `../db/index.js`
- `/mnt/data/latest_src/src/worker/dbWorker.ts` → 1 unresolved: `../services/whatsapp`

> Most unresolved paths are due to this being a `src/`-only zip: relative imports that jump outside this folder or rely on path aliases cannot be resolved without `tsconfig.json` and the actual repo root.

## External packages referenced (top 20)
- `knex` × 12
- `fastify` × 12
- `node-fetch` × 5
- `bullmq` × 4
- `node:fs` × 4
- `jsonwebtoken` × 4
- `node:crypto` × 4
- `node:path` × 3
- `fastify-plugin` × 3
- `bcryptjs` × 3
- `zod` × 2
- `pino` × 2
- `stripe` × 2
- `pg` × 2
- `node:child_process` × 1
- `@fastify/cors` × 1
- `@fastify/helmet` × 1
- `@fastify/cookie` × 1
- `express` × 1
- `crypto` × 1

## Recommendations
1. **Re-run analysis on full repo root** (include `package.json`, `tsconfig.json`, `scripts/`, etc.).
2. Adopt the suggested **strict `tsconfig`** and **ESLint** config (files in `_analysis/`). Enforce in CI with `tsc --noEmit` and `eslint .`.
3. Use the **dependency suggestion** file to fill in `package.json` if missing.
4. After restoring root, execute a full graph check:
   - Build with `tsc --noEmit`
   - Lint with `eslint`
   - Run custom dead-file detector (see script stub below).

## CI script stubs
- Add to `package.json`:
```json
{{
  "scripts": {{
    "check:types": "tsc --noEmit",
    "check:lint": "eslint . --ext .ts,.tsx",
    "check:all": "npm run check:types && npm run check:lint"
  }}
}}
```
