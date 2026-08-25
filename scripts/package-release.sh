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
rm -rf "$ROOT/.dev-docs" \
       "$ROOT/.github" \
       "$ROOT/docs/reports" \
       "$ROOT/docs/internal" \
       "$ROOT/README.md"

tar -czf "$OUT" -C "$STAGE" smt-verification

echo "Done: $OUT ($(du -sh "$OUT" | cut -f1))"
echo
echo "Client runs:"
echo "  tar -xzf $(basename "$OUT")"
echo "  cd smt-verification"
echo "  sudo ./setup.sh"
echo "  # then follow CREDENTIALS.txt (login passwords + license activation)"
