#!/usr/bin/env bash
set -euo pipefail

# Run from /opt/oren via cron. Sync backups to encrypted off-VPS storage too.
cd /opt/oren
mkdir -p backups
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="backups/oren-${timestamp}.sql.gz"
docker compose --env-file .env --env-file .release.env -f deploy.yml exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "${backup_path}"
find backups -type f -name 'oren-*.sql.gz' -mtime +14 -delete
echo "Created ${backup_path}"
