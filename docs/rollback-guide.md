# Rollback Guide

## When to Roll Back

| Symptom | Recommended action |
|---------|-------------------|
| Health check fails after deploy | Automatic rollback kicks in (production pipeline) |
| Users reporting errors after release | Manual rollback via `rollback.sh` |
| Performance regression | Manual rollback, then investigate |
| Database migration broke something | See [Migration Rollback](#migration-rollback) |

---

## Automatic Rollback (Production)

The production CD pipeline (`cd-production.yml`) includes automatic rollback.

**How it works:**

1. Before deploying, the pipeline records the current image tag in
   `.previous_image_tag` on the server.
2. After deploying the new image, it polls `/api/v1/health` for 90 seconds.
3. If the health check does not return `{"status":"ok"}` within 90 seconds,
   the pipeline re-deploys the tag stored in `.previous_image_tag`.
4. The rollback image is also health-checked.
5. If the rollback also fails, the pipeline exits with an error and the
   on-call engineer must intervene manually.

You will see this in the GitHub Actions log:

```
=== [7/8] Health check (90 s window) ==="
...
=== [8/8] Health check FAILED — initiating rollback ===
Rolling back to: sha-a1b2c3d
Rollback completed — previous version restored
```

---

## Manual Rollback

### Using `rollback.sh`

```bash
# SSH into the server
ssh deploy@<server-ip>
cd ~/trading-platform

# Roll back to the automatically recorded previous tag
./scripts/rollback.sh production

# Roll back to a specific tag
./scripts/rollback.sh production v1.2.0
./scripts/rollback.sh production sha-a1b2c3d

# Roll back staging
./scripts/rollback.sh staging develop
```

The script:
1. Pulls the rollback image from GHCR
2. Restarts services with the rollback image
3. Runs a 90-second health check
4. Exits 0 on success, 1 on failure

### Using `deploy.sh` with an explicit tag

If you know exactly which version to restore:

```bash
./scripts/deploy.sh production v1.2.0
```

This is equivalent to a forward-deploy to an old tag.

### Using Docker Compose directly

For emergency situations where scripts are unavailable:

```bash
cd ~/trading-platform

# Set the image tag
export IMAGE_TAG=sha-a1b2c3d

# Pull the image
docker pull ghcr.io/<org>/trading-platform:${IMAGE_TAG}

# Deploy
docker compose -f docker-compose.prod.yml \
  --env-file .env.production \
  up -d --remove-orphans --wait

# Verify
curl -s http://localhost:3000/api/v1/health | jq .
```

---

## Finding the Previous Image Tag

### From `.previous_image_tag` (most reliable)

```bash
cat ~/trading-platform/.previous_image_tag
```

### From running container

```bash
docker inspect trading-platform-api \
  --format='{{index .Config.Image}}'
```

### From Docker image history

```bash
docker images ghcr.io/<org>/trading-platform --format "table {{.Tag}}\t{{.CreatedAt}}"
```

### From GitHub Actions

Navigate to **Actions → CI → (the last successful run) → Docker** job.
The image digest and tags are printed in the "Output image digest" step.

---

## Migration Rollback

**Important:** Database migrations are generally irreversible in production.
Design migrations to be backward-compatible (add columns, never drop them
during a rollback window).

If a migration must be undone:

1. **Stop taking new traffic** (if necessary — depends on severity).
2. Write a new "down" migration that reverses the broken change.
3. Deploy the new migration to staging, test thoroughly.
4. Deploy to production via the normal CI/CD pipeline.
5. After the migration runs, roll back the application code to the previous
   version if needed (the new migration must be compatible with the old code).

**Never roll back the application past a migration that has already run in
production** — the old code will not understand the new schema state and may
corrupt data.

If you need to recover from a catastrophic migration failure (data corruption):

1. Restore from the last database backup (before migration ran).
2. Deploy the previous application version.
3. Investigate and fix the migration in a feature branch before re-deploying.

---

## Post-Rollback Checklist

After any rollback, complete these steps before closing the incident:

- [ ] Health check returns `{"status":"ok"}`
- [ ] No errors in `docker compose logs api` at WARN or ERROR level
- [ ] Create an incident report noting: what broke, how it was detected, how
      it was rolled back, and what needs to be fixed before re-deploying
- [ ] Open a GitHub issue or PR to fix the root cause
- [ ] Test the fix on staging before merging to main

---

## Verifying Rollback Success

```bash
# 1. Health endpoint
curl -s http://localhost:3000/api/v1/health | jq .

# 2. Application version (should match the rollback tag)
curl -s http://localhost:3000/api/v1/health | jq '.version'

# 3. Container status
docker compose -f docker-compose.prod.yml ps

# 4. Recent logs (look for startup messages, no errors)
docker compose -f docker-compose.prod.yml logs --tail=50 api

# 5. Which image is running
docker inspect trading-platform-api \
  --format='Image: {{index .Config.Image}}'
```
