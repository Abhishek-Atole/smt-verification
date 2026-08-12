#!/usr/bin/env bash
set -euo pipefail
source .env || true
BASE="${BASE:-http://localhost:3000}"

echo "=== Sprint 09 — Annexure System Tests ==="

# Helper: login and extract token (expects jq)
login() {
  local user=$1
  local pass=$2
  local role=$3
  local cookiefile
  cookiefile=$(mktemp)
  curl -s -c "$cookiefile" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\",\"role\":\"$role\"}" >/dev/null
  local token
  token=$(awk '/smt_token/ {print $7; exit}' "$cookiefile" || true)
  rm -f "$cookiefile"
  echo "$token"
}

OP_TOKEN=$(login "operator1" "operator123" "operator" || true)
ENG_TOKEN=$(login "engineer1" "engineer123" "engineer" || true)

echo "OP_TOKEN=${OP_TOKEN:+(present)} ENG_TOKEN=${ENG_TOKEN:+(present)}"

echo "-- T01: Unauthenticated access should be 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/annexure/programs")
if [ "$STATUS" = "401" ]; then
  echo "✅ T01: Unauthenticated blocked"
else
  echo "❌ T01: Expected 401 got $STATUS"
  exit 1
fi

echo "-- T02: Operator cannot create program (403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/annexure/programs" -H "Content-Type: application/json" -d '{"programName":"test","stage":"AOI","version":"1.0"}' -b "smt_token=$OP_TOKEN") || true
if [ "$STATUS" = "403" ]; then
  echo "✅ T02: Operator blocked from create"
else
  echo "❌ T02: Expected 403 got $STATUS"
  exit 1
fi

echo "-- T03: Engineer can create program"
PROG=$(curl -s -X POST "$BASE/api/annexure/programs" -H "Content-Type: application/json" -d '{"programName":"GL414906_REV03","stage":"AOI","machineId":"MY13500446","version":"1.0"}' -b "smt_token=$ENG_TOKEN" || true)
PROG_ID=$(echo "$PROG" | jq -r '.id // empty')
if [ -n "$PROG_ID" ]; then
  echo "✅ T03: Engineer created program $PROG_ID"
else
  echo "❌ T03: Create failed — $PROG"
  exit 1
fi

echo "-- T04: QR generation"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/annexure/programs/$PROG_ID/qr" -b "smt_token=$ENG_TOKEN" || true)
if [ "$STATUS" = "200" ]; then
  echo "✅ T04: QR generated"
else
  echo "❌ T04: Expected 200 got $STATUS"
  exit 1
fi

echo "-- T05: Raise issue (operator can do this)"
ISSUE=$(curl -s -X POST "$BASE/api/annexure/issues" -H "Content-Type: application/json" -d "{\"programId\":\"$PROG_ID\",\"title\":\"False call on J1\",\"issueType\":\"false_call\",\"severity\":\"medium\"}" -b "smt_token=$OP_TOKEN" || true)
ISSUE_ID=$(echo "$ISSUE" | jq -r '.id // empty')
if [ -n "$ISSUE_ID" ]; then
  echo "✅ T05: Issue raised $ISSUE_ID"
else
  echo "❌ T05: Raise issue failed — $ISSUE"
  exit 1
fi

echo "=== Tests complete ==="
