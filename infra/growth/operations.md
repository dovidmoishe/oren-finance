# Growth reporting operations

Nothing in deploy imports history or grants a marketer. Rollups run in the existing `api` container. They do not depend on a laptop.

## Deploy

The production Compose file is unchanged apart from a comment. Postgres stays on `postgres_data`. `infra/backup-postgres.sh` already dumps the whole database, so the new tables are included, and it still deletes dump files older than 14 days.

Caddy still keeps 10 access logs of 50 MB and deletes them after 90 days (`roll_keep_for 2160h`). That disk log is not the report. `infra/visits.sh` remains an ad hoc view.

The API process takes a short lease on `growth_checkpoints` before a rollup. A second process skips the tick. The lease expires after 10 minutes if the holder dies, and the next pass recomputes only unfrozen days. Frozen daily pageviews are not rebuilt from a later partial raw set. Raw rows are deleted only before the earlier of the UTC and WAT day starts that contain the retention cutoff, so an open WAT day is not trimmed. The rollup and that deletion run in one transaction: raw rows leave only after they are added to `growth_daily_metrics`, and a failed rollup deletes nothing. Daily totals are never deleted. Visitor and session ids are kept too, so first-seen visitor counts stay exact for every date range.

Suggested limits, already the defaults:

| Setting | Default |
| --- | --- |
| `GROWTH_RAW_RETENTION_DAYS` | 30 |
| `GROWTH_IDEMPOTENCY_RETENTION_DAYS` | 90 |
| `TRUST_PROXY_HOPS` | 1 |
| `GROWTH_GEOIP_ENABLED` | true |
| `GROWTH_GEOIP_DB_PATH` | unset (download DB-IP Lite) |

`GROWTH_HASH_KEY` should be set before the first collected visit and then left alone. It is a server secret. The examples leave it empty. Postgres aggregates visits by calendar day, source, path, campaign, country and referring site. UTC and Lagos rollups share one snapshot before raw rows expire.

`TRUST_PROXY_HOPS=1` matches Caddy. The forwarded address is used for the collect rate limit and to look up the visit's country. It is not stored.

The growth-only backup runs from the production deploy user's crontab with `bash /opt/oren/infra/growth/backup.sh`. It verifies the archive and keeps local snapshots for 14 days under `/opt/oren/backups/growth`. Recovery after loss of the VPS requires a separate copy.

## Migration

`api/lib/db/migrations/0025_growth_reporting.sql` creates the tables and grants them to `oren_api_runtime` when that role exists. The normal `api-migrate` service applies it. It does not insert visits, imports, or grants.

`0027_growth_countries_referrers.sql` adds a `country` column to `growth_pageviews` and the `country` and `referrer` rollup grains. Existing rows keep a null country. The next rollup computes referrers for every unfrozen day still in raw retention.

Rollback before any report data matters: drop the `growth_*` tables in reverse dependency order (`growth_import_observations` before `growth_import_batches`). Do not drop them after production collection without an export. Upgrade is the next migration; these tables are additive.

## Export

`GET /api/admin/reports/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Africa/Lagos&format=csv`

The same path with `format=json` returns the traffic report. Both accept the marketing bot bearer or an authorized admin session.

Other read routes, all under `/api/admin/reports`, accept the same report credentials:

- `GET /coverage`
- `GET /traffic`
- `GET /funnel` and `GET /retention` (`groupBy=week` or `groupBy=campaign` on the funnel)
- `GET /compare?dimension=campaign|content|term|slot`
- `GET /external?family=x|revenue|token`
- `GET /snapshots`

There is no HTTP import route. Aggregate import is the offline command below. The marketing bot cannot call it.

## Access

Two callers can read reports after an approved deployment. Ordinary product logins cannot.

**Marketing bot.** Run `access issue --manual --label marketing-bot` and add `--apply` only on the database you mean to change. The command prints the bearer once. Store it in the bot's secret manager and send `Authorization: Bearer` from the bot's server. Do not put it in a browser. Revoke with `access revoke --manual --id <grant-uuid> --apply`.

The bot can fetch its activation report from a server process using its issued token. Supply the token through its secret manager as `OREN_REPORT_TOKEN`. Save the grant ID returned at issuance for revocation.

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${OREN_REPORT_TOKEN}" \
  'https://api.oren.finance/api/admin/reports/funnel?from=2026-11-01&to=2026-11-07'
```

**Admin accounts.** There is no public signup and no email sender. Bootstrap the first master offline:

```bash
node dist/src/admin/reporting/growth-cli.js admin bootstrap \
  --manual --email ops@example.com
```

Add `--apply` to print a temporary password once. The operator gives that password to the master by hand. The master signs in at `POST /api/admin/auth/session` with header `X-Oren-Admin: 1`, then `POST /api/admin/auth/password` with the CSRF token from login. Only after that can the master invite another admin at `POST /api/admin/auth/accounts`. The response contains that person's temporary password once. Hand it over manually. They must replace it before `reports.read` works. `dashboard.access` does not include reports. Invited admins cannot invite or become master.

To explicitly give the first master report and operational reads too, add `--permissions reports.read,dashboard.access` to `admin bootstrap`. With no flag, the master manages accounts only. Unknown permissions are rejected, and account plus permissions are inserted atomically. Recovery preserves existing permissions and does not accept that flag. The dashboard never grants itself access.

If the master loses access, `admin recover --manual --email ops@example.com --apply` issues a new temporary password and revokes their sessions. Production still requires `--allow-production`. This change does not run either command.

`infra/growth/reporting-role.sql` grants nothing.

## History and backfill

The recovery notes, CSV, and observation JSON are in `infra/growth/history/` and `api/src/admin/reporting/fixtures/`. They are reported aggregates. Import stays an operator command, not a bot permission:

```bash
node dist/src/admin/reporting/growth-cli.js import recovery \
  --manual --file api/src/admin/reporting/fixtures/recovery-observations.json
```

Add `--apply` only on the database you intend to change. The writer inserts observations. It does not create visit rows. Overlapping snapshots are not added together. Unknown days stay unknown.

Caddy backfill, before raw retention deletes the days you still need:

```bash
node dist/src/admin/reporting/growth-cli.js caddy \
  --manual --file /path/to/site.log
```

`--apply` inserts real log lines with an idempotency key. It does not turn an aggregate snapshot into people. It looks up each line's country with the collector's database (`GROWTH_GEOIP_DB_PATH`, or this month's DB-IP Lite), so repeating an import fills in the country of rows imported without one. A filled country is never overwritten, and only days still in raw retention gain one. A frozen day is not rebuilt from a partial log after its raw rows are gone. Traffic reports and daily exports use beacon totals when available and fall back to Caddy for days with only log coverage. Daily uniques use the same collector. An overlapping exact recovery observation still marks that day unavailable.

## Collection

The site posts pageviews and setup actions to `POST /api/growth/collect`. Bots, prefetches, assets, `/_next`, `/api/`, and `localhost` are dropped. The OAuth consent page sends the stored UTM header and can record an explicit cancel as `oauth_refused`. A reporting write cannot change the OAuth redirect, a research answer, or a trade.

Set `GROWTH_COLLECT_ENABLED=false` to stop new beacons without removing reports.

### Countries and referrers

The beacon sends the origin of the page that linked to the site, only with the first pageview of a page load. The API keeps the referring host without `www.` or a port, and drops links within the same site and bare IP addresses. Reports credit each visit to the referrer on its first pageview that day. Origins named in `CORS_ORIGIN` count as direct.

The country comes from the forwarded address at collection time. Only the ISO code is stored. Unless `GROWTH_GEOIP_DB_PATH` is set, the API downloads the free DB-IP Lite country database at startup, checks twice a day for the next monthly release, and keeps the previous database if a download fails. A healthy start logs `Loaded the DB-IP country database for YYYY-MM`. Without a database, pageviews are recorded without a country and the admin Countries panel says so. Set `GROWTH_GEOIP_ENABLED=false` to stop recording countries.

DB-IP Lite is licensed under CC BY 4.0. The admin Countries panel links to db-ip.com as the licence requires. Keep that link wherever countries are shown.

`GET /api/admin/reports/breakdowns?from=&to=&timezone=` returns visits by country and by referrer, using one collector per day like the traffic report.
