#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/opt/oren/backups/growth
mkdir -p "$root"
exec 9>"$root/.backup.lock"
flock -n 9 || exit 0

archive=$(mktemp "$root/.growth.XXXXXX")
trap 'rm -f -- "$archive"' EXIT
docker exec oren-db-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --table=public.growth_*' > "$archive"
contents=$(docker exec -i oren-db-1 pg_restore --list < "$archive")
for table in growth_pageviews growth_visitors growth_daily_metrics; do
  if ! grep -Fq "TABLE DATA public $table " <<< "$contents"; then
    echo "Growth backup is missing $table" >&2
    exit 1
  fi
done
docker exec -i oren-db-1 pg_restore --file=/dev/null < "$archive"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mv -- "$archive" "$root/growth-$timestamp.dump"
find "$root" -maxdepth 1 -type f -name 'growth-20??????T??????Z.dump' -mtime +14 -delete
printf 'Saved growth backup %s\n' "$timestamp"
