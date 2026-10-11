# Deployment Guide

## Overview

The trading platform uses a fully automated CI/CD pipeline built on GitHub Actions
and Docker. Every push is tested; every merge to `main` or `develop` is deployed
automatically. Production deployments include an automatic rollback if the health
check fails.

```
Push → CI (lint → typecheck → unit tests → integration tests → build → security scan → docker) 
         ↓
       develop branch → CD Staging (SSH → pull → compose up → health check)
       main / v* tag  → CD Production (SSH → pull → compose up → health check → rollback on failure)
```

---

## Prerequisites

### Server

| Requirement | Version |
|-------------|---------|
| Docker Engine | ≥ 24 |
| Docker Compose plugin | ≥ 2.20 |
| OS | Debian 12 / Ubuntu 22.04 (LTS) |
| RAM | ≥ 1 GB (staging) / ≥ 2 GB (production) |
| Disk | ≥ 20 GB |

### GitHub

- Repository hosted on GitHub
- GitHub Container Registry (GHCR) enabled (default for all orgs)
- GitHub Environments configured: `staging` and `production`
- Production environment has required reviewers set

---

## Environment Setup (first time)

### 1. Create a deploy user on each server

```bash
# On the server
sudo adduser deploy --disabled-password
sudo usermod -aG docker deploy
```

### 2. Configure SSH access

```bash
# On your local machine — generate a deploy key
ssh-keygen -t ed25519 -C "deploy@trading-platform" -f ~/.ssh/trading_deploy

# Copy the public key to the server
ssh-copy-id -i ~/.ssh/trading_deploy.pub deploy@<server-ip>
```

### 3. Add GitHub Secrets

Navigate to **Settings → Secrets and variables → Actions** in your GitHub repository.

#### Staging

| Secret | Value |
|--------|-------|
| `STAGING_SSH_HOST` | Staging server IP or hostname |
| `STAGING_SSH_USER` | `deploy` |
| `STAGING_SSH_PRIVATE_KEY` | Contents of `~/.ssh/trading_deploy` |
| `STAGING_SSH_PORT` | `22` (or custom port) |
| `STAGING_ENV_FILE` | Base64-encoded `.env.staging` (see below) |
| `GHCR_TOKEN` | GitHub PAT with `read:packages` scope |

#### Production

| Secret | Value |
|--------|-------|
| `PROD_SSH_HOST` | Production server IP or hostname |
| `PROD_SSH_USER` | `deploy` |
| `PROD_SSH_PRIVATE_KEY` | Contents of `~/.ssh/trading_deploy` |
| `PROD_SSH_PORT` | `22` (or custom port) |
| `PROD_ENV_FILE` | Base64-encoded `.env.production` (see below) |
| `GHCR_TOKEN` | GitHub PAT with `read:packages` scope |

#### Encode the env file

```bash
# Encode for GitHub secret storage
base64 -w 0 .env.staging
# Paste the output as the value of STAGING_ENV_FILE
```

### 4. Prepare the server directory

```bash
# SSH into the server as the deploy user
ssh deploy@<server-ip>

mkdir -p ~/trading-platform/scripts

# Copy deployment scripts (or pull from the repo)
scp scripts/deploy.sh scripts/rollback.sh scripts/health-check.sh \
    deploy@<server-ip>:~/trading-platform/scripts/

chmod +x ~/trading-platform/scripts/*.sh
```

---

## Deployment Targets

### Development

Run locally — no remote server needed.

```bash
docker compose -f docker-compose.dev.yml up
```

Hot-reload is active; changes to `src/` are reflected immediately.
Swagger UI: http://localhost:3000/api/swagger

### Staging

Auto-deployed on every push to `develop`. The pipeline:

1. CI must pass (all quality gates)
2. New image `ghcr.io/<org>/trading-platform:develop` is pulled
3. `docker-compose.staging.yml` is applied via `docker compose up --wait`
4. Health check polls `/api/v1/health` for up to 60 seconds

Manual staging deploy:

```bash
./scripts/deploy.sh staging develop
# or a specific tag:
./scripts/deploy.sh staging sha-a1b2c3d
```

### Production

Auto-deployed on push to `main` or a semver tag (`v*.*.*`).
Production deployments require a GitHub Environment reviewer approval.

The pipeline additionally:
- Saves the current image tag before deploying (rollback anchor)
- Runs an extended health check (90-second window)
- Automatically rolls back if the health check fails

Manual production deploy:

```bash
./scripts/deploy.sh production v1.3.0
```

---

## Pipeline Stages

### CI Pipeline (`ci.yml`)

| Stage | What it does | Quality gate |
|-------|-------------|--------------|
| Lint | ESLint + Prettier | Zero warnings |
| Typecheck | `tsc --noEmit` | Zero TS errors |
| Unit tests | Jest, 80% coverage | 80% branches/functions/lines/stmts |
| Integration tests | Jest + live Postgres + Redis | All tests pass |
| Build | `nest build` | `dist/main.js` produced |
| Security scan | `pnpm audit` + Gitleaks | No HIGH/CRITICAL CVEs; no secrets |
| Docker | Build image, Trivy scan, push to GHCR | No CRITICAL image CVEs |

### CD Pipeline (`cd-staging.yml`, `cd-production.yml`)

Both pipelines are triggered by `workflow_run` (waits for CI to succeed) or
`workflow_dispatch` (manual override).

---

## Health Checks

The application exposes `GET /api/v1/health`. A healthy response looks like:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 42.5,
  "infrastructure": {
    "redis": "healthy",
    "database": "healthy"
  }
}
```

Docker-level health checks are configured in each Dockerfile (`HEALTHCHECK`
directive) and in each `docker-compose.*.yml` file. They drive `depends_on`
readiness conditions so dependent services only start when upstream ones are
healthy.

---

## Image Registry

Images are published to **GitHub Container Registry (GHCR)**:

```
ghcr.io/<org>/<repo>:<tag>
```

Tags produced by CI:

| Event | Tags |
|-------|------|
| Push to `main` | `main`, `sha-<short>` |
| Push to `develop` | `develop`, `sha-<short>` |
| Tag `v1.2.3` | `v1.2.3`, `1.2.3`, `1.2`, `1`, `sha-<short>` |
| Pull request | `pr-<number>` (no push) |

---

## Database Migrations

Migrations run automatically on startup when `DB_MIGRATE_ON_STARTUP=true`.
The Kysely migration runner applies all pending migrations in order before
the application starts accepting traffic.

If a migration fails, the application exits with code 1 — Docker's restart
policy prevents a broken version from running indefinitely.

**Never run migrations by hand in production.** Let the deployment pipeline
handle it. If you need to add a migration, add it to `src/migrations/`, deploy
to staging first, and promote to production after validation.

---

## Monitoring Deployment

```bash
# Live logs during a deploy
docker compose -f docker-compose.prod.yml logs -f --tail=50 api

# Check container health
docker compose -f docker-compose.prod.yml ps

# Manual health check
curl -s http://localhost:3000/api/v1/health | jq .

# Resource usage
docker stats --no-stream
```

---

## Vault Integration (Prepared)

The `SECRETS_PROVIDER` env var controls where secrets are read from:

| Value | Source |
|-------|--------|
| `env` (default) | Process environment / `.env` file |
| `docker` | Docker secrets (`/run/secrets/*`) |
| `vault` | HashiCorp Vault *(integration prepared, not yet active)* |

When Vault is activated, set `SECRETS_PROVIDER=vault` and provide:
- `VAULT_ADDR` — Vault server URL
- `VAULT_TOKEN` — Vault token (use AppRole or Kubernetes auth in production)

The `SecretsProvider` interface in `src/infrastructure/providers/secrets/` is
the integration point — implement a `VaultSecretsProvider` there.
