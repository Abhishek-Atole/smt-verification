#!/usr/bin/env bash
# Simple security check scripts to run in CI or locally.
set -euo pipefail

echo "Running basic security checks..."

# 1) ensure requireRole includes admin
echo "Checking requireRole() usages..."
rg "requireRole\(" --hidden || true
if rg "requireRole\([^)]*\)" | rg -v "admin"; then
  echo "ERROR: Found requireRole() calls without 'admin' — please review." >&2
  exit 2
else
  echo "requireRole() checks passed (admin included where detected)."
fi

# 2) detect likely secrets in code (simple heuristics)
echo "Scanning for high-entropy hex strings..."
if rg "[0-9a-fA-F]{32,}" --hidden --max-filesize 1M; then
  echo "Warning: possible secrets found — review matches above." || true
fi

echo "Security checks complete. Add this script to CI job as needed."
