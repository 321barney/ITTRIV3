# Alembic Setup (Bootstrap) — 2025-09-18

This patch adds minimal Alembic wiring so you can run migrations:

- `backend/alembic.ini`
- `backend/alembic/env.py` (reads `DATABASE_URL` from env; attempts to import `Base` if available)
- `backend/alembic/versions/` (use the migration files shipped in your project)

## How to use

1) Put this `alembic.ini` at your repo root *or* keep it under `backend/` and call alembic with `-c backend/alembic.ini`.

**Recommended for this repo:**
```bash
# from repo root
export DATABASE_URL="postgresql+psycopg2://USER:PASSWORD@HOST:5432/DB_NAME"
alembic -c backend/alembic.ini upgrade head
```

2) If you prefer running from `backend/`:
```bash
cd backend
export DATABASE_URL="postgresql+psycopg2://USER:PASSWORD@HOST:5432/DB_NAME"
alembic -c alembic.ini upgrade head
```

3) The env reads `DATABASE_URL`. If missing, it will use the `sqlalchemy.url` from alembic.ini.

> Note: Autogenerate is optional. You already have migrations created (e.g., unique email, per-store channels).

