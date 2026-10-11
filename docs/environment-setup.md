# Environment Setup Guide

## Overview

The platform supports four environments:

| Environment | Branch | Compose file | Secrets |
|-------------|--------|-------------|---------|
| Development | any | `docker-compose.dev.yml` | `.env.development` (local) |
| Test | any | n/a (in-process) | `.env.test` (local) |
| Staging | `develop` | `docker-compose.staging.yml` | `STAGING_ENV_FILE` secret |
| Production | `main` / `v*` | `docker-compose.prod.yml` | `PROD_ENV_FILE` secret |

---

## Local Development

### 1. Clone and install

```bash
git clone <repository-url>
cd trading-platform
pnpm install
```

### 2. Create dev environment file

```bash
cp .env.example .env.development
# Edit .env.development — the defaults work for local docker-compose
```

### 3. Start infrastructure

```bash
# Start Postgres + Redis + API with hot-reload
docker compose -f docker-compose.dev.yml up

# Or start only infrastructure, run API with pnpm:
docker compose -f docker-compose.dev.yml up postgres redis
pnpm start:dev
```

### 4. Verify

```bash
curl http://localhost:3000/api/v1/health
# → {"status":"ok",...}

# Swagger UI (dev only)
open http://localhost:3000/api/swagger
```

---

## Test Environment

Tests use their own `.env.test` (or GitHub Actions service containers).

```bash
cp .env.example .env.test
# Adjust DB_NAME, REDIS_URL to point at test instances
```

Run tests:

```bash
pnpm test:unit         # unit only (no external services needed)
pnpm test:integration  # requires Postgres + Redis
pnpm test:cov          # all tests with coverage report
```

---

## Staging Environment

Staging is deployed automatically on every push to `develop`.

### First-time setup

1. Provision a server (see [Deployment Guide](./deployment-guide.md)).
2. Create `.env.staging` from the template:

```bash
cp .env.example .env.staging
```

3. Fill in staging-specific values (see table below).
4. Encode and add to GitHub Secrets:

```bash
base64 -w 0 .env.staging
# Add as STAGING_ENV_FILE in GitHub → Settings → Secrets
```

### Key staging overrides

| Variable | Development | Staging |
|----------|------------|---------|
| `NODE_ENV` | development | staging |
| `SWAGGER_ENABLED` | true | true |
| `LOG_LEVEL` | debug | info |
| `LOG_JSON_OUTPUT` | false | true |
| `DB_HOST` | localhost | postgres (docker service) |
| `REDIS_URL` | redis://localhost:6379 | redis://redis:6379 |
| `DB_MIGRATE_ON_STARTUP` | true | true |
| `BINANCE_SPOT_TESTNET` | false | **true** |
| `PAPER_TRADING_ENABLED` | true | true |

---

## Production Environment

Production is deployed automatically on push to `main` or a semver tag.

### First-time setup

1. Provision a production server (see [Deployment Guide](./deployment-guide.md)).
2. Create `.env.production`:

```bash
cp .env.example .env.production
```

3. Set **all** production values carefully (see table below).
4. Encode and add to GitHub Secrets:

```bash
base64 -w 0 .env.production
# Add as PROD_ENV_FILE in GitHub → Settings → Secrets
```

### Key production overrides

| Variable | Staging | Production |
|----------|---------|------------|
| `NODE_ENV` | staging | production |
| `SWAGGER_ENABLED` | true | **false** |
| `LOG_LEVEL` | info | warn |
| `LOG_JSON_OUTPUT` | true | true |
| `DB_SSL` | false | **true** |
| `BINANCE_SPOT_TESTNET` | true | **false** |
| `API_KEY_SECRET` | staging-key | **strong random value** |
| `RISK_ENABLED` | true | true |
| `MAX_POSITION_SIZE_USD` | 10000 | set per trading plan |
| `PAPER_TRADING_ENABLED` | true | false (real trades) |

---

## Secret Management

### Current: environment variables

All secrets flow through `SECRETS_PROVIDER=env` (default). They are:
- **Development**: plain `.env.development` file (gitignored)
- **Staging / Production**: base64-encoded GitHub Secrets, decoded on the server
  at deploy time and written to `.env.<environment>` (chmod 600)

### Future: Docker secrets

Set `SECRETS_PROVIDER=docker` and mount secrets via Docker secrets:

```yaml
# docker-compose.prod.yml
secrets:
  db_password:
    external: true
  binance_api_key:
    external: true

services:
  api:
    secrets:
      - db_password
      - binance_api_key
```

The `DockerSecretsProvider` reads from `/run/secrets/<KEY>` (three candidates:
exact name, lowercase, uppercase).

### Future: HashiCorp Vault

Set `SECRETS_PROVIDER=vault` and configure:

```
VAULT_ADDR=https://vault.internal:8200
VAULT_TOKEN=<token>           # or use AppRole / K8s auth
```

Implement `VaultSecretsProvider` in
`src/infrastructure/providers/secrets/vault-secrets.provider.ts`.

---

## Configuration Namespaces

All configuration is typed and validated via Joi at startup. If a required
variable is missing or invalid, the application exits immediately with an error
listing all violations (`abortEarly: false`).

| Namespace | `ConfigService.get()` key | Key variables |
|-----------|--------------------------|---------------|
| App | `app` | `NODE_ENV`, `APP_PORT`, `SWAGGER_ENABLED` |
| Logging | `logging` | `LOG_LEVEL`, `LOG_DIR`, `LOG_JSON_OUTPUT` |
| Database | `database` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_PASSWORD` |
| Redis | `redis` | `REDIS_URL`, `REDIS_KEY_PREFIX` |
| Exchange | `exchange` | `DEFAULT_EXCHANGE_ID`, `ENABLED_EXCHANGES` |
| Binance | `binance` | `BINANCE_SPOT_API_KEY`, `BINANCE_SPOT_TESTNET` |
| Risk | `risk` | `MAX_POSITION_SIZE_USD`, `MAX_DRAWDOWN_PERCENT` |
| Strategy | `strategy` | `ENABLED_STRATEGY_IDS`, `DEFAULT_SYMBOL` |
| Execution | `execution` | `ORDER_ROUTING_MODE`, `ORDER_TIMEOUT_MS` |
| Paper Trading | `paperTrading` | `PAPER_TRADING_ENABLED`, `PAPER_TRADING_INITIAL_BALANCE_USD` |
| Backtesting | `backtesting` | `BACKTESTING_DATA_DIR`, `MAX_WORKERS` |
| Monitoring | `monitoring` | `METRICS_ENABLED`, `THRESHOLD_LATENCY_MS` |
| Alerts | `alerts` | `ALERTS_ENABLED`, `ALERT_DRAWDOWN_PERCENT` |
| Secrets | `secrets` | `SECRETS_PROVIDER`, `DOCKER_SECRETS_PATH` |

---

## Hot-Reloadable Configuration

The following configuration sections can be reloaded at runtime without
restarting the application. Send `SIGHUP` to the process:

```bash
# Find the PID
docker compose exec api cat /proc/1/status | grep Pid

# Or from the host
docker exec trading-platform-api kill -HUP 1
```

Hot-reloadable namespaces:
- `risk` — position limits, drawdown limits
- `strategy` — strategy IDs, heartbeat interval
- `monitoring` — metric thresholds
- `alerts` — alert thresholds and cooldown

**Not hot-reloadable** (require restart):
- Credentials and connection strings (DB, Redis, Binance keys)
- Ports and bind addresses
- Log directory
- `NODE_ENV`

---

## Environment Validation

The application validates all required variables on startup using the Joi
schemas in `src/config/`. Common errors:

| Error | Cause | Fix |
|-------|-------|-----|
| `"NODE_ENV" must be one of [development, test, staging, production]` | Typo in env file | Set exact string |
| `"DB_PORT" must be a number` | Quoted port: `"5432"` | Remove quotes or pnpm will parse it |
| `"APP_KEY_SECRET" is not allowed to be empty` | Missing or blank secret | Generate and set a value |
| `"BINANCE_SPOT_TESTNET" must be a boolean` | String `"True"` | Use `true` / `false` (lowercase) |
