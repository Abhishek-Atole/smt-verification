#!/usr/bin/env bash
#
# setup.sh — Fully automated production deployment for SMT Verification
# Run this ON the client Ubuntu PC. No pre-filled .env needed — all secrets
# are generated automatically.
#
# Prerequisites:
#   1. Extract the release tarball: tar -xzf smt-verification-vX.Y.Z.tar.gz
#   2. cd into the extracted directory
#   3. Run: sudo ./setup.sh
#
set -euo pipefail

APP_DIR="$(pwd)"
APP_USER="smt-app"
DB_NAME="smtverification"
DB_USER="smtverify"
PORT=4000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

error() { echo -e "${RED}✗ ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
step() { echo -e "${BLUE}═══ $*${NC}"; }

# Must run as root
[ "$EUID" -eq 0 ] || error "This script must be run as root (use: sudo ./setup.sh)"

# Sanity checks
[ -f "$APP_DIR/package.json" ] || error "package.json not found — run this from the extracted release directory"
[ -f "$APP_DIR/.env.example" ] || error ".env.example not found — is this a valid release?"

echo
step "SMT Verification — Automated Production Setup"
echo
info "Installation directory: $APP_DIR"
info "Target port: $PORT"
info "Database: $DB_NAME (user: $DB_USER)"
echo

# Disk space check — node_modules needs ~5 GB
AVAIL_KB=$(df -k "$APP_DIR" | awk 'NR==2 {print $4}')
REQUIRED_KB=$((6 * 1024 * 1024))
if [ "$AVAIL_KB" -lt "$REQUIRED_KB" ]; then
  error "Not enough disk space. Need at least 6 GB free, have $((AVAIL_KB / 1024 / 1024)) GB. Free up space and retry."
fi
info "Disk space OK ($(( AVAIL_KB / 1024 / 1024 )) GB available)"

# ============================================================================
# Phase 1: System dependencies
# ============================================================================
step "Phase 1/6: Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || error "apt-get update failed — check internet connection"
apt-get install -y -qq curl git postgresql postgresql-contrib ufw openssl

# Node.js 22 LTS
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  info "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
info "Node: $(node -v)"

# Enable corepack and pin pnpm to the exact version the lockfile was built with
corepack enable
# Force the version matching packageManager field — prevents corepack grabbing pnpm 11+
corepack prepare pnpm@10.33.0 --activate
info "pnpm: $(pnpm -v)"

# System user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -s /bin/false "$APP_USER"
  info "Created system user: $APP_USER"
fi

# Directories
mkdir -p /var/backups/"$DB_NAME"
mkdir -p "$APP_DIR/logs" "$APP_DIR/exports"
info "Created backup and log directories"

# ============================================================================
# Phase 2: Generate secrets and .env
# ============================================================================
step "Phase 2/6: Generating secrets and .env file"

# Generate all secrets
DB_PASS=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_ADMIN_SECRET=$(openssl rand -hex 32)
AUDIT_HMAC_SECRET=$(openssl rand -hex 32)
QR_SIGNING_KEY=$(openssl rand -hex 32)
LICENSE_HMAC_KEY=$(openssl rand -hex 32)
SEED_OP=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_QA=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_SV=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_AD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
SEED_ST=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)

LAN_IP=$(hostname -I | awk '{print $1}')

# Write production .env
cat > "$APP_DIR/.env" <<ENV
# Production environment — generated $(date)
DATABASE_URL='postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME'
JWT_SECRET='$JWT_SECRET'
JWT_ADMIN_SECRET='$JWT_ADMIN_SECRET'
QR_SIGNING_KEY='$QR_SIGNING_KEY'
ALLOWED_ORIGINS='http://$LAN_IP:$PORT'
PORT=$PORT
NODE_ENV=production
COOKIE_SECURE=false
HOST=0.0.0.0
SERVE_STATIC=true
ANTHROPIC_API_KEY=
COMPANY_NAME=
COMPANY_LOGO_PATH=
VITE_LICENSE_HMAC_KEY='$LICENSE_HMAC_KEY'
AUDIT_HMAC_SECRET='$AUDIT_HMAC_SECRET'
ADMIN_PORTAL_PATH=/infizent-control-9f4a2e
ADMIN_IP_ALLOWLIST=127.0.0.1,::1
BACKUP_DIR=/var/backups/$DB_NAME
BACKUP_RETENTION_DAYS=30
BACKUP_PG_DUMP_PATH=/usr/bin/pg_dump
SHIFT_A_NAME=Morning
SHIFT_A_START=06:00
SHIFT_A_END=14:00
SHIFT_B_NAME=Afternoon
SHIFT_B_START=14:00
SHIFT_B_END=22:00
SHIFT_C_NAME=Night
SHIFT_C_START=22:00
SHIFT_C_END=06:00
DB_MAX_SIZE_MB=10240
JOB_QUEUE_MAX_DEPTH=1000
SEED_OPERATOR_PASSWORD='$SEED_OP'
SEED_QA_PASSWORD='$SEED_QA'
SEED_SUPERVISOR_PASSWORD='$SEED_SV'
SEED_ADMIN_PASSWORD='$SEED_AD'
SEED_STORE_PASSWORD='$SEED_ST'
ENV

chmod 600 "$APP_DIR/.env"
info "Generated .env with fresh secrets"

# Issue a full 365-day license so the app doesn't lapse to the license overlay
# when the auto-started 14-day trial ends. The web (non-Electron) build reports
# a constant machine ID, so the license binds to that known value; it is signed
# with the same LICENSE_HMAC_KEY baked into the frontend bundle. Override the
# customer name with:  CUSTOMER="ACME Ltd" sudo -E ./setup.sh
CUSTOMER="${CUSTOMER:-Infizent Client}"
LICENSE_ACTIVATION=$(
  LICENSE_HMAC_KEY="$LICENSE_HMAC_KEY" node "$APP_DIR/artifacts/license-issuer/generate-license.js" \
    --customer "$CUSTOMER" --type professional --machine dev-mode-no-machine-binding --days 365 \
    2>/dev/null | awk '/ACTIVATION STRING/{getline; print; exit}'
)
if [ -n "$LICENSE_ACTIVATION" ]; then
  info "Generated 365-day license for \"$CUSTOMER\""
else
  warn "License generation failed — app will run on a 14-day trial until activated manually"
fi

# Save credentials for hand-over
cat > "$APP_DIR/CREDENTIALS.txt" <<CREDS
SMT Verification — Initial Credentials
Generated: $(date)
=====================================

App URL: http://$LAN_IP:$PORT
Admin Portal: http://$LAN_IP:$PORT/infizent-control-9f4a2e

SEEDED USER ACCOUNTS (change passwords on first login):
  operator1 / operator2 : $SEED_OP
  qa1                   : $SEED_QA
  engineer1 (supervisor): $SEED_SV
  admin1                : $SEED_AD
  storekeeper1          : $SEED_ST

Database: $DB_NAME (localhost:5432)
DB User: $DB_USER
DB Password: $DB_PASS

Backups: /var/backups/$DB_NAME (runs daily at 02:00)

LICENSE ACTIVATION (a 14-day trial auto-starts on first load):
  To install the full 365-day license ($CUSTOMER), open the App URL, go to
  the Admin Portal > License > Activate, and paste this activation string:

    $LICENSE_ACTIVATION

  Fallback (if the trial already lapsed and the License page is locked):
  open the App URL, press F12 > Console, paste this line and press Enter:
    localStorage.setItem('lic_info', atob('$LICENSE_ACTIVATION')); location.reload()

⚠ SECURITY:
- Change all user passwords immediately after first login
- Keep this file secure — delete after passwords are changed
- Set a static IP for this machine before go-live
CREDS

chmod 600 "$APP_DIR/CREDENTIALS.txt"
info "Saved credentials to CREDENTIALS.txt"

# ============================================================================
# Phase 3: Database setup
# ============================================================================
step "Phase 3/6: Setting up PostgreSQL"

systemctl enable --now postgresql

# Create role and database
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USER PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

info "Database ready"

# ============================================================================
# Phase 4: Build application
# ============================================================================
step "Phase 4/6: Building application"

# Install and build as the original user (not root)
ORIG_USER=$(logname 2>/dev/null || echo "ubuntu")
chown -R "$ORIG_USER":"$ORIG_USER" "$APP_DIR"

sudo -u "$ORIG_USER" env APP_DIR="$APP_DIR" VITE_LICENSE_HMAC_KEY="$LICENSE_HMAC_KEY" bash <<'BUILD'
set -euo pipefail
cd "$APP_DIR"
export CI=true
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
# VITE_LICENSE_HMAC_KEY must be in env so Vite bakes it into the frontend bundle
pnpm --filter infizent-technology-suite run build
BUILD

info "Builds complete"

# ============================================================================
# Phase 5: Database schema and seed
# ============================================================================
step "Phase 5/6: Applying database schema"

set -a; source "$APP_DIR/.env"; set +a

# Drizzle push
sudo -u "$ORIG_USER" env APP_DIR="$APP_DIR" DATABASE_URL="$DATABASE_URL" bash <<'SCHEMA'
set -euo pipefail
cd "$APP_DIR"
set -a; source .env; set +a
cd lib/db
pnpm push < /dev/null
SCHEMA
info "Drizzle schema pushed"

# Create UserRole enum
sudo -u postgres psql "$DB_NAME" -v ON_ERROR_STOP=1 <<'ENUM' 2>/dev/null || true
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('operator','qa','supervisor','admin','storekeeper');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ENUM
info "UserRole enum created"

# Ops migrations
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/migrations/ops/0003_add_constraints_and_indexes.sql" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/migrations/ops/0004_manage_analytics_views.sql" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/scripts/add-indexes.sql" >/dev/null
info "Ops migrations applied"

# Seed users
pnpm --filter @workspace/api-server run seed:users 2>&1 | grep -E "(created user|updated existing|Done)" || true
info "Users seeded"

# ============================================================================
# Phase 6: systemd service + firewall
# ============================================================================
step "Phase 6/6: Installing service and firewall"

cat > /etc/systemd/system/smt-verification.service <<UNIT
[Unit]
Description=SMT Verification API + SPA
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/artifacts/api-server
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node --enable-source-maps $APP_DIR/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
# ProtectHome is intentionally omitted — APP_DIR may be under /home and
# ProtectHome=true makes the entire /home tree invisible to the service.
# smt-app is a no-shell system user, so this protection adds no value.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR $APP_DIR/logs $APP_DIR/exports /var/backups/$DB_NAME

[Install]
WantedBy=multi-user.target
UNIT

# Give smt-app ownership of only the dirs it needs to write at runtime.
# Source, dist, and node_modules stay owned by the install user so they
# can be rebuilt without sudo.
chown -R "$APP_USER":"$APP_USER" \
  "$APP_DIR/logs" \
  "$APP_DIR/exports" \
  /var/backups/"$DB_NAME"
# .env must be readable by smt-app but no one else
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# Ensure the service user can traverse all parent directories into APP_DIR.
# Ubuntu home dirs default to 750, which blocks smt-app from entering the
# working directory (systemd exits with status=200/CHDIR). Walk up to root
# and add execute (traverse) permission for "others" on each ancestor.
_path="$APP_DIR"
while [ "$_path" != "/" ]; do
  _path="$(dirname "$_path")"
  chmod o+x "$_path"
done

systemctl daemon-reload
systemctl enable smt-verification
systemctl start smt-verification

sleep 3
if systemctl is-active --quiet smt-verification; then
  info "Service started"
else
  error "Service failed to start — check: sudo journalctl -u smt-verification -n 50"
fi

# Firewall
ufw allow OpenSSH >/dev/null
ufw allow "$PORT"/tcp >/dev/null
ufw --force enable >/dev/null
info "Firewall configured"

# ============================================================================
# Summary
# ============================================================================
echo
step "Installation Complete!"
echo
info "App URL: http://$LAN_IP:$PORT"
info "Service: sudo systemctl status smt-verification"
info "Logs: sudo journalctl -u smt-verification -f"
echo
warn "NEXT STEPS:"
warn "1. Read CREDENTIALS.txt (in this directory) for login passwords"
warn "2. Open http://$LAN_IP:$PORT in a browser"
warn "3. Activate the full license: Admin Portal > License > Activate (string in CREDENTIALS.txt)"
warn "4. Change all user passwords on first login"
warn "5. Set a STATIC IP for this machine"
warn "6. Copy daily backups from /var/backups/$DB_NAME to a NAS"
echo
