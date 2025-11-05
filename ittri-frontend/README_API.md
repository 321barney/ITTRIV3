# API Base Configuration

All frontend auth calls now use a single API base defined in `src/lib/endpoints.ts`.

Order of precedence:
1. `process.env.NEXT_PUBLIC_API_URL` (e.g., `https://api.myapp.com`)
2. default fallback: `http://localhost:8000`

Endpoints:
- `ep.auth.login()` -> `${API_BASE}/auth/login`
- `ep.auth.register()` -> `${API_BASE}/auth/register`
- ...

To fix mixed URLs (like `/api/auth/login` vs `http://localhost:8000/auth/register`), set **one** env:

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Or point to your remote backend:
```bash
NEXT_PUBLIC_API_URL=https://your-backend.example.com
```

No `/api/*` Next.js catch-all is required for these auth calls anymore.