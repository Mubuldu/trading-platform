#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Deploy a new image version to a target environment
#
# Usage:
#   ./scripts/deploy.sh <environment> <image_tag>
#
# Arguments:
#   environment   development | staging | production
#   image_tag     Docker image tag (e.g. develop, main, sha-abc1234, v1.2.3)
#
# Examples:
#   ./scripts/deploy.sh staging develop
#   ./scripts/deploy.sh production v1.3.0
#   ./scripts/deploy.sh production sha-a1b2c3d
#
# Prerequisites:
#   • docker compose v2
#   • .env.<environment> file in the current directory
#   • GHCR credentials set (docker login ghcr.io or DOCKER_REGISTRY_TOKEN env var)
#
# Exit codes:
#   0  — deployment succeeded and health check passed
#   1  — deployment failed (previous version NOT restored automatically here;
#        use rollback.sh for that)
# =============================================================================

set -euo pipefail

# ── Arguments ─────────────────────────────────────────────────────────────────
ENVIRONMENT="${1:-}"
IMAGE_TAG="${2:-}"

if [ -z "${ENVIRONMENT}" ] || [ -z "${IMAGE_TAG}" ]; then
  echo "Usage: $0 <environment> <image_tag>"
  echo "       environment: development | staging | production"
  echo "       image_tag:   develop | main | sha-<hash> | v<semver>"
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

# Pick compose file based on environment
case "${ENVIRONMENT}" in
  development)  COMPOSE_FILE="docker-compose.dev.yml" ;;
  staging)      COMPOSE_FILE="docker-compose.staging.yml" ;;
  production)   COMPOSE_FILE="docker-compose.prod.yml" ;;
  *)
    echo "ERROR: Unknown environment '${ENVIRONMENT}'"
    echo "       Valid: development | staging | production"
    exit 1
    ;;
esac

# ── Logging ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Precondition checks ────────────────────────────────────────────────────────
log_info "=== Trading Platform Deploy ==="
log_info "Environment : ${ENVIRONMENT}"
log_info "Image tag   : ${IMAGE_TAG}"
log_info "Compose file: ${COMPOSE_FILE}"
echo ""

if ! command -v docker &>/dev/null; then
  log_error "docker not found"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  log_error "docker compose plugin not found (requires Docker v2)"
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  log_error "Environment file not found: ${ENV_FILE}"
  log_error "Copy .env.example to ${ENV_FILE} and fill in values"
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  log_error "Compose file not found: ${COMPOSE_FILE}"
  exit 1
fi

# ── Save current tag for rollback ─────────────────────────────────────────────
CURRENT_TAG=$(docker inspect \
  --format='{{index .Config.Image}}' \
  trading-platform-api 2>/dev/null \
  | awk -F: '{print $NF}' || echo "none")

echo "${CURRENT_TAG}" > "${PREV_TAG_FILE}"
log_info "Previous tag saved: ${CURRENT_TAG}"

# ── Pull image ────────────────────────────────────────────────────────────────
log_info "[1/4] Pulling image: ${FULL_IMAGE}:${IMAGE_TAG}"
docker pull "${FULL_IMAGE}:${IMAGE_TAG}"

# ── Start services ────────────────────────────────────────────────────────────
log_info "[2/4] Starting services (${COMPOSE_FILE})"
IMAGE_TAG="${IMAGE_TAG}" \
  docker compose \
    -f "${COMPOSE_FILE}" \
    --env-file "${ENV_FILE}" \
    up -d --remove-orphans --wait

# ── Health check ──────────────────────────────────────────────────────────────
APP_PORT="$(grep -E '^APP_PORT=' "${ENV_FILE}" | cut -d= -f2 | tr -d '"' || echo 3000)"
APP_PORT="${APP_PORT:-3000}"

log_info "[3/4] Running health check (${HEALTH_TIMEOUT}s window)"
if ! "${SCRIPT_DIR}/health-check.sh" \
    "http://localhost:${APP_PORT}/api/v1/health" \
    "${HEALTH_TIMEOUT}" \
    "${ENVIRONMENT}"; then
  log_error "Health check failed"
  exit 1
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
log_info "[4/4] Pruning dangling images"
docker image prune -f || true

# Update stable tag record
echo "${IMAGE_TAG}" > "${PREV_TAG_FILE}"

echo ""
log_info "======================================================"
log_info " Deployment complete"
log_info " Environment : ${ENVIRONMENT}"
log_info " Image       : ${FULL_IMAGE}:${IMAGE_TAG}"
log_info "======================================================"
