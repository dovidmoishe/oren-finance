# Production deployment

Oren deploys one immutable API/app release per `master` commit. GitHub builds
both images from the same commit SHA and publishes them to GHCR. The VPS only
pulls those images; API keys and database credentials remain on the VPS.

## One-time VPS setup

1. Point both production `A`/`AAAA` records—`oren.finance` and
   `api.oren.finance`—at the VPS. Ports 80 and 443 must be reachable for
   Caddy to issue certificates.
2. Create a non-root, key-only SSH user. Run
   `sudo OREN_DEPLOY_USER=<user> OREN_SSH_PORT=<port> bash infra/vps-bootstrap.sh`
   once from a checkout, then log in again after its Docker group change.
   Set `OREN_SSH_PORT` to the actual SSH port before enabling the firewall.
3. Create `/opt/oren/.env` from `.env.production.example`, replace every
   placeholder, and run `chmod 600 /opt/oren/.env`. `POSTGRES_URL` uses host
   `db`, not `localhost`.
4. Create `/opt/oren/.release.env` with `GHCR_OWNER=<GitHub owner>` and a
   temporary `IMAGE_TAG`. Login on the VPS with a fine-grained token permitted
   to read this repository's packages:

   ```bash
   echo '<GHCR_READ_TOKEN>' | docker login ghcr.io -u '<GitHub user>' --password-stdin
   ```

5. Create GitHub environment `production`, add `VPS_HOST`, `VPS_PORT`,
   `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, and `VPS_SSH_KNOWN_HOSTS` (the pinned
   `ssh-keyscan -H <VPS IP>` output). Protect it with reviewers if desired.
   Add repository variables `PUBLIC_APP_ORIGIN=https://oren.finance` and
   `PUBLIC_API_ORIGIN=https://api.oren.finance`, each with no trailing slash.
   They must agree with VPS `DOMAIN`, `API_DOMAIN`, and `CORS_ORIGIN`.

## Releases

A successful CI run for a `master` push triggers the deployment workflow. It
builds both images, copies `deploy.yml`, `Caddyfile`, and deployment helpers to
`/opt/oren`, sets the immutable SHA in `.release.env`, pulls images, and waits for Compose.
Compose starts Postgres, runs idempotent Drizzle migrations, then API, app,
and Caddy. No application or database port is exposed publicly—only 80/443.

After the first release, seed the catalog intentionally:

```bash
cd /opt/oren
docker compose --env-file .env --env-file .release.env -f deploy.yml \
  --profile bootstrap run --rm catalog-sync
```

Verify `https://api.oren.finance/api/health/ready` and the website at
`https://oren.finance`. Readiness checks the database only; `/api/health`
remains the fuller provider/worker status.

## Rollback and backups

Use **Run workflow** on “Deploy production release” with a previous immutable
image SHA. Migrations are forward-only, so new migrations must remain backward
compatible with the prior application release.

After testing it, schedule a daily backup:

```cron
15 2 * * * /opt/oren/infra/backup-postgres.sh >> /opt/oren/backups/backup.log 2>&1
```

The script keeps 14 local days. Sync `backups/` to encrypted off-VPS storage
and regularly test restoration; VPS-local copies alone are not recovery.
