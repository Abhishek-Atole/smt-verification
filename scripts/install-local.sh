#!/usr/bin/env bash
#
# install-local.sh — Production deployment script for SMT Verification
# Run this ON the Ubuntu client/server machine that will host the app.
#
# Prerequisites (must be done manually first):
#   1. Extract the release tarball to /opt/smt-verification
#   2. Create .env file in /opt/smt-verification (see DEPLOYMENT_GUIDE.md)
#   3. Ensure this script is executable: chmod +x install-local.sh
#
# Usage:
#   sudo ./install-local.sh
#
set -euo pipefail

APP_DIR="/opt/smt-verification"
APP_USER="smt-app"
DB_NAME="smtverification"
DB_USER="smtverify"
PORT="${PORT:-4000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

error() { echo -e "${RED}ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}INFO: $*${NC}"; }
warn() { echo -e "${YELLOW}WARN: $*${NC}"; }

# Must run as root
[ "$EUID" -eq 0 ] || error "This script must be run as root (use sudo)"

# Check prereqs
[ -d "$APP_DIR" ] || error "$APP_DIR does not exist — extract the release tarball first"
[ -f "$APP_DIR/.env" ] || error "$APP_DIR/.env not found — create it from .env.example first"
[ -f "$APP_DIR/package.json" ] || error "$APP_DIR/package.json not found — is this a valid release?"

info "SMT Verification Production Install — $(date)"
echo

# ============================================================================
# Phase 1: System dependencies
# ============================================================================
info "Phase 1: Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git postgresql postgresql-contrib ufw

# Node.js 22 LTS
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  info "Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
info "Node version: $(node -v)"

# Enable corepack for pnpm
corepack enable
info "pnpm version: $(pnpm -v)"

# System user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -s /bin/false "$APP_USER"
  info "Created system user: $APP_USER"
fi

# Backup directory
mkdir -p /var/backups/"$DB_NAME"
chown -R "$APP_USER":"$APP_USER" /var/backups/"$DB_NAME"

# ============================================================================
# Phase 2: Database setup
# ============================================================================
info "Phase 2: Setting up PostgreSQL database"

systemctl enable --now postgresql

# Read DB password from .env
set -a; source "$APP_DIR/.env"; set +a
DB_PASS="${DATABASE_URL##*:}"
DB_PASS="${DB_PASS%%@*}"

# Create role and database (idempotent)
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

info "Database $DB_NAME ready"

# ============================================================================
# Phase 3: Build application
# ============================================================================
info "Phase 3: Building application"

cd "$APP_DIR"
chown -R "$(logname)":"$(logname)" "$APP_DIR" 2>/dev/null || chown -R 1000:1000 "$APP_DIR"

# Install and build as the owning user (not root, to avoid permission issues)
sudo -u "$(logname)" bash <<'BUILD'
set -euo pipefail
cd /opt/smt-verification
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter infizent-technology-suite run build
BUILD

info "Builds complete"

# ============================================================================
# Phase 4: Database schema and seed
# ============================================================================
info "Phase 4: Applying database schema"

set -a; source "$APP_DIR/.env"; set +a

# Drizzle push
sudo -u "$(logname)" bash <<'SCHEMA'
set -euo pipefail
cd /opt/smt-verification
set -a; source .env; set +a
cd lib/db
pnpm push < /dev/null
SCHEMA

# Create UserRole enum (Drizzle push doesn't cover it)
sudo -u postgres psql "$DB_NAME" -v ON_ERROR_STOP=1 <<'ENUM'
CREATE TYPE "UserRole" AS ENUM ('operator','qa','supervisor','admin','storekeeper');
ENUM
info "UserRole enum created"

# Ops migrations
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/migrations/ops/0003_add_constraints_and_indexes.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/migrations/ops/0004_manage_analytics_views.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/scripts/add-indexes.sql"
info "Ops migrations applied"

# Seed users
pnpm --filter @workspace/api-server run seed:users
info "Users seeded"

# ============================================================================
# Phase 5: systemd service
# ============================================================================
info "Phase 5: Installing systemd service"

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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/logs $APP_DIR/exports /var/backups/$DB_NAME

[Install]
WantedBy=multi-user.target
UNIT

# Fix ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" /var/backups/"$DB_NAME"
chmod 600 "$APP_DIR/.env"

systemctl daemon-reload
systemctl enable smt-verification
systemctl start smt-verification

info "Service started"

# ============================================================================
# Phase 6: Firewall
# ============================================================================
info "Phase 6: Configuring firewall"

ufw allow OpenSSH
ufw allow "$PORT"/tcp
ufw --force enable

info "Firewall rules applied"

# ============================================================================
# Summary
# ============================================================================
echo
info "=========================================="
info "Installation complete!"
info "=========================================="
echo
info "App URL: http://$(hostname -I | awk '{print $1}'):$PORT"
info "Service: sudo systemctl status smt-verification"
info "Logs: sudo journalctl -u smt-verification -f"
echo
warn "IMPORTANT:"
warn "1. Set a STATIC IP for this machine (or DHCP reservation)"
warn "2. Change all seeded user passwords on first login"
warn "3. Copy daily backups from /var/backups/$DB_NAME to a NAS"
warn "4. The app URL will change if the IP changes"
echo
