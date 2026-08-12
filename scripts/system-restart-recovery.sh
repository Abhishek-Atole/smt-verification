#!/bin/bash

################################################################################
# SMT Verification System - Restart & Recovery Script
# Handles: Power cuts, system failures, locks, auto-service startup
# Run at system boot or manually for recovery
################################################################################

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/var/log/smt-verification"
LOCK_DIR="/var/run/smt-verification"
LOCK_FILE="$LOCK_DIR/system.lock"
RECOVERY_LOG="$LOG_DIR/restart-recovery.log"
PID_FILE="$LOCK_DIR/server.pid"
PIDFILE_DATABASE="$LOCK_DIR/database.pid"
STARTUP_TIMEOUT=60
HEALTH_CHECK_RETRIES=5

configure_runtime_paths() {
  if [ "${EUID:-0}" -ne 0 ]; then
    local runtime_root="${TMPDIR:-/tmp}/smt-verification"
    if ! mkdir -p "$runtime_root/logs" "$runtime_root/run" 2>/dev/null; then
      runtime_root="$PROJECT_ROOT/.runtime/smt-verification"
      mkdir -p "$runtime_root/logs" "$runtime_root/run" 2>/dev/null || true
    fi
    LOG_DIR="$runtime_root/logs"
    LOCK_DIR="$runtime_root/run"
    LOCK_FILE="$LOCK_DIR/system.lock"
    RECOVERY_LOG="$LOG_DIR/restart-recovery.log"
    PID_FILE="$LOCK_DIR/server.pid"
    PIDFILE_DATABASE="$LOCK_DIR/database.pid"
    STATUS_FILE="$runtime_root/status.json"
  else
    # Root user: use standard system directories
    LOG_DIR="/var/log/smt-verification"
    LOCK_DIR="/var/run/smt-verification"
    LOCK_FILE="$LOCK_DIR/system.lock"
    RECOVERY_LOG="$LOG_DIR/restart-recovery.log"
    PID_FILE="$LOCK_DIR/server.pid"
    PIDFILE_DATABASE="$LOCK_DIR/database.pid"
    STATUS_FILE="/var/run/smt-verification/status.json"
  fi
}

load_project_env() {
  if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$PROJECT_ROOT/.env"
    set +a
  fi
}

configure_runtime_paths
load_project_env

# Service ports (frontend defaults to 5173)
API_PORT="${API_PORT:-${PORT:-3000}}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

################################################################################
# LOGGING FUNCTIONS
################################################################################

log() {
  local level=$1
  shift
  local message="$@"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  mkdir -p "$LOG_DIR" "$LOCK_DIR" 2>/dev/null || true
  if ! echo "[$timestamp] [$level] $message" | tee -a "$RECOVERY_LOG" >/dev/null; then
    echo "[$timestamp] [$level] $message"
  fi
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $@"
  log "INFO" "$@"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $@"
  log "SUCCESS" "$@"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $@"
  log "WARNING" "$@"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $@"
  log "ERROR" "$@"
}

################################################################################
# SETUP FUNCTIONS
################################################################################

setup_directories() {
  log_info "Setting up required directories..."
  mkdir -p "$LOG_DIR"
  mkdir -p "$LOCK_DIR"
  mkdir -p "$(dirname "$STATUS_FILE")"
  chmod 755 "$LOG_DIR"
  chmod 755 "$LOCK_DIR"
  log_success "Directories ready"
}

check_prerequisites() {
  log_info "Checking prerequisites..."
  
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    return 1
  fi
  log_info "✓ Node.js found: $(node --version)"
  
  if ! command -v npm &> /dev/null && ! command -v pnpm &> /dev/null; then
    log_error "npm or pnpm is not installed"
    return 1
  fi
  log_info "✓ Package manager found"
  
  if ! command -v psql &> /dev/null; then
    log_warning "PostgreSQL client not found - database checks will be limited"
  else
    log_info "✓ PostgreSQL client found"
  fi
  
  return 0
}

################################################################################
# LOCK MANAGEMENT FUNCTIONS
################################################################################

handle_stale_lock() {
  log_info "Checking for stale locks..."
  
  if [ -f "$LOCK_FILE" ]; then
    local lock_age=$(($(date +%s) - $(stat -f%m "$LOCK_FILE" 2>/dev/null || stat -c%Y "$LOCK_FILE" 2>/dev/null)))
    
    if [ $lock_age -gt 3600 ]; then
      # Lock is older than 1 hour - it's stale
      log_warning "Stale lock detected (age: ${lock_age}s)"
      log_info "Removing stale lock file..."
      rm -f "$LOCK_FILE"
      log_success "Stale lock removed"
      return 0
    fi
    
    # Check if process is still running
    if [ -f "$PID_FILE" ]; then
      local pid=$(cat "$PID_FILE")
      if ! kill -0 "$pid" 2>/dev/null; then
        log_warning "Lock process ($pid) not running"
        log_info "Removing orphaned lock..."
        rm -f "$LOCK_FILE"
        rm -f "$PID_FILE"
        log_success "Orphaned lock removed"
        return 0
      fi
    fi
    
    log_warning "Active lock exists - proceeding with caution"
    return 1
  fi
  
  log_success "No stale locks found"
  return 0
}

force_unlock() {
  log_warning "FORCE UNLOCKING SYSTEM..."
  
  if [ -f "$PID_FILE" ]; then
    local pid=$(cat "$PID_FILE")
    log_info "Attempting to terminate process $pid..."
    kill -9 "$pid" 2>/dev/null || true
  fi
  
  # Kill any node processes on the ports
  log_info "Killing any processes on API/app ports..."
  lsof -ti:"$API_PORT" | xargs kill -9 2>/dev/null || true
  lsof -ti:"$FRONTEND_PORT" | xargs kill -9 2>/dev/null || true
  
  # Remove lock files
  rm -f "$LOCK_FILE"
  rm -f "$PID_FILE"
  
  log_success "System force-unlocked"
}

acquire_lock() {
  log_info "Acquiring system lock..."
  
  # Try graceful unlock first
  if ! handle_stale_lock; then
    log_warning "Could not acquire lock gracefully"
    if [ -n "${SYSTEMD_SERVICE:-}" ] || [ ! -t 0 ]; then
      if [ "${FORCE_UNLOCK_ON_LOCK:-0}" = "1" ]; then
        log_warning "Non-interactive mode with force unlock enabled"
        force_unlock
      else
        log_error "Cannot prompt for lock override in non-interactive mode"
        return 1
      fi
    else
      read -p "Force unlock? (y/n) " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        force_unlock
      else
        log_error "Cannot proceed without lock"
        return 1
      fi
    fi
  fi
  
  # Create lock file
  echo "$$" > "$LOCK_FILE"
  log_success "System lock acquired"
  return 0
}

release_lock() {
  log_info "Releasing system lock..."
  rm -f "$LOCK_FILE"
  rm -f "$PID_FILE"
  log_success "System lock released"
}

################################################################################
# PROCESS MANAGEMENT FUNCTIONS
################################################################################

is_port_in_use() {
  local port=$1
  if command -v lsof &> /dev/null; then
    lsof -i ":$port" &>/dev/null
    return $?
  else
    netstat -tuln | grep -q ":$port " && return 0 || return 1
  fi
}

wait_for_port_free() {
  local port=$1
  local timeout=$2
  local elapsed=0
  
  log_info "Waiting for port $port to become free (timeout: ${timeout}s)..."
  
  while [ $elapsed -lt $timeout ]; do
    if ! is_port_in_use "$port"; then
      log_success "Port $port is now free"
      return 0
    fi
    
    if [ $((elapsed % 5)) -eq 0 ] && [ $elapsed -gt 0 ]; then
      log_info "Port $port still in use, force-killing lingering processes..."
      local pids
      pids=$(lsof -ti:"$port" 2>/dev/null)
      if [ -n "$pids" ]; then
        printf '%s\n' "$pids" | while IFS= read -r pid; do
          kill -9 "$pid" 2>/dev/null || true
        done
      fi
    fi
    
    sleep 1
    elapsed=$((elapsed + 1))
  done
  
  log_warning "Timeout waiting for port $port to become free, force-killing remaining processes"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | while IFS= read -r pid; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
  sleep 2
  return 1
}

stop_server() {
  log_info "Stopping API server..."
  
  if [ -f "$PID_FILE" ]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log_info "Sending SIGTERM to process $pid..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      
      # Force kill if still running
      if kill -0 "$pid" 2>/dev/null; then
        log_warning "Process still running, sending SIGKILL..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
    fi
    rm -f "$PID_FILE"
  fi
  
  # Clean up any lingering node processes with dist/index.mjs pattern
  pkill -9 -f "node.*dist/index.mjs" 2>/dev/null || true
  # Also clean up generic node api-server processes
  pkill -9 -f "node.*api-server" 2>/dev/null || true
  
  # Force-kill any remaining processes on API port
  if command -v lsof &>/dev/null; then
    lsof -ti:"$API_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
  
  log_success "Server stopped"
  sleep 2
}

################################################################################
# DATABASE FUNCTIONS
################################################################################

parse_database_url() {
  local db_url="$1"
  # Parse with Python so special characters and URL encoding are handled safely.
  # This keeps the shell logic simple while preserving ':' and '@' in passwords.
  if command -v python3 &> /dev/null; then
    local parsed
    parsed=$(python3 - "$db_url" <<'PY'
import sys
from urllib.parse import urlparse, unquote

url = sys.argv[1]
parsed = urlparse(url)

if parsed.scheme != "postgresql":
    raise SystemExit(1)

user = unquote(parsed.username or "postgres")
password = unquote(parsed.password or "")
host = parsed.hostname or "localhost"
port = str(parsed.port or 5432)
name = unquote((parsed.path or "/").lstrip("/").split("?", 1)[0]) or "smt_verification"

print(user)
print(password)
print(host)
print(port)
print(name)
PY
    ) || true

    if [ -n "$parsed" ]; then
      DB_USER=$(printf '%s' "$parsed" | sed -n '1p')
      DB_PASSWORD=$(printf '%s' "$parsed" | sed -n '2p')
      DB_HOST=$(printf '%s' "$parsed" | sed -n '3p')
      DB_PORT=$(printf '%s' "$parsed" | sed -n '4p')
      DB_NAME=$(printf '%s' "$parsed" | sed -n '5p')
      return 0
    fi
  fi

  # Fallback to safe defaults if parsing is unavailable or fails.
  DB_USER="postgres"
  DB_PASSWORD=""
  DB_HOST="localhost"
  DB_PORT="5432"
  DB_NAME="smt_verification"
}

check_database_connection() {
  log_info "Checking database connection..."
  
  if ! command -v psql &> /dev/null; then
    log_warning "PostgreSQL client not available - skipping connection check"
    return 0
  fi

  local db_url="${DATABASE_URL:-}"
  
  # Initialize defaults before parsing
  local db_host="localhost"
  local db_user="postgres"
  local db_name="smt_verification"
  local db_port="5432"
  local db_password=""

  # Parse DATABASE_URL if provided, which will update the globals
  if [ -n "$db_url" ]; then
    parse_database_url "$db_url"
    # Reassign local variables from parsed globals
    db_host="$DB_HOST"
    db_user="$DB_USER"
    db_name="$DB_NAME"
    db_port="$DB_PORT"
    db_password="$DB_PASSWORD"
  fi

  local psql_error
  if psql_error=$(PGPASSWORD="$db_password" psql -w -h "$db_host" -U "$db_user" -d "$db_name" -p "$db_port" -c "SELECT 1" 2>&1); then
    log_success "Database connection successful"
    return 0
  else
    log_error "Cannot connect to database: $psql_error"
    return 1
  fi
}

wait_for_database() {
  local timeout=$1
  local elapsed=0
  
  log_info "Waiting for database to be ready (timeout: ${timeout}s)..."
  
  while [ $elapsed -lt $timeout ]; do
    if check_database_connection; then
      return 0
    fi
    log_info "Waiting... (${elapsed}/${timeout}s)"
    sleep 2
    elapsed=$((elapsed + 2))
  done
  
  log_error "Database did not become available in time"
  return 1
}

################################################################################
# HEALTH CHECK FUNCTIONS
################################################################################

check_api_health() {
  local port=${1:-$API_PORT}
  local endpoint="${2:-/api/health}"
  local retry=0
  
  log_info "Checking API health at localhost:$port$endpoint..."
  
  while [ $retry -lt $HEALTH_CHECK_RETRIES ]; do
    if curl -sf "http://localhost:$port$endpoint" &>/dev/null; then
      log_success "API is healthy"
      return 0
    fi
    retry=$((retry + 1))
    if [ $retry -lt $HEALTH_CHECK_RETRIES ]; then
      log_info "Health check failed, retrying... ($retry/$HEALTH_CHECK_RETRIES)"
      sleep 2
    fi
  done
  
  log_error "API health check failed after $HEALTH_CHECK_RETRIES attempts"
  return 1
}

check_app_health() {
  local port=${1:-$FRONTEND_PORT}
  local retry=0
  
  log_info "Checking app at localhost:$port..."
  
  while [ $retry -lt $HEALTH_CHECK_RETRIES ]; do
    if curl -sf "http://localhost:$port" &>/dev/null; then
      log_success "App is responding"
      return 0
    fi
    retry=$((retry + 1))
    if [ $retry -lt $HEALTH_CHECK_RETRIES ]; then
      log_info "App check failed, retrying... ($retry/$HEALTH_CHECK_RETRIES)"
      sleep 2
    fi
  done
  
  log_error "App health check failed after $HEALTH_CHECK_RETRIES attempts"
  return 1
}

################################################################################
# SERVICE STARTUP FUNCTIONS
################################################################################

start_api_server() {
  log_info "Starting API server..."
  
  if ! wait_for_database 30; then
    log_error "Database not ready - cannot start API"
    return 1
  fi
  
  cd "$PROJECT_ROOT/artifacts/api-server"
  
  # Check if dependencies are installed
  if [ ! -d "node_modules" ]; then
    log_info "Installing API dependencies..."
    pnpm install
  fi

  log_info "Building API server production assets..."
  if ! pnpm run build >> "$LOG_DIR/api-server.log" 2>&1; then
    log_error "API build failed"
    return 1
  fi
  
  # Start the server in background with environment variables from .env
  log_info "Launching API server process..."
  (
    export DATABASE_URL="${DATABASE_URL:-postgresql://smtverify:smtverify@localhost:5432/smtverify}"
    export PORT="$API_PORT"
    export NODE_ENV=production
    if [ -z "${JWT_SECRET:-}" ]; then
      log_error "JWT_SECRET must be set in .env before starting the API server"
      return 1
    fi
    export JWT_SECRET
    export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173}"
    nohup node --enable-source-maps ./dist/index.mjs >> "$LOG_DIR/api-server.log" 2>&1 &
  )
  local candidate_pid=$!
  sleep 2
  local server_pid
  if command -v lsof &>/dev/null; then
    server_pid=$(lsof -ti:"$API_PORT" 2>/dev/null | head -n 1 || true)
  fi
  if [ -z "$server_pid" ]; then
    server_pid=$(pgrep -f "node --enable-source-maps ./dist/index.mjs" | head -n 1 || true)
  fi
  if [ -z "$server_pid" ]; then
    server_pid="$candidate_pid"
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    log_error "API server did not stay running after launch"
    log_info "API server error log:"
    tail -20 "$LOG_DIR/api-server.log"
    return 1
  fi
  echo "$server_pid" > "$PID_FILE"
  
  log_info "API server started with PID $server_pid"
  
  # Wait for server to be ready
  sleep 3
  
  if check_api_health "$API_PORT"; then
    log_success "API server is operational"
    return 0
  else
    log_error "API server started but health check failed"
    log_info "API server error log:"
    tail -20 "$LOG_DIR/api-server.log"
    return 1
  fi
}

start_app_server() {
  log_info "Starting frontend app..."
  
  cd "$PROJECT_ROOT/artifacts/feeder-scanner"
  
  # Check if dependencies are installed
  if [ ! -d "node_modules" ]; then
    log_info "Installing app dependencies..."
    pnpm install
  fi

  log_info "Building frontend production assets..."
  if ! PORT="$FRONTEND_PORT" BASE_PATH=/ pnpm run build >> "$LOG_DIR/app-server.log" 2>&1; then
    log_error "Frontend build failed"
    return 1
  fi

  log_info "Launching frontend dev server..."
  PORT="$FRONTEND_PORT" BASE_PATH=/ nohup pnpm run dev >> "$LOG_DIR/app-server.log" 2>&1 &
  local app_pid=$!
  sleep 2
  if ! kill -0 "$app_pid" 2>/dev/null; then
    log_error "Frontend process did not stay running after launch"
    return 1
  fi
  
  log_info "Frontend app started with PID $app_pid"
  
  # Wait for app to be ready
  sleep 5
  
  if check_app_health "$FRONTEND_PORT"; then
    log_success "Frontend app is operational"
    return 0
  else
    log_error "Frontend app started but health check failed"
    return 1
  fi
}

################################################################################
# STATUS FUNCTIONS
################################################################################

write_status_file() {
  local status=$1
  local message=$2
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  
  cat > "$STATUS_FILE" <<EOF
{
  "status": "$status",
  "message": "$message",
  "timestamp": "$timestamp",
  "api_port": $API_PORT,
  "app_port": $FRONTEND_PORT,
  "log_file": "$RECOVERY_LOG"
}
EOF
}

show_status() {
  log_info "=========================================="
  log_info "System Status"
  log_info "=========================================="
  
  if [ -f "$PID_FILE" ]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log_success "API Server: RUNNING (PID: $pid)"
    else
      local live_pid=""
      if command -v lsof &>/dev/null; then
        live_pid=$(lsof -ti:"$API_PORT" 2>/dev/null | head -n 1 || true)
      fi
      if [ -n "$live_pid" ] && kill -0 "$live_pid" 2>/dev/null; then
        echo "$live_pid" > "$PID_FILE"
        log_success "API Server: RUNNING (PID: $live_pid)"
      else
        log_error "API Server: NOT RUNNING (Stale PID: $pid)"
      fi
    fi
  else
    log_error "API Server: NOT RUNNING"
  fi
  
  if check_api_health "$API_PORT" &>/dev/null; then
    log_success "API Health: HEALTHY"
  else
    log_warning "API Health: UNHEALTHY"
  fi
  
  if check_app_health "$FRONTEND_PORT" &>/dev/null; then
    log_success "Frontend: HEALTHY"
  else
    log_warning "Frontend: UNHEALTHY"
  fi
  
  if check_database_connection &>/dev/null; then
    log_success "Database: CONNECTED"
  else
    log_warning "Database: NOT CONNECTED"
  fi
  
  log_info "=========================================="
}

################################################################################
# RECOVERY LOGIC
################################################################################

perform_full_recovery() {
  log_info "=========================================="
  log_info "Starting Full System Recovery"
  log_info "=========================================="
  
  setup_directories
  check_prerequisites || exit 1
  
  if ! acquire_lock; then
    log_error "Failed to acquire system lock"
    write_status_file "ERROR" "Failed to acquire lock"
    exit 1
  fi
  
  trap "release_lock" EXIT
  
  # Stop any running services
  stop_server
  
  # Wait for ports to be free
  wait_for_port_free "$API_PORT" 30 || true
  wait_for_port_free "$FRONTEND_PORT" 30 || true
  
  # Start services
  if ! start_api_server; then
    log_error "Failed to start API server"
    write_status_file "ERROR" "API server failed to start"
    exit 1
  fi
  
  if ! start_app_server; then
    log_warning "Frontend app failed to start, but API is running"
  fi
  
  # Show final status
  sleep 2
  show_status
  
  write_status_file "SUCCESS" "System recovered and operational"
  log_success "=========================================="
  log_success "System Recovery Complete!"
  log_success "=========================================="
  
  return 0
}

start_system() {
  log_info "=========================================="
  log_info "Starting System"
  log_info "=========================================="

  setup_directories
  check_prerequisites || exit 1

  if ! acquire_lock; then
    log_error "Failed to acquire system lock"
    write_status_file "ERROR" "Failed to acquire lock"
    exit 1
  fi

  trap "release_lock" EXIT

  stop_server

  wait_for_port_free "$API_PORT" 30 || true
  wait_for_port_free "$FRONTEND_PORT" 30 || true

  if ! start_api_server; then
    log_error "Failed to start API server"
    write_status_file "ERROR" "API server failed to start"
    exit 1
  fi

  if ! start_app_server; then
    log_warning "Frontend app failed to start, but API is running"
  fi

  sleep 2
  show_status

  write_status_file "SUCCESS" "System started and operational"
  log_success "=========================================="
  log_success "System Start Complete!"
  log_success "=========================================="

  return 0
}

################################################################################
# MAIN COMMAND HANDLER
################################################################################

show_usage() {
  cat <<EOF
Usage: $0 [COMMAND]

Commands:
  start              Start the system (acquire lock, start services)
  stop               Stop the system (release lock, stop services)
  restart            Restart the system (stop then start)
  recover            Perform full recovery (force unlock + restart)
  status             Show current system status
  check-lock         Check lock status
  force-unlock       Force unlock the system (DANGEROUS)
  clean-logs         Clear recovery logs
  help               Show this help message

Examples:
  $0 start                # Start the system
  $0 recover              # Full recovery after power cut
  $0 status               # Check system status
  $0 force-unlock         # Force unlock if stuck

Environment Variables:
  DB_HOST             PostgreSQL host (default: localhost)
  DB_USER             PostgreSQL user (default: postgres)
  DB_NAME             Database name (default: smt_verification)
  DB_PORT             PostgreSQL port (default: 5432)
EOF
}

main() {
  case "${1:-start}" in
    start)
      start_system
      ;;
    stop)
      log_info "Stopping system..."
      stop_server
      release_lock
      log_success "System stopped"
      ;;
    restart)
      stop_server
      release_lock
      sleep 2
      start_system
      ;;
    recover)
      log_info "Performing full recovery..."
      perform_full_recovery
      ;;
    status)
      show_status
      ;;
    check-lock)
      handle_stale_lock
      [ -f "$LOCK_FILE" ] && echo "Lock file exists" || echo "No lock file"
      ;;
    force-unlock)
      force_unlock
      ;;
    clean-logs)
      log_info "Clearing logs..."
      rm -f "$RECOVERY_LOG"
      rm -f "$LOG_DIR"/*.log
      log_success "Logs cleared"
      ;;
    help|--help|-h)
      show_usage
      ;;
    *)
      log_error "Unknown command: $1"
      show_usage
      exit 1
      ;;
  esac
}

# Run main function with all arguments
main "$@"
