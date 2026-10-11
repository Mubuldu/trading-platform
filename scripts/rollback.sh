#!/usr/bin/env bash
# =============================================================================
# rollback.sh — Roll back to the previous stable image version
#
# Usage:
#   ./scripts/rollback.sh <environment> [image_tag]
#
# Arguments:
#   environment   staging | production
#   image_tag     (optional) specific tag to roll back to.
#                 If omitted, reads .previous_image_tag written by deploy.sh.
#
# Examples:
#   ./scripts/rollback.sh production           # uses .previous_image_tag
#   ./scripts/rollback.sh production v1.2.0    # rolls back to explicit tag
#   ./scripts/rollback.sh staging sha-a1b2c3d
#
# Exit codes:
#   0  — rollback succeeded and health check passed
#   1  — rollback failed (manual intervention required)
# =============================================================================

set -euo pipefail

# ── Arguments ─────────────────────────────────────────────────────────────────
ENVIRONMENT="${1:-}"
EXPLICIT_TAG="${2:-}"

if [ -z "${ENVIRONMENT}" ]; then
  echo "Usage: $0 <environment> [image_tag]"
  echo "       environment: staging | production"
  exit 1
fi

# ── Config ────────────────────────────────────────────────────────────────────
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_NAME="${IMAGE_NAME:-$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo trading-platform)")}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"
ENV_FILE=".env.${ENVIRONMENT}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
PREV_TAG_FILE=".previous_image_tag"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${ENVIRONMENT}" in
  staging)    COMPOSE_FILE="docker-compose.staging.yml" ;;
  production) COMPOSE_FILE="docker-compose.prod.yml" ;;
  *)
    echo "ERROR: Rollback only supports staging | production"
    exit 1
    ;;
esac

# ── Logging ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Resolve rollback target ───────────────────────────────────────────────────
if [ -n "${EXPLICIT_TAG}" ]; then
  ROLLBACK_TAG="${EXPLICIT_TAG}"
  log_info "Rolling back to explicit tag: ${ROLLBACK_TAG}"
elif [ -f "${PREV_TAG_FILE}" ]; then
  ROLLBACK_TAG="$(cat "${PREV_TAG_FILE}")"
  if [ -z "${ROLLBACK_TAG}" ] || [ "${ROLLBACK_TAG}" = "none" ]; then
    log_error "No previous tag recorded in ${PREV_TAG_FILE}"
    log_error "Provide an explicit tag: $0 ${ENVIRONMENT} <tag>"
    exit 1
  fi
  log_info "Rolling back to recorded previous tag: ${ROLLBACK_TAG}"
else
  log_error "No ${PREV_TAG_FILE} found and no explicit tag given"
  log_error "Provide an explicit tag: $0 ${ENVIRONMENT} <tag>"
  exit 1
fi

# ── Precondition checks ────────────────────────────────────────────────────────
if [ ! -f "${ENV_FILE}" ]; then
  log_error "Environment file not found: ${ENV_FILE}"
  exit 1
fi

log_info "=== Trading Platform Rollback ==="
log_info "Environment   : ${ENVIRONMENT}"
log_info "Rollback to   : ${ROLLBACK_TAG}"
log_info "Compose file  : ${COMPOSE_FILE}"
echo ""

# ── Confirm (interactive mode only) ───────────────────────────────────────────
if [ -t 0 ]; then
  echo -e "${YELLOW}WARNING: This will replace the running version with '${ROLLBACK_TAG}'.${NC}"
  read -r -p "Continue? [y/N] " confirm
  case "${confirm}" in
    [yY][eE][sS]|[yY]) ;;
    *)
      log_info "Rollback cancelled"
      exit 0
      ;;
  esac
fi

# ── Pull rollback image ───────────────────────────────────────────────────────
log_info "[1/3] Pulling rollback image: ${FULL_IMAGE}:${ROLLBACK_TAG}"
if ! docker pull "${FULL_IMAGE}:${ROLLBACK_TAG}"; then
  log_error "Failed to pull ${FULL_IMAGE}:${ROLLBACK_TAG}"
  log_error "The image may no longer exist in the registry"
  exit 1
fi

# ── Start services with rollback image ────────────────────────────────────────
log_info "[2/3] Starting services with rollback image"
IMAGE_TAG="${ROLLBACK_TAG}" \
  docker compose \
    -f "${COMPOSE_FILE}" \
    --env-file "${ENV_FILE}" \
    up -d --remove-orphans --wait

# ── Health check ──────────────────────────────────────────────────────────────
APP_PORT="$(grep -E '^APP_PORT=' "${ENV_FILE}" | cut -d= -f2 | tr -d '"' || echo 3000)"
APP_PORT="${APP_PORT:-3000}"

log_info "[3/3] Running health check (${HEALTH_TIMEOUT}s window)"
if ! "${SCRIPT_DIR}/health-check.sh" \
    "http://localhost:${APP_PORT}/api/v1/health" \
    "${HEALTH_TIMEOUT}" \
    "${ENVIRONMENT}"; then
  log_error "Health check failed after rollback"
  log_error "Manual intervention required — check docker logs for details:"
  log_error "  docker compose -f ${COMPOSE_FILE} logs --tail=50 api"
  exit 1
fi

echo ""
log_info "======================================================"
log_info " Rollback complete"
log_info " Environment : ${ENVIRONMENT}"
log_info " Image       : ${FULL_IMAGE}:${ROLLBACK_TAG}"
log_warn " NOTE: Update .previous_image_tag if this is now stable"
log_info "======================================================"
