#!/usr/bin/env bash
#
# lock-app-dir.sh — make the install directory root-owned (sudo-only to modify),
# or hand it back to a build user for the duration of an upgrade.
#
# WHY: the app tree sits on a shop-floor PC that operators use. Anyone who can
# write to it can edit dist/index.mjs — or a .ts file and rebuild — and thereby
# change verification logic, the audit chain, or the license check. Read access
# is not the threat; write access is. So the tree is owned by root and the
# service account gets group-read only.
#
# The service still has to WRITE a small, known set of directories, so those are
# carved back out to smt-app after the recursive pass:
#
#   $APP_DIR/logs                          (service log dir)
#   $APP_DIR/exports                       (created by setup.sh)
#   $APP_DIR/artifacts/api-server/exports  (ExportService resolves its output
#                                           against process.cwd(), and the
#                                           systemd unit's WorkingDirectory is
#                                           artifacts/api-server — so this, not
#                                           $APP_DIR/exports, is where CSV/XLSX
#                                           exports actually land)
#   $BACKUP_DIR                            (pg_dump target, outside APP_DIR)
#
# .env stays readable by the service but writable only by root. CREDENTIALS.txt
# becomes root-only: it holds the DB password and the license activation string,
# and nothing but a human with sudo should read it.
#
# Usage (must be root):
#   ./scripts/lock-app-dir.sh lock   /opt/smt-verification
#   ./scripts/lock-app-dir.sh unlock /opt/smt-verification <build-user>
#   ./scripts/lock-app-dir.sh status /opt/smt-verification
#
# unlock → rebuild → lock is the required order for any in-place upgrade; a
# rebuild cannot write dist/ or node_modules/ while the tree is locked.
#
set -euo pipefail

MODE="${1:-}"
APP_DIR="${2:-}"
APP_USER="${APP_USER:-smt-app}"
DB_NAME="${DB_NAME:-smtverification}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$DB_NAME}"

die() { printf '\033[0;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }

case "$MODE" in lock|unlock|status) ;; *)
  die "Usage: $0 {lock|unlock|status} <app-dir> [build-user]" ;;
esac

[ -n "$APP_DIR" ] || die "Missing <app-dir>."
[ -d "$APP_DIR" ] || die "Not a directory: $APP_DIR"
[ -f "$APP_DIR/package.json" ] || die "$APP_DIR does not look like an install (no package.json)."
APP_DIR="$(cd "$APP_DIR" && pwd)"   # normalise; the rm/chmod below must not walk a relative path

if [ "$MODE" = "status" ]; then
  printf 'Install dir : %s\n' "$APP_DIR"
  printf 'Owner/mode  : %s\n' "$(stat -c '%U:%G %a' "$APP_DIR")"
  printf '.env        : %s\n' "$(stat -c '%U:%G %a' "$APP_DIR/.env" 2>/dev/null || echo 'absent')"
  printf 'dist bundle : %s\n' "$(stat -c '%U:%G %a' "$APP_DIR/artifacts/api-server/dist/index.mjs" 2>/dev/null || echo 'absent')"
  if [ "$(stat -c '%U' "$APP_DIR")" = "root" ]; then
    printf '\033[0;32mState       : LOCKED (root-owned — sudo required to modify)\033[0m\n'
  else
    printf '\033[1;33mState       : UNLOCKED (owned by %s)\033[0m\n' "$(stat -c '%U' "$APP_DIR")"
  fi
  exit 0
fi

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo $0 $MODE $APP_DIR"

if [ "$MODE" = "unlock" ]; then
  BUILD_USER="${3:-${SUDO_USER:-}}"
  [ -n "$BUILD_USER" ] || die "Missing <build-user> and SUDO_USER is unset."
  id "$BUILD_USER" >/dev/null 2>&1 || die "No such user: $BUILD_USER"

  chown -R "$BUILD_USER":"$BUILD_USER" "$APP_DIR"
  chmod -R u+rwX "$APP_DIR"
  # .env holds every secret; even while unlocked it stays owner-only.
  [ -f "$APP_DIR/.env" ] && chmod 600 "$APP_DIR/.env"
  ok "unlocked for $BUILD_USER — rebuild now, then re-run with 'lock'"
  exit 0
fi

# ---- lock -------------------------------------------------------------------
id -u "$APP_USER" >/dev/null 2>&1 || die "Service user '$APP_USER' does not exist."

# root owns everything; the service account reads it via the group.
# node_modules is a few hundred thousand files, so both passes take a minute.
printf 'Locking %s (recursive chown + chmod over node_modules — this takes a minute)…\n' "$APP_DIR"
chown -R root:"$APP_USER" "$APP_DIR"
# u=rwX,g=rX,o= → dirs 750, files 640. Capital X only sets +x where it is already
# set for someone or the target is a directory, so setup.sh and the node_modules
# binaries keep their executable bit while plain source files lose it.
chmod -R u=rwX,g=rX,o= "$APP_DIR"
ok "tree owned by root:$APP_USER (dirs 750, files 640)"

# Carve back the directories the service must write at runtime.
for d in "$APP_DIR/logs" "$APP_DIR/exports" "$APP_DIR/artifacts/api-server/exports" "$BACKUP_DIR"; do
  mkdir -p "$d"
  chown -R "$APP_USER":"$APP_USER" "$d"
  chmod 750 "$d"
done
ok "runtime-writable: logs, exports, artifacts/api-server/exports, $BACKUP_DIR"

# Secrets: service reads .env, only root writes it. CREDENTIALS.txt is root-only.
if [ -f "$APP_DIR/.env" ]; then
  chown root:"$APP_USER" "$APP_DIR/.env"
  chmod 640 "$APP_DIR/.env"
  ok ".env root:$APP_USER 640 (service reads, only root writes)"
fi
if [ -f "$APP_DIR/CREDENTIALS.txt" ]; then
  chown root:root "$APP_DIR/CREDENTIALS.txt"
  chmod 600 "$APP_DIR/CREDENTIALS.txt"
  ok "CREDENTIALS.txt root:root 600 (read with: sudo cat CREDENTIALS.txt)"
fi

# The service user must be able to traverse every ancestor to reach APP_DIR.
# Ubuntu home dirs are 750, which makes systemd fail with status=200/CHDIR.
_p="$APP_DIR"
while [ "$_p" != "/" ]; do
  _p="$(dirname "$_p")"
  chmod o+x "$_p"
done
ok "ancestors traversable by $APP_USER"

printf '\n\033[0;32mLOCKED\033[0m — %s now requires sudo to modify.\n' "$APP_DIR"
printf 'To upgrade:  sudo %s unlock %s <user>  →  rebuild  →  sudo %s lock %s\n' \
  "$0" "$APP_DIR" "$0" "$APP_DIR"
