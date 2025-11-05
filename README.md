# Adapted start scripts for your layout
- Defaults to `backend/` and `ittri-frontend/` as seen in your tree.
- Reads `.env`, `.env.development`, then `.env.local` (last wins).
- Starts Redis via Docker Compose if available, else `redis-server` with data in `.redisdata/`.
- Database: waits on `DATABASE_URL`. If remote (e.g., Neon), it just waits for readiness and does not start any local DB.
- Runs `knex migrate:latest` in `backend/`.
- Launches backend & frontend (uses `concurrently` if installed, otherwise tmux/background; PowerShell uses separate processes).

## Usage
macOS/Linux:
```
chmod +x dev-up.sh
./dev-up.sh
```
Windows:
```
PowerShell -ExecutionPolicy Bypass -File .\dev-up.ps1
```

## Environment
Ensure `.env` (or `.env.local`) defines at least:
```
DATABASE_URL=postgres://USER:PASS@HOST:5432/DBNAME    # Neon or local
REDIS_PORT=6379
BACKEND_DIR=backend
FRONTEND_DIR=ittri-frontend
```
