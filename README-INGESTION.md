# Google Sheets → AI Confirmation → Order Flagging

This patch adds:
- A **Sheets poller** that reads new rows and enqueues `orders.new`
- An **orders.new worker** that upserts orders into Postgres, triggers an AI confirmation prompt, and queues the outbound message
- Idempotent **ingestion audit** via `ingestion_audit`
- Helpers for conversations and order status updates

## Environment

Required env vars:

```
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://user:pass@host:5432/db
POLL_INTERVAL_MS=60000

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SHEETS_RANGE='Orders!A:Z'
# Provide creds either way:
GOOGLE_SHEETS_CREDS_JSON='{"type":"service_account",...}'  # or use GOOGLE_APPLICATION_CREDENTIALS
```

Optional:
```
SHEETS_POLL_BATCH=50
```

## Column mapping

Expected header names (case-insensitive). Use any of the aliases in your sheet:

- `store_id` | `store` | `seller_store_id`
- `external_order_id` | `order_id` | `id`
- `customer_name` | `name`
- `customer_email` | `email`
- `customer_phone` | `phone`
- `customer_address` | `address`
- `sku` | `product_sku`
- `product_id`
- `quantity`
- `price`

## How it flows

1. `workerManager` starts the **Sheets poller** and a **BullMQ worker** for `orders.new`.
2. `orderIngestor.pollGoogleSheetsAndEnqueue()` fetches rows after the saved cursor and enqueues one job per order.
3. `orderNewWorker.processOrderNew()`:
   - `upsertOrderWithItems()` puts data into `customers`, `orders`, `order_items`, and writes `ingestion_audit`.
   - Opens/ensures a `conversation`, writes a prompt message, optionally lets the AI refine it, and queues `comms.outbound`.
   - Sets `orders.status = pending_confirmation`.
4. On inbound replies (not included here), classify YES/NO and call `markOrderStatus(orderId, 'confirmed' | 'rejected' | 'needs_review')`.

## Notes

- This assumes the following tables exist: `customers`, `orders`, `order_items`, `ingestion_audit`, `conversations`, `messages`, `products`, and optionally `app_kv`.
- If `app_kv` doesn't exist, swap the cursor storage to any config/settings table you have.
- You may need to adapt imports (`getDb`, `logger`, `aiClient`, `aiContext`, `queues`) to your exact paths.
- Install deps and run:
  ```bash
  npm i
  npm run dev
  ```
