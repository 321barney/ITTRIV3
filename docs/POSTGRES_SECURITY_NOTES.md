# PostgreSQL + Security Hardening — 2025-09-18

## What changed
- **PostgreSQL required** in production. Set `DATABASE_URL=postgresql+psycopg2://...`.
- **SSL**: if `REQUIRE_DB_SSL=true`, we append `sslmode=require` to the connection when missing.
- **Connection pool**: `pool_pre_ping=True`, `pool_size=10`, `max_overflow=20`.
- **No raw string SQL**: introduced `safe_text()` helper. Always parameterize.
- **CORS**: controlled by `CORS_ALLOWED_ORIGINS` (comma-separated). Defaults to none (closed).
- **Trusted hosts**: `TRUSTED_HOSTS` enforced via Starlette's `TrustedHostMiddleware`.
- **Security headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP for APIs.
- **Body size limit**: default 1MB (tune via `MAX_REQUEST_SIZE`).

## Quick start
```bash
export DATABASE_URL="postgresql+psycopg2://USER:PASSWORD@HOST:5432/DB_NAME"
export REQUIRE_DB_SSL=true
export CORS_ALLOWED_ORIGINS="https://your-frontend.com,https://admin.your-frontend.com"
export TRUSTED_HOSTS="your-api.yourdomain.com,localhost,127.0.0.1"
uvicorn backend/main:app --host 0.0.0.0 --port 8000
```

## Anti-injection notes
- All ORM queries are parameterized by default.
- If you *must* use raw SQL, use:
  ```python
  from utils.shared_database_module import safe_text
  db.execute(safe_text("SELECT * FROM products WHERE sku=:sku AND store_id=:sid"),
             {"sku": sku, "sid": store_id})
  ```

## CORS examples
- Dev (allow localhost):
  ```bash
  export CORS_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
  ```
- Prod:
  ```bash
  export CORS_ALLOWED_ORIGINS="https://your-frontend.com,https://admin.your-frontend.com"
  export TRUSTED_HOSTS="your-api.yourdomain.com"
  ```
