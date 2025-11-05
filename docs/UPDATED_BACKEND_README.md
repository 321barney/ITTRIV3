# Project Updated — Multi-Queue Workers + Channels
Date: 2025-09-18

## What changed
- WhatsApp + Mailgun routes with signature verification
- Celery multi-queue workers (whatsapp/email/payments/sheets/ai)
- BaseTask for retries/backoff/idempotency hook
- Health endpoints `/health` and `/ready`
- Env templates and requirements updated

## Quick start
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r app/requirements.txt

# Run API
uvicorn main:app --host 0.0.0.0 --port 8000

# Start workers (examples)
celery -A app.worker.celery_app.celery worker -l info -n wa@%h -Q whatsapp_q -c 16 --prefetch-multiplier 8
celery -A app.worker.celery_app.celery worker -l info -n mail@%h -Q email_q -c 8 --prefetch-multiplier 4
celery -A app.worker.celery_app.celery worker -l info -n pay@%h -Q payments_q -c 4 --prefetch-multiplier 1
celery -A app.worker.celery_app.celery worker -l info -n sheets@%h -Q sheets_q -c 4
celery -A app.worker.celery_app.celery worker -l info -n ai@%h -Q ai_q -c 4
```

If the routers aren't active, open your main app file and ensure:
```python
from app.api.routes.health_routes import router as health_router
from app.api.routes.whatsapp_routes import router as whatsapp_router
from app.api.routes.email_mailgun_routes import router as mailgun_router

app.include_router(health_router, tags=["Health"])
app.include_router(whatsapp_router)
app.include_router(mailgun_router)
```
