# Backend — Ready to Run on Replit

## What’s inside
- Node backend (ESM-only) with Fastify API, BullMQ queues, ioredis, workers, and a clean orchestrator.
- Python `ml_service` (FastAPI) auto-started by `start.sh` on port 8000.
- `start.sh` is idempotent and robust; it installs deps, starts Redis (or uses `REDIS_URL`), launches `uvicorn`, runs knex (optional), and boots workers+API via tsx.

## Run
1. Create a **Nix** Repl.
2. Upload and extract this zip at the project root.
3. Set Secrets:
   - `REDIS_URL` → your Upstash URL (or leave unset to use local Redis).
   - `DATABASE_URL` → (optional) your Neon/Supabase Postgres.
   - *(Optional)* `KNEX_MIGRATE=0` to skip DB migrations.
4. Click **Run** or in shell: `./start.sh`
5. Open the web preview → `GET /health` should return `{ "ok": true }`.

## Notes
- If Neon DNS complains (e.g., `ENOTFOUND base`), either set `KNEX_MIGRATE=0` or check for stray env like `PGHOST`/proxy variables.
- This project is pure ESM (`"type": "module"`), with `tsconfig` set to `moduleResolution: NodeNext`.
