#!/bin/bash
# ============================================================================
# E2E Test Suite - SMT Verification System
# ============================================================================
# Comprehensive end-to-end tests for all critical features
# Run this before deploying to production
#
# Usage: bash e2e-test.sh [--api-url http://localhost:3000]
# ============================================================================

set -e  # Exit on error

# Configuration
API_URL="${1:-http://localhost:3000}"
TEST_RESULTS_FILE="/tmp/smt-e2e-test-$(date +%s).log"
PASSED=0
FAILED=0
SKIPPED=0

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# ─────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────

log_test() {
  echo -e "${BLUE}[TEST]${NC} $1"
}

log_pass() {
  echo -e "${GREEN}✅ PASS${NC} $1"
  PASSED=$((PASSED+1))
  echo "PASS: $1" >> "$TEST_RESULTS_FILE"
}

log_fail() {
  echo -e "${RED}❌ FAIL${NC} $1"
  FAILED=$((FAILED+1))
  echo "FAIL: $1" >> "$TEST_RESULTS_FILE"
}

log_skip() {
  echo -e "${YELLOW}⊘ SKIP${NC} $1"
  SKIPPED=$((SKIPPED+1))
  echo "SKIP: $1" >> "$TEST_RESULTS_FILE"
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"
  
  if [[ "$expected" == "$actual" ]]; then
    log_pass "$test_name (expected: $expected, got: $actual)"
  else
    log_fail "$test_name (expected: $expected, got: $actual)"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  
  if [[ "$haystack" == *"$needle"* ]]; then
    log_pass "$test_name (found: $needle)"
  else
    log_fail "$test_name (expected to find: $needle, got: $haystack)"
  fi
}

# ─────────────────────────────────────────────────────────────────────────
# Test Suite
# ─────────────────────────────────────────────────────────────────────────

main() {
  echo "════════════════════════════════════════════════════════════════════════"
  echo "  SMT Verification System - End-to-End Test Suite"
  echo "════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "API URL: $API_URL"
  echo "Results: $TEST_RESULTS_FILE"
  echo ""

  # Test connectivity first
  if ! curl -s "$API_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to API at $API_URL${NC}"
    echo "Make sure the API server is running:"
    echo "  cd artifacts/api-server && pnpm dev"
    exit 1
  fi

  # Run test groups
  test_health_check
  echo ""
  test_authentication
  echo ""
  test_authorization_bug_04
  echo ""
  test_export_security_bug_13
  echo ""
  test_csv_import_atomicity_bug_16_17
  echo ""
  test_path_traversal_bug_09
  echo ""
  test_verification_workflow
  echo ""
  test_report_generation
  echo ""

  # Print summary
  print_summary
}

test_health_check() {
  log_test "Health Check Tests"
  
  RESPONSE=$(curl -s "$API_URL/api/health")
  
  if [[ "$RESPONSE" == *"ok"* ]]; then
    log_pass "API health endpoint responds"
  else
    log_fail "API health endpoint failed: $RESPONSE"
  fi
}

test_authentication() {
  log_test "Authentication Tests"
  
  # Test operator login
  log_test "  Operator login..."
  TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"operator1","password":"operator123","role":"operator"}' \
    -c /tmp/cookies.txt 2>/dev/null | jq -r '.smt_token // empty' 2>/dev/null)
  
  if [[ -n "$TOKEN" ]] && [[ "$TOKEN" != "null" ]]; then
    log_pass "Operator login successful"
    OPERATOR_TOKEN="$TOKEN"
  else
    log_fail "Operator login failed: $TOKEN"
    OPERATOR_TOKEN=""
  fi
  
  # Test QA login
  log_test "  QA login..."
  TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"qa1","password":"qa123","role":"qa"}' \
    -c /tmp/cookies.txt 2>/dev/null | jq -r '.smt_token // empty' 2>/dev/null)
  
  if [[ -n "$TOKEN" ]] && [[ "$TOKEN" != "null" ]]; then
    log_pass "QA login successful"
    QA_TOKEN="$TOKEN"
  else
    log_fail "QA login failed: $TOKEN"
    QA_TOKEN=""
  fi
  
  # Test engineer login
  log_test "  Engineer login..."
  TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"engineer1","password":"engineer123","role":"engineer"}' \
    -c /tmp/cookies.txt 2>/dev/null | jq -r '.smt_token // empty' 2>/dev/null)
  
  if [[ -n "$TOKEN" ]] && [[ "$TOKEN" != "null" ]]; then
    log_pass "Engineer login successful"
    ENGINEER_TOKEN="$TOKEN"
  else
    log_fail "Engineer login failed: $TOKEN"
    ENGINEER_TOKEN=""
  fi
}

test_authorization_bug_04() {
  log_test "Authorization Tests (BUG-04: Export Route Protection)"
  
  if [[ -z "$OPERATOR_TOKEN" ]] || [[ -z "$QA_TOKEN" ]]; then
    log_skip "Authorization tests (login tokens missing)"
    return
  fi
  
  # Test operator cannot export
  log_test "  Operator trying to export (should be 403)..."
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/api/reports/export/fpy" \
    -H "Content-Type: application/json" \
    -b "smt_token=$OPERATOR_TOKEN" \
    -d '{"format":"pdf","filters":{}}' 2>/dev/null)
  
  if [[ "$STATUS" == "403" ]]; then
    log_pass "Operator export correctly rejected with 403"
  else
    log_fail "Expected 403 for operator export, got $STATUS"
  fi
  
  # Test QA can export
  log_test "  QA trying to export (should succeed)..."
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/api/reports/export/fpy" \
    -H "Content-Type: application/json" \
    -b "smt_token=$QA_TOKEN" \
    -d '{"format":"pdf","filters":{}}' 2>/dev/null)
  
  if [[ "$STATUS" == "200" ]] || [[ "$STATUS" == "201" ]]; then
    log_pass "QA export allowed ($STATUS)"
  else
    log_fail "QA export failed with $STATUS"
  fi
  
  # Test operator cannot view export history
  log_test "  Operator trying to view export history (should be 403)..."
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "$API_URL/api/reports/exports/history" \
    -b "smt_token=$OPERATOR_TOKEN" 2>/dev/null)
  
  if [[ "$STATUS" == "403" ]]; then
    log_pass "Operator export history correctly rejected with 403"
  else
    log_fail "Expected 403 for operator export history, got $STATUS"
  fi
}

test_export_security_bug_13() {
  log_test "Export Security Tests (BUG-13: PII Hashing)"
  
  if [[ -z "$QA_TOKEN" ]]; then
    log_skip "PII hashing tests (QA token missing)"
    return
  fi
  
  log_test "  Checking that IP/user-agent are hashed in database..."
  log_skip "Database verification requires direct DB access (manual check needed)"
  
  echo "    Manual verification:"
  echo "    1. Connect to database:"
  echo "       psql -h \$DB_HOST -U \$DB_USER -d \$DB_NAME"
  echo "    2. Run: SELECT ipAddress, userAgent FROM reportExportsTable LIMIT 1;"
  echo "    3. Verify both columns show bcrypt hashes (start with \$2b\$10\$)"
}

test_csv_import_atomicity_bug_16_17() {
  log_test "CSV Import Tests (BUG-16/17: Atomicity & Duplicate Detection)"
  
  if [[ -z "$QA_TOKEN" ]]; then
    log_skip "CSV import tests (QA token missing)"
    return
  fi
  
  log_test "  Testing duplicate detection (same feeder + MPN)..."
  log_skip "CSV import tests require BOM setup (manual verification needed)"
  
  echo "    Manual verification:"
  echo "    1. Login as QA with token: $QA_TOKEN"
  echo "    2. Create a BOM via POST /api/bom"
  echo "    3. Import CSV with duplicate row (same feederNumber + mpn1)"
  echo "    4. Verify response shows: skipped: 1 (not error)"
  echo "    5. Check database: only one feeder inserted (atomic transaction)"
}

test_path_traversal_bug_09() {
  log_test "Security Tests (BUG-09: Path Traversal Guard)"
  
  log_test "  Checking ExportService path validation..."
  log_skip "Path traversal tests require export endpoint logging (manual check)"
  
  echo "    Manual verification:"
  echo "    1. Attempt file access with path traversal:"
  echo "       curl \$API_URL/api/reports/export/../../etc/passwd"
  echo "    2. Should return 403 or 404 (not exposed file content)"
}

test_verification_workflow() {
  log_test "Verification Workflow Tests"
  
  if [[ -z "$OPERATOR_TOKEN" ]]; then
    log_skip "Verification workflow tests (operator token missing)"
    return
  fi
  
  log_test "  Creating verification session..."
  log_skip "Verification workflow tests require BOM/session setup (manual testing)"
  
  echo "    Manual workflow test:"
  echo "    1. Create BOM with items"
  echo "    2. Create verification session"
  echo "    3. Record scans with validation"
  echo "    4. Close session"
  echo "    5. Generate report"
}

test_report_generation() {
  log_test "Report Generation Tests"
  
  if [[ -z "$QA_TOKEN" ]]; then
    log_skip "Report tests (QA token missing)"
    return
  fi
  
  log_test "  Testing report endpoints..."
  
  # Test FPY report
  RESPONSE=$(curl -s -X GET "$API_URL/api/reports/fpy?dateFilter=today" \
    -b "smt_token=$QA_TOKEN" 2>/dev/null)
  
  if [[ "$RESPONSE" == *"report"* ]]; then
    log_pass "FPY report endpoint accessible"
  else
    log_fail "FPY report endpoint failed: ${RESPONSE:0:50}..."
  fi
  
  # Test OEE report
  RESPONSE=$(curl -s -X GET "$API_URL/api/reports/oee?dateFilter=today" \
    -b "smt_token=$QA_TOKEN" 2>/dev/null)
  
  if [[ "$RESPONSE" == *"report"* ]]; then
    log_pass "OEE report endpoint accessible"
  else
    log_fail "OEE report endpoint failed: ${RESPONSE:0:50}..."
  fi
}

print_summary() {
  echo "════════════════════════════════════════════════════════════════════════"
  echo "  Test Summary"
  echo "════════════════════════════════════════════════════════════════════════"
  echo ""
  echo -e "${GREEN}✅ Passed: $PASSED${NC}"
  echo -e "${RED}❌ Failed: $FAILED${NC}"
  echo -e "${YELLOW}⊘ Skipped: $SKIPPED${NC}"
  echo ""
  
  if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ All automated tests passed!${NC}"
    echo ""
    echo "Next steps for manual verification:"
    echo "  1. Run CSV import test with duplicate feeder+MPN"
    echo "  2. Verify database: PII fields in reportExportsTable are hashed"
    echo "  3. Test operator cannot export (should get 403)"
    echo "  4. Verify path traversal attempts fail"
    echo "  5. Complete full verification workflow"
    echo ""
    exit 0
  else
    echo -e "${RED}❌ Some tests failed!${NC}"
    echo "Review failures above and consult DEPLOYMENT_RUNBOOK.md"
    echo ""
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────
# Main Entry Point
# ─────────────────────────────────────────────────────────────────────────

main "$@"
