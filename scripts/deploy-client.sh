#!/usr/bin/env bash
#
# deploy-client.sh — one-shot LAN deployment of SMT Verification to a client
# Ubuntu PC over SSH. Encodes Phases 1-4 of the approved deployment plan:
#
#   Phase 1  provision: Node 22, pnpm, PostgreSQL, ufw
#   Phase 2  transfer repo @ release tag, build, fresh prod DB, migrate, seed
#   Phase 3  hardened systemd unit + firewall
#   Phase 4  smoke tests + credential hand-over file
#
# Usage:
#   ./scripts/deploy-client.sh user@host [-p ssh_port] [-i identity_file]
#
# Run from the repo root on the build machine. Requires: ssh, rsync, openssl.
# All secrets are generated fresh here and written only to the client's
# /opt/smt-verification/.env (chmod 600) and a local hand-over file.
#
set -euo pipefail

# ---------------------------------------------------------------- arguments
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: $0 user@host [-p port] [-i keyfile]"; exit 1; }
shift
SSH_OPTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -p) SSH_OPTS+=(-p "$2"); RSYNC_SSH_PORT="$2"; shift 2 ;;
    -i) SSH_OPTS+=(-i "$2"); RSYNC_SSH_KEY="$2"; shift 2 ;;
    *)  echo "unknown option: $1"; exit 1 ;;
  esac
done
RSYNC_RSH="ssh ${RSYNC_SSH_PORT:+-p $RSYNC_SSH_PORT} ${RSYNC_SSH_KEY:+-i $RSYNC_SSH_KEY}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_TAG="v2.2.0"
APP_DIR="/opt/smt-verification"
APP_PORT=4000
DB_NAME="smtverification"
DB_USER="smtverify"

run() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

echo "==> Deploying SMT Verification $RELEASE_TAG to $TARGET"

# ------------------------------------------------------------ sanity checks
git -C "$REPO_ROOT" rev-parse "$RELEASE_TAG" >/dev/null 2>&1 \
  || { echo "release tag $RELEASE_TAG not found locally"; exit 1; }
run "true" || { echo "cannot SSH to $TARGET"; exit 1; }

LAN_IP=$(run "hostname -I | awk '{print \$1}'")
echo "==> Client LAN IP: $LAN_IP"

# -------------------------------------------------------- generated secrets
DB_PASS=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_ADMIN_SECRET=$(openssl rand -hex 32)
AUDIT_HMAC_SECRET=$(openssl rand -hex 32)
SEED_OPERATOR_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_QA_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_SUPERVISOR_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_STORE_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)

# ================================================================== PHASE 1
echo "==> Phase 1: provisioning (Node 22, pnpm, PostgreSQL, ufw)"
run "bash -s" <<'PHASE1'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl git rsync postgresql postgresql-contrib ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
sudo corepack enable
sudo systemctl enable --now postgresql
sudo useradd -r -s /bin/false smt-app 2>/dev/null || true
node -v && pnpm -v || sudo corepack prepare pnpm@10 --activate
PHASE1

# ================================================================== PHASE 2
echo "==> Phase 2: transfer @ $RELEASE_TAG, build, database"

# Transfer a clean checkout of the release tag (not the working tree).
WORKTREE=$(mktemp -d)
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$RELEASE_TAG" >/dev/null
trap 'git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || true' EXIT

run "sudo mkdir -p $APP_DIR && sudo chown \$(whoami) $APP_DIR"
rsync -az --delete -e "$RSYNC_RSH" \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude .dev-docs --exclude docs --exclude .github \
  "$WORKTREE/" "$TARGET:$APP_DIR/"

# Fresh production database (idempotent: re-runs update the password).
run "sudo -u postgres psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN;
  END IF;
END \$\$;
ALTER ROLE $DB_USER PASSWORD '$DB_PASS';
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

# Production .env — written with a quiet umask, never echoed to the terminal.
run "umask 077 && cat > $APP_DIR/.env" <<ENV
DATABASE_URL='postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME'
JWT_SECRET='$JWT_SECRET'
JWT_ADMIN_SECRET='$JWT_ADMIN_SECRET'
AUDIT_HMAC_SECRET='$AUDIT_HMAC_SECRET'
ALLOWED_ORIGINS='http://$LAN_IP:$APP_PORT'
PORT=$APP_PORT
NODE_ENV=production
COOKIE_SECURE=false
ADMIN_IP_ALLOWLIST=127.0.0.1,::1
STATIC_ROOT=$APP_DIR/artifacts/feeder-scanner/dist/public
BACKUP_DIR=/var/backups/$DB_NAME
# Module 10.5 — TLS in transit is OFF by default (direct LAN over HTTP).
# To enable HTTPS: install a cert + key on the client, point these at them,
# set COOKIE_SECURE=true, update ALLOWED_ORIGINS to https://…, open 443/tcp,
# then restart the service. TRUST_PROXY only if a reverse proxy sits in front.
# TLS_CERT_PATH=$APP_DIR/tls/fullchain.pem
# TLS_KEY_PATH=$APP_DIR/tls/privkey.pem
# TRUST_PROXY=false
SEED_OPERATOR_PASSWORD='$SEED_OPERATOR_PASSWORD'
SEED_QA_PASSWORD='$SEED_QA_PASSWORD'
SEED_SUPERVISOR_PASSWORD='$SEED_SUPERVISOR_PASSWORD'
SEED_ADMIN_PASSWORD='$SEED_ADMIN_PASSWORD'
SEED_STORE_PASSWORD='$SEED_STORE_PASSWORD'
ENV

run "bash -s" <<PHASE2
set -euo pipefail
cd $APP_DIR
export CI=true
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter infizent-technology-suite run build

# Schema: drizzle push, then ops migrations, then indexes.
set -a; source $APP_DIR/.env; set +a
(cd lib/db && pnpm push < /dev/null)
psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/ops/0003_add_constraints_and_indexes.sql
psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/ops/0004_manage_analytics_views.sql
psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-indexes.sql
pnpm --filter @workspace/api-server run seed:users
PHASE2

# ================================================================== PHASE 3
echo "==> Phase 3: systemd unit + firewall"
run "bash -s" <<PHASE3
set -euo pipefail
sudo mkdir -p $APP_DIR/logs $APP_DIR/exports /var/backups/$DB_NAME
sudo chown -R smt-app:smt-app $APP_DIR /var/backups/$DB_NAME
sudo chmod 600 $APP_DIR/.env

sudo tee /etc/systemd/system/smt-verification.service > /dev/null <<'UNIT'
[Unit]
Description=SMT Verification API + SPA
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=smt-app
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/logs $APP_DIR/exports /var/backups/$DB_NAME

[Install]
WantedBy=multi-user.target
UNIT
# systemd does not expand $APP_DIR inside the quoted heredoc — patch it in:
sudo sed -i "s|\\\$APP_DIR|$APP_DIR|g" /etc/systemd/system/smt-verification.service

sudo systemctl daemon-reload
sudo systemctl enable --now smt-verification

sudo ufw allow OpenSSH
sudo ufw allow $APP_PORT/tcp
sudo ufw --force enable
PHASE3

# ================================================================== PHASE 4
echo "==> Phase 4: smoke tests"
sleep 3
run "bash -s" <<SMOKE
set -euo pipefail
fail=0
check() { echo -n "  \$1 ... "; if eval "\$2"; then echo PASS; else echo FAIL; fail=1; fi; }

check "health 200" \
  '[ "\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT/api/health)" = 200 ]'
check "SPA served" \
  'curl -s http://localhost:$APP_PORT/ | grep -qi "<!doctype html"'
check "login w/o CSRF header -> 403" \
  '[ "\$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$APP_PORT/api/auth/login \
     -H "Content-Type: application/json" -H "Origin: http://$LAN_IP:$APP_PORT" \
     -d "{}")" = 403 ]'
check "bad login w/ CSRF header -> 401" \
  '[ "\$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$APP_PORT/api/auth/login \
     -H "Content-Type: application/json" -H "Origin: http://$LAN_IP:$APP_PORT" \
     -H "X-Requested-With: XMLHttpRequest" \
     -d "{\"username\":\"nosuchuser\",\"password\":\"x\",\"role\":\"operator\"}")" = 401 ]'
check "unauth BOM read -> 401" \
  '[ "\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT/api/bom)" = 401 ]'
check "service active" 'systemctl is-active --quiet smt-verification'
exit \$fail
SMOKE

# ------------------------------------------------------------- hand-over
HANDOVER="$REPO_ROOT/deploy-handover-$(date +%Y%m%d-%H%M%S).txt"
umask 077
cat > "$HANDOVER" <<EOF
SMT Verification $RELEASE_TAG — deployed $(date)
Client: $TARGET   App URL: http://$LAN_IP:$APP_PORT

Seeded logins (ALL forced to change password on first login):
  operator1 / operator2 : $SEED_OPERATOR_PASSWORD
  qa1                   : $SEED_QA_PASSWORD
  engineer1 (supervisor): $SEED_SUPERVISOR_PASSWORD
  admin1                : $SEED_ADMIN_PASSWORD   (Control Panel: must set a NEW username + password on first login)
  storekeeper1          : $SEED_STORE_PASSWORD

DB: $DB_NAME / role $DB_USER (password in $APP_DIR/.env on the client only)

Reminders for the client:
  - Give this PC a static IP (or DHCP reservation) — the app URL depends on it.
  - Backups land in /var/backups/$DB_NAME daily at 02:00; copy them to a NAS.
  - Restore is manual by design: psql "\$DATABASE_URL" < backup.sql
  - Service control: sudo systemctl {status,restart} smt-verification
  - Logs: sudo journalctl -u smt-verification -f
EOF

echo
echo "==> Done. Hand-over notes (contains seed passwords, chmod 600):"
echo "    $HANDOVER"
echo "==> App: http://$LAN_IP:$APP_PORT"
