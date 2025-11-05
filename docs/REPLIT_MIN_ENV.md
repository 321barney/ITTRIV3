# Replit Minimal Setup — 2025-09-18

Only **DATABASE_URL** is required. Everything else is optional and defaults are used.

## Run on Replit
1) Set **DATABASE_URL** in the Secrets panel.
2) (Optional) Set **PORT**; Replit usually injects one automatically.
3) Use this run command:
```bash
python backend/replit_main.py
```
This binds to `0.0.0.0:$PORT` and relaxes CORS/TrustedHost for Replit previews.

## Notes
- If `DATABASE_URL` is unset, the app still boots using a local SQLite file (degraded mode).
- WhatsApp/Mailgun/Redis etc. are optional and can be added later.
