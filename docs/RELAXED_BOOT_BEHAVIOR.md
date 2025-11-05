# Relaxed Boot Behavior — 2025-09-18

- The app **always boots** even if Database/Redis/Providers are missing.
- `/ready` always returns 200 with `mode: "ok" | "degraded"` and dependency flags.
- `/system` splits **operational** (code paths loaded) vs **configured** (secrets/URLs present).
- Webhook signature checks remain strict at request time (security), but they do not block startup.
