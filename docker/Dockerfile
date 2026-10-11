# =============================================================================
# Trading Platform — Production Dockerfile
#
# Three-stage build:
#   deps     → install production node_modules only
#   build    → compile TypeScript with all deps (including dev)
#   runtime  → minimal image: compiled JS + prod node_modules, non-root user
#
# Build args (all optional — override at build time or via docker-compose):
#   NODE_VERSION   20-alpine (default)
#   PNPM_VERSION   9         (default)
# =============================================================================

# ─── Stage 1: deps ───────────────────────────────────────────────────────────
# Purpose: install production dependencies only into a clean layer.
# This layer is copied into runtime; keeping dev deps out minimises image size.
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm@9 --quiet --no-fund --no-audit

# Copy manifests — only these files so layer cache is reused unless they change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production deps only; skip post-install scripts that aren't safe
# in CI (lifecycle scripts still run for explicitly-allowed packages, e.g.
# @nestjs/core is allow-listed in pnpm-workspace.yaml).
RUN pnpm install --frozen-lockfile --prod


# ─── Stage 2: build ──────────────────────────────────────────────────────────
# Purpose: install all deps (dev included) and compile TypeScript.
# Nothing from this stage goes to runtime except the dist/ output.
# =============================================================================
FROM node:20-alpine AS build

WORKDIR /app

RUN npm install -g pnpm@9 --quiet --no-fund --no-audit

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source — these change frequently so they come last to avoid cache busts
# on the install step above.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

# Compile TypeScript
RUN pnpm run build

# Sanity-check: make sure the entry point was produced
RUN test -f dist/main.js || (echo "ERROR: dist/main.js not found — build failed" && exit 1)


# ─── Stage 3: runtime ────────────────────────────────────────────────────────
# Purpose: minimal image for production.
#   • No TypeScript compiler or dev tools
#   • Non-root user (nestjs:nodejs)
#   • Health check wired to /api/v1/health
#   • Graceful shutdown: Node 20 forwards SIGTERM automatically
# =============================================================================
FROM node:20-alpine AS runtime

WORKDIR /app

# Security: create a non-root group + user and run everything under them
RUN addgroup -g 1001 -S nodejs \
 && adduser  -S nestjs -u 1001 -G nodejs

# Copy only what the running process needs
COPY --from=build --chown=nestjs:nodejs /app/dist         ./dist
COPY --from=deps  --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./

# Log directory — logs are written here and optionally mounted as a volume
RUN mkdir -p /app/logs && chown nestjs:nodejs /app/logs

# ── Labels ────────────────────────────────────────────────────────────────────
# Standard OCI labels; values injected at build time via --build-arg / ARG
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="trading-platform" \
      org.opencontainers.image.description="Production-grade algorithmic trading platform" \
      org.opencontainers.image.source="https://github.com/${{ github.repository }}"

# ── Health check ──────────────────────────────────────────────────────────────
# Docker-level health check (also drives compose depends_on: condition).
# The NestJS app exposes GET /api/v1/health — returns 200 when healthy.
# start_period gives the JIT-warm-up + migration window before failures count.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:${APP_PORT:-3000}/api/v1/health \
      | grep -q '"status":"ok"' || exit 1

# ── Runtime ───────────────────────────────────────────────────────────────────
USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

# Use "exec form" so Node is PID 1 and receives OS signals directly —
# this is required for graceful shutdown (SIGTERM → app.close()).
CMD ["node", "dist/main"]
