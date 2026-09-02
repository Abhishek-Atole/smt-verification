#!/usr/bin/env bash
#
# package-release.sh — Build the hand-over package for client deployment.
# Run from the repo root on the developer's machine.
#
# Produces:
#   smt-verification-vX.Y.Z.tar.gz   — extract onto client and run setup.sh
#
# Usage:
#   ./scripts/package-release.sh [tag]
#   ./scripts/package-release.sh v2.2.0
#   ./scripts/package-release.sh          (uses latest git tag)
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(git -C "$REPO" describe --tags --abbrev=0 2>/dev/null || echo "")}"

[ -n "$TAG" ] || { echo "Usage: $0 <tag>  (e.g. v2.2.0)"; exit 1; }

git -C "$REPO" rev-parse "$TAG" >/dev/null 2>&1 || { echo "Tag $TAG not found"; exit 1; }

OUT="$REPO/smt-verification-${TAG}.tar.gz"

echo "Packaging release $TAG → $OUT"

# Export the tagged tree into a staging dir (.env is gitignored so never
# included), prune dev-only files (client-deploy hygiene), then re-pack. Sample
# CSVs under docs/samples are kept — clients use them as BOM import examples.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git -C "$REPO" archive --format=tar --prefix="smt-verification/" "$TAG" | tar -x -C "$STAGE"

ROOT="$STAGE/smt-verification"

# --- Prune: nothing the client install does not need ---------------------------
# Rule: a path stays only if setup.sh, the systemd service, or one of the two
# builds (`pnpm --filter @workspace/api-server run build`,
# `pnpm --filter infizent-technology-suite run build`) actually reads it.
# Removing a workspace package is safe: pnpm-workspace.yaml uses globs, so an
# unmatched glob is simply skipped and `pnpm install --frozen-lockfile` still
# succeeds (verified — 8 projects instead of 10, exit 0).

# Internal documentation and CI — never client-facing.
rm -rf "$ROOT/.dev-docs" \
       "$ROOT/.github" \
       "$ROOT/docs/reports" \
       "$ROOT/docs/internal" \
       "$ROOT/docs/VERIFICATION_16_FIELD_IMPLEMENTATION.sh" \
       "$ROOT/README.md"

# Dev-only workspaces. mockup-sandbox is a design sandbox; feeder-verification is
# an abandoned Next.js/Prisma prototype (it also carries a 1.7 MB zip of the whole
# repo in its public/ dir, which must never leave the dev machine). Neither is
# imported by api-server or feeder-scanner.
rm -rf "$ROOT/artifacts/mockup-sandbox" \
       "$ROOT/feeder-verification"

# Prisma leftovers from that prototype. Nothing in the runtime imports Prisma —
# build.mjs only names @prisma/client in its esbuild `external` list.
rm -rf "$ROOT/prisma" "$ROOT/prisma.config.ts"

# Load/perf test harness and its recorded past results.
rm -rf "$ROOT/testing"

# Developer tooling inside scripts/. Kept: add-indexes.sql (setup.sh applies it),
# package.json + tsconfig.json (workspace member), and the operational helpers a
# client may genuinely need (secure-env, boot-autostart, restart-recovery,
# smt-verification.service, deploy-client, install-local).
rm -rf "$ROOT/scripts/acceptance" \
       "$ROOT/scripts/bench" \
       "$ROOT/scripts/ci" \
       "$ROOT/scripts/reports" \
       "$ROOT/scripts/src" \
       "$ROOT/scripts/package-release.sh" \
       "$ROOT/scripts/seed-stress-test.ts" \
       "$ROOT/scripts/test-full-system.sh" \
       "$ROOT/scripts/test-sprint-09.sh" \
       "$ROOT/scripts/migrate-users-to-uuid.sh" \
       "$ROOT/scripts/post-merge.sh"

# Editor / lint tool configs.
rm -f "$ROOT/opencode.json" "$ROOT/.markdownlintrc.json"

# Test suites. The client never runs vitest, and these files name internal
# routes, mocked secrets and fixtures that only add noise on a shop-floor PC.
find "$ROOT" -type d -name '__tests__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$ROOT" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \
        -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -delete 2>/dev/null || true

# --- Guard: the pruning above must not have removed anything setup.sh needs ----
# Every path here is read by setup.sh, the systemd unit, or a build. If a future
# prune line is too broad this fails loudly at packaging time instead of on the
# client PC at 2 a.m.
echo "Verifying the release still has everything setup.sh needs…"
missing=""
for req in \
  setup.sh .env.example package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
  scripts/add-indexes.sql scripts/package.json scripts/lock-app-dir.sh \
  migrations/ops/0003_add_constraints_and_indexes.sql \
  migrations/ops/0004_manage_analytics_views.sql \
  artifacts/license-issuer/generate-license.js \
  artifacts/api-server/package.json artifacts/api-server/build.mjs \
  artifacts/api-server/scripts/seed-users.ts artifacts/api-server/src/index.ts \
  artifacts/feeder-scanner/package.json artifacts/feeder-scanner/vite.config.ts \
  lib/db/package.json lib/db/drizzle.config.ts lib/db/src/index.ts \
  lib/db/src/schema/index.ts lib/db/src/create-reels-table.ts \
  lib/db/src/add-report-archive-record.ts \
  lib/db/src/create-report-output-settings-table.ts \
  docs/samples/BOM_IMPORT_EXAMPLE.csv
do
  [ -e "$ROOT/$req" ] || missing+="  - $req"$'\n'
done
if [ -n "$missing" ]; then
  echo "ABORTING — the prune list removed files the client install needs:" >&2
  printf '%s' "$missing" >&2
  exit 1
fi
echo "Release contents: complete."

# --- Secret-leak guard (security audit Item 4) --------------------------------
# The tree came from `git archive` of the tag, so a gitignored .env can never be
# in it — this is a belt-and-suspenders scan that ABORTS packaging if a real
# secret slipped into a committed file. It intentionally ignores .env.example and
# the hyphenated / "change-me" placeholders used throughout the docs, flagging
# only real artifacts: a non-example .env, key/cert material, a shipped
# CREDENTIALS.txt, an npm auth token, or a high-entropy hex secret value.
echo "Scanning staged tree for bundled secrets…"
violations=""
rel() { echo "$1" | sed "s#$ROOT/##" | tr '\n' ' '; }

hits=$(find "$ROOT" -type f -name '.env*' ! -name '.env.example' 2>/dev/null || true)
[ -n "$hits" ] && violations+="  - real .env file(s): $(rel "$hits")"$'\n'

hits=$(find "$ROOT" -type f \( -iname '*.pem' -o -iname '*.key' -o -iname '*.pfx' \
        -o -iname '*.p12' -o -iname '*.jks' -o -iname '*.keystore' \
        -o -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_dsa' \) 2>/dev/null || true)
[ -n "$hits" ] && violations+="  - key/cert file(s): $(rel "$hits")"$'\n'

hits=$(find "$ROOT" -type f -name 'CREDENTIALS.txt' 2>/dev/null || true)
[ -n "$hits" ] && violations+="  - CREDENTIALS.txt present: $(rel "$hits")"$'\n'

hits=$(grep -rlaiE '(_authToken|_password|_auth)=' "$ROOT" --include='.npmrc' 2>/dev/null || true)
[ -n "$hits" ] && violations+="  - .npmrc with auth token: $(rel "$hits")"$'\n'

# 40+ contiguous hex chars after a secret-ish key never matches the hyphenated
# placeholders the docs and .env.example use; it does match `openssl rand -hex`.
hits=$(grep -rlaE '(SECRET|_KEY|TOKEN|PASSWORD)=[0-9a-fA-F]{40,}' "$ROOT" 2>/dev/null || true)
[ -n "$hits" ] && violations+="  - high-entropy hex secret in: $(rel "$hits")"$'\n'

if [ -n "$violations" ]; then
  echo "ABORTING — possible secret(s) in the release tree:" >&2
  printf '%s' "$violations" >&2
  echo "These must never ship. Remove from the tagged tree and re-tag." >&2
  exit 1
fi
echo "Secret scan: clean."

tar -czf "$OUT" -C "$STAGE" smt-verification

echo "Done: $OUT ($(du -sh "$OUT" | cut -f1))"
echo
echo "Client runs:"
echo "  tar -xzf $(basename "$OUT")"
echo "  cd smt-verification"
echo "  sudo ./setup.sh"
echo "  # then follow CREDENTIALS.txt (login passwords + license activation)"
