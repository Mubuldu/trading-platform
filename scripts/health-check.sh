#!/usr/bin/env bash
# =============================================================================
# health-check.sh — Poll the health endpoint until it responds OK or times out
#
# Usage:
#   ./scripts/health-check.sh <url> [timeout_seconds] [label]
#
# Arguments:
#   url              Health endpoint URL (e.g. http://localhost:3000/api/v1/health)
#   timeout_seconds  Maximum seconds to wait (default: 90)
#   label            Human-readable label for log output (default: app)
#
# Exit codes:
#   0 — health endpoint returned HTTP 200 with {"status":"ok"} within timeout
#   1 — timed out or endpoint returned unhealthy status
#
# Used by:
#   • deploy.sh
#   • rollback.sh
#   • GitHub Actions CD workflows (via SSH remote execution)
# =============================================================================

set -euo pipefail

URL="${1:-http://localhost:3000/api/v1/health}"
TIMEOUT="${2:-90}"
LABEL="${3:-app}"

INTERVAL=5       # seconds between polls
ELAPSED=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[HEALTH]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[HEALTH]${NC} $*"; }
log_error() { echo -e "${RED}[HEALTH]${NC} $*" >&2; }

log_info "Waiting for ${LABEL} to be healthy (URL: ${URL}, timeout: ${TIMEOUT}s)"

while true; do
  # Attempt to fetch the health endpoint
  HTTP_STATUS=$(curl -s -o /tmp/health_response.json -w "%{http_code}" \
    --connect-timeout 5 \
    --max-time 10 \
    "${URL}" 2>/dev/null || echo "000")

  if [ "${HTTP_STATUS}" = "200" ]; then
    # Verify the response body contains {"status":"ok"}
    if grep -q '"status".*"ok"' /tmp/health_response.json 2>/dev/null; then
      echo ""
      log_info "✓ ${LABEL} is healthy (${ELAPSED}s)"
      rm -f /tmp/health_response.json
      exit 0
    else
      BODY=$(cat /tmp/health_response.json 2>/dev/null || echo "(empty)")
      log_warn "HTTP 200 but status is not 'ok': ${BODY}"
    fi
  else
    log_warn "HTTP ${HTTP_STATUS} — waiting... (${ELAPSED}/${TIMEOUT}s)"
  fi

  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    echo ""
    log_error "✗ ${LABEL} did not become healthy within ${TIMEOUT}s"
    log_error "Last HTTP status: ${HTTP_STATUS}"
    if [ -f /tmp/health_response.json ]; then
      log_error "Last response: $(cat /tmp/health_response.json)"
    fi
    rm -f /tmp/health_response.json
    exit 1
  fi

  sleep "${INTERVAL}"
  ELAPSED=$((ELAPSED + INTERVAL))
  printf "."
done
