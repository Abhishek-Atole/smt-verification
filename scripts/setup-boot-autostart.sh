#!/bin/bash

################################################################################
# SMT Verification System - Setup Auto-Start on Boot
# This script configures the system to auto-start after power cut/restart
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}SMT Verification - Boot Auto-Start Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}ERROR: This script must be run as root (use sudo)${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVICE_FILE="$SCRIPT_DIR/smt-verification.service"
RESTART_SCRIPT="$SCRIPT_DIR/system-restart-recovery.sh"
LOG_DIR="/var/log/smt-verification"
RUN_DIR="/var/run/smt-verification"

echo -e "${YELLOW}Step 0: Preparing runtime directories...${NC}"
mkdir -p "$LOG_DIR" "$RUN_DIR"
chmod 755 "$LOG_DIR" "$RUN_DIR"
echo -e "${GREEN}✓ Runtime directories ready${NC}"
echo ""

echo -e "${YELLOW}Step 1: Making scripts executable...${NC}"
if [ -f "$RESTART_SCRIPT" ]; then
  chmod +x "$RESTART_SCRIPT"
else
  echo -e "${RED}✗ Restart script not found: $RESTART_SCRIPT${NC}"
  exit 1
fi
ln -sf "$RESTART_SCRIPT" /usr/local/bin/system-restart-recovery.sh
echo -e "${GREEN}✓ Scripts are executable${NC}"
echo ""

echo -e "${YELLOW}Step 2: Installing systemd service...${NC}"
if [ -f "$SERVICE_FILE" ]; then
  cp "$SERVICE_FILE" /etc/systemd/system/smt-verification.service
  echo -e "${GREEN}✓ Service file installed${NC}"
else
  echo -e "${RED}✗ Service file not found: $SERVICE_FILE${NC}"
  exit 1
fi
echo ""

echo -e "${YELLOW}Step 3: Reloading systemd daemon...${NC}"
systemctl daemon-reload
echo -e "${GREEN}✓ Systemd daemon reloaded${NC}"
echo ""

echo -e "${YELLOW}Step 4: Enabling service to start on boot...${NC}"
systemctl enable smt-verification.service
echo -e "${GREEN}✓ Service enabled for boot${NC}"
echo ""

echo -e "${YELLOW}Step 5: Testing the service...${NC}"
echo "Starting service (this may take a moment)..."
systemctl start smt-verification.service
sleep 3

if systemctl is-active --quiet smt-verification.service; then
  echo -e "${GREEN}✓ Service is running${NC}"
else
  echo -e "${RED}✗ Service failed to start${NC}"
  echo "Checking service status:"
  systemctl status smt-verification.service || true
  exit 1
fi
echo ""

echo -e "${YELLOW}Step 6: Configuring environment variables...${NC}"
cat > /etc/default/smt-verification <<'EOF'
# SMT Verification System Environment Variables
# Used by systemd service

# Database Configuration
DB_HOST=localhost
DB_USER=postgres
DB_NAME=smt_verification
DB_PORT=5432

# API Server
API_PORT=3000

# Frontend App
APP_PORT=5173
BASE_PATH=/api

# Logging
LOG_LEVEL=info

# Recovery
AUTO_RESTART=true
EOF
chown root:root /etc/default/smt-verification
chmod 600 /etc/default/smt-verification
echo -e "${GREEN}✓ Environment configuration created${NC}"
echo ""

echo -e "${YELLOW}Step 7: Creating cron job for periodic health checks...${NC}"
CRON_JOB="*/5 * * * * /bin/bash $RESTART_SCRIPT status > /dev/null 2>&1"
CRON_FILE="/etc/cron.d/smt-verification-health"

cat > "$CRON_FILE" <<EOF
# SMT Verification Health Check
# Runs every 5 minutes to ensure system is healthy
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

*/5 * * * * root $RESTART_SCRIPT status >> /var/log/smt-verification/health-check.log 2>&1
EOF
chmod 644 "$CRON_FILE"
echo -e "${GREEN}✓ Health check cron job installed${NC}"
echo ""

echo -e "${YELLOW}Step 8: Creating directories and permissions...${NC}"
chmod 755 "$LOG_DIR" "$RUN_DIR"
echo -e "${GREEN}✓ Directories created and permissions set${NC}"
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${YELLOW}📋 Summary:${NC}"
echo "  Service Name:     smt-verification"
echo "  Service File:     /etc/systemd/system/smt-verification.service"
echo "  Recovery Script:  $RESTART_SCRIPT"
echo "  Config File:      /etc/default/smt-verification"
echo "  Log Directory:    /var/log/smt-verification"
echo "  API Port:         3000"
echo "  App Port:         5173"
echo ""

echo -e "${YELLOW}🔍 Next Steps:${NC}"
echo "  1. Verify service is running:"
echo "     ${BLUE}systemctl status smt-verification${NC}"
echo ""
echo "  2. Check logs:"
echo "     ${BLUE}journalctl -u smt-verification -f${NC}"
echo ""
echo "  3. View recovery logs:"
echo "     ${BLUE}tail -f /var/log/smt-verification/restart-recovery.log${NC}"
echo ""
echo "  4. Manual recovery if needed:"
echo "     ${BLUE}$RESTART_SCRIPT recover${NC}"
echo ""

echo -e "${YELLOW}🔐 Service Control:${NC}"
echo "  Start:    ${BLUE}systemctl start smt-verification${NC}"
echo "  Stop:     ${BLUE}systemctl stop smt-verification${NC}"
echo "  Restart:  ${BLUE}systemctl restart smt-verification${NC}"
echo "  Status:   ${BLUE}systemctl status smt-verification${NC}"
echo ""

echo -e "${YELLOW}⚙️  Test the Recovery:${NC}"
echo "  ${BLUE}$RESTART_SCRIPT recover${NC}"
echo ""

echo -e "${YELLOW}📊 System will now:${NC}"
echo "  ✓ Auto-start after power cut"
echo "  ✓ Auto-start after system reboot"
echo "  ✓ Force-unlock if locked"
echo "  ✓ Auto-restart if services fail"
echo "  ✓ Check health every 5 minutes"
echo "  ✓ Log all events to /var/log/smt-verification/"
echo ""

echo -e "${GREEN}🎉 Your system is now configured for auto-recovery!${NC}"
