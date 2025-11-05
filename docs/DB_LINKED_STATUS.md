# DB-linked status — 2025-09-18

- `/system` now ties critical flags to **real DB readiness**:
  - `database`, `seller_isolation`, `ai_enhanced`, `training_system` ⇒ **true only when** the DB is reachable and the core tables (`sellers`, `stores`) exist.
- Boot is still relaxed for dev; status becomes `"degraded"` until DB is ready.
