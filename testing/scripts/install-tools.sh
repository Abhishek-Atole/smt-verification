#!/usr/bin/env bash
set -euo pipefail

echo "Checking local test prerequisites..."

check_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf '  %-12s %s\n' "$name" "ok"
  else
    printf '  %-12s %s\n' "$name" "missing"
  fi
}

check_tool pnpm
check_tool psql
check_tool k6
check_tool tsx
check_tool clinic
check_tool autocannon
check_tool 0x

echo
echo "If a tool is missing, install it outside the implementation tree before running the tests."
echo "Recommended app context: feeder-verification"
echo "Recommended app URL: http://localhost:3000"