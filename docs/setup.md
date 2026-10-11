# Setup and Operations Guide

## Prerequisites

| Tool    | Version   |
|---------|-----------|
| Node.js | >= 20.0.0 |
| pnpm    | >= 9.0.0  |
| Docker  | >= 24.0.0 |

## Local Development (without Docker)

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment file
cp .env.example .env.development
# Edit .env.development — at minimum set API_KEY_SECRET to 32+ chars

# 3. Start in watch mode
pnpm start:dev

# 4. Verify
curl http://localhost:3000/api/v1/health
# Swagger: http://localhost:3000/api/docs
```

## Local Development (Docker)

```bash
# Build and start
docker compose -f docker-compose.dev.yml up --build

# Tail logs
docker compose -f docker-compose.dev.yml logs -f api

# Stop
docker compose -f docker-compose.dev.yml down
```

## Production

```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Start (requires .env.production with real secrets)
docker compose -f docker-compose.prod.yml up -d

# View health
curl http://localhost:3000/api/v1/health
```

## Configuration

All configuration is injected via environment variables. See `.env.example`
for the full list. Startup fails with a descriptive error if any required
variable is missing or invalid.

| Variable        | Required | Default  | Description                                         |
|-----------------|----------|----------|-----------------------------------------------------|
| NODE_ENV        | Yes      | —        | `development` / `test` / `production`               |
| APP_NAME        | Yes      | —        | Service name in logs                                |
| APP_PORT        | No       | 3000     | HTTP listen port                                    |
| APP_VERSION     | Yes      | —        | Semver string (e.g. `1.0.0`)                        |
| LOG_LEVEL       | No       | info     | Winston log level                                   |
| LOG_DIR         | No       | ./logs   | Directory for rotated log files                     |
| SWAGGER_ENABLED | No       | true     | Enable Swagger UI (auto-disabled in production)     |
| CORS_ORIGINS    | No       | localhost| Comma-separated allowed origins                     |
| API_KEY_SECRET  | Yes      | —        | Minimum 32 chars. Rotate per environment            |

## Running Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# With coverage report
pnpm test:cov

# Type checking (no emit)
pnpm typecheck
```

## Adding a New Feature Module

1. Create `src/modules/<feature>/<feature>.module.ts`
2. Implement controllers, services, and DTOs inside the feature folder
3. Import the module in `src/app/app.module.ts`
4. No changes to middleware, filters, or config are required

## Logs

In development: colorized console output.
In production: JSON lines to console + daily rotated files under `LOG_DIR`.
Error logs are written to a separate `error-YYYY-MM-DD.log` file.
Logs are retained for 30 days (app) and 90 days (errors).
