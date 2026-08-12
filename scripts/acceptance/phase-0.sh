#!/usr/bin/env bash
# Phase 0 acceptance script — runs from repo root.
# Exit 0 = phase signed off. Non-zero = phase NOT done.
set -euo pipefail

API="${API_BASE:-http://localhost:3001}"
FAIL=0

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "=== Phase 0 Acceptance: Error cleanup & baseline ==="
echo ""

echo "--- Check 1: TypeScript clean ---"
if pnpm run typecheck 2>&1 | grep -q "Done"; then
  pass "pnpm run typecheck exits 0"
else
  fail "pnpm run typecheck has errors"
fi

echo ""
echo "--- Check 2: .env.example completeness ---"
REQUIRED_VARS=(DATABASE_URL JWT_SECRET JWT_ADMIN_SECRET AUDIT_HMAC_SECRET ADMIN_PORTAL_PATH
  ADMIN_USERNAME ADMIN_PASSWORD_HASH SHIFT_MORNING_START SHIFT_AFTERNOON_START SHIFT_NIGHT_START
  TZ DB_MAX_SIZE_MB JOB_QUEUE_MAX_DEPTH BACKUP_DIR BACKUP_CRON BACKUP_RETENTION_DAYS)
for v in "${REQUIRED_VARS[@]}"; do
  if grep -q "^${v}=" .env.example 2>/dev/null; then
    pass ".env.example has $v"
  else
    fail ".env.example missing $v"
  fi
done

echo ""
echo "--- Check 3: API health ---"
HEALTH=$(curl -sf "${API}/api/health" 2>/dev/null || echo "UNREACHABLE")
if echo "$HEALTH" | grep -q '"status"'; then
  pass "GET /api/health → 200"
else
  fail "GET /api/health failed (is api-server running?): $HEALTH"
fi

echo ""
echo "--- Check 4: Unauthenticated BOM rejected ---"
STATUS=$(curl -so /dev/null -w "%{http_code}" "${API}/api/bom" 2>/dev/null || echo "000")
if [ "$STATUS" = "401" ]; then
  pass "GET /api/bom (no auth) → 401"
else
  fail "GET /api/bom (no auth) → $STATUS (expected 401)"
fi

echo ""
if [ "$FAIL" = "1" ]; then
  echo "=== PHASE 0 NOT SIGNED OFF — fix failures above ==="
  exit 1
else
  echo "=== PHASE 0 SIGNED OFF ==="
  exit 0
fi
