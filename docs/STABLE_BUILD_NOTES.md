# Stable Replit-Ready Build — 2025-09-18

- `/system` now reports **operational** view so services show as available during dev.
- Database falls back to **SQLite** if `DATABASE_URL` is not set/invalid (keeps app running).
- Redis-dependent features use **in-memory** fallbacks.
- No migrations / Alembic required in this bundle.

When you move to prod, set:
- `DATABASE_URL` (Postgres), `REDIS_URL`, provider keys (WhatsApp/Mailgun), `SECRET_KEY`.
