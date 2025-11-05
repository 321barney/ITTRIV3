#!/usr/bin/env bash
set -euo pipefail

# ── 0) Vars (edit these as needed) ─────────────────────────────────────────────
BASE3001='https://09c83f29-0f55-4757-8016-aa5d4ffbbaf5-00-1fq75tid6n0c9.spock.replit.dev:3001'
BASE8000='https://09c83f29-0f55-4757-8016-aa5d4ffbbaf5-00-1fq75tid6n0c9.spock.replit.dev:8000'
EMAIL='youssef.ghazii@gmail.com'
PASS='321@_Abc'
SELLER_ID='25ced646-d73c-4489-9403-3181d0c39e07'

# ── helpers ───────────────────────────────────────────────────────────────────
die() { echo "ERROR: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

extract_token() {
  local file="$1"
  python3 - "$file" <<'PY' || true
import json, sys, os
p=sys.argv[1]
if not os.path.exists(p) or os.path.getsize(p)==0:
  print("")  # empty -> caller will handle
  sys.exit(0)
try:
  with open(p,"r") as f:
    d=json.load(f)
  print(d.get("access_token",""))
except Exception:
  print("")  # keep it empty if invalid json
PY
}

check_routes() {
  echo "→ Checking backend routes at $BASE8000/api/v1/__routes"
  local routes
  routes="$(curl -fsS "$BASE8000/api/v1/__routes" || true)"
  [[ -n "$routes" ]] || die "Backend not responding at /api/v1/__routes"

  # Basic presence checks without jq
  echo "$routes" | grep -q '"/metric/overview"' || echo "  • WARN: /metric/overview missing"
  echo "$routes" | grep -q '"/api/v1/seller/dashboard"' || echo "  • WARN: /api/v1/seller/dashboard missing"
  echo "$routes" | grep -q '"/api/v1/whoami"' || echo "  • WARN: /api/v1/whoami (probe) missing"

  echo "✓ Routes fetched"
}

login_if_needed() {
  # Only (re)login if login.json missing or empty, or TOKEN is empty
  local need_login=0
  [[ -s login.json ]] || need_login=1

  if [[ ${need_login} -eq 1 ]]; then
    echo "→ Logging in via proxy $BASE3001/api/auth/login"
    curl -fsS -c cookies.txt \
      -H 'content-type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"login_type\":\"seller\"}" \
      "$BASE3001/api/auth/login" > login.json || die "Login failed"
    echo "✓ login.json written"
  else
    echo "• Reusing existing login.json"
  fi

  TOKEN="$(extract_token login.json)"
  if [[ -z "${TOKEN}" ]]; then
    echo "login.json content:"
    sed -n '1,80p' login.json || true
    die "Could not extract access_token from login.json"
  fi
  export TOKEN
  echo "✓ TOKEN acquired (len=${#TOKEN})"
}

probe_auth() {
  echo "→ Probing whoami"
  local resp
  resp="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE8000/api/v1/whoami" || true)"
  if [[ -z "$resp" ]]; then
    echo "whoami failed (no response)."
  else
    echo "$resp"
  fi
}

hit_metrics() {
  echo "→ GET $BASE8000/metric/overview?period=7d"
  curl -i -sS -H "Authorization: Bearer $TOKEN" "$BASE8000/metric/overview?period=7d" || true
  echo
  echo "→ GET $BASE8000/api/v1/seller/dashboard"
  curl -i -sS -H "Authorization: Bearer $TOKEN" "$BASE8000/api/v1/seller/dashboard" || true
  echo
}

proxy_metrics() {
  echo "→ Proxy metrics (Cookie + Bearer) $BASE3001/api/dashboard/metrics"
  curl -i -sS -b cookies.txt -H "Authorization: Bearer $TOKEN" \
    "$BASE3001/api/dashboard/metrics" || true
  echo
}

# ── run ───────────────────────────────────────────────────────────────────────
echo "=== dev-up start ==="
check_routes
login_if_needed
probe_auth
hit_metrics
proxy_metrics

cat <<'NOTE'

If you still see:
 • 403 with {"hint":"admin_required"} on non-admin paths:
   – Ensure your auth context only enforces admin for /admin or /api/v1/admin.
   – Confirm v1 protected block uses app.requireAuth, ensureSellerIdHook(app), rlsOnRequest.

 • 404 "No route ..." for the endpoints above:
   – The backend that’s running doesn’t have those handlers mounted.
   – Check logs for "v1 plugin mounted" and that registerMetric/registerSeller are registered.

 • "Could not extract access_token":
   – The login proxy didn’t return JSON with access_token; print login.json (already done above) and fix upstream.

Re-run:  chmod +x dev-up.sh && ./dev-up.sh
NOTE

echo "=== dev-up done ==="
