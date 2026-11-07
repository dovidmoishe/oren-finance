# Growth reporting operations

Nothing in deploy imports history or grants a marketer. Rollups run in the existing `api` container. They do not depend on a laptop.

## Deploy

The production Compose file is unchanged apart from a comment. Postgres stays on `postgres_data`. `infra/backup-postgres.sh` already dumps the whole database, so the new tables are included, and it still deletes dump files older than 14 days.

Caddy still keeps 10 access logs of 50 MB and deletes them after 90 days (`roll_keep_for 2160h`). That disk log is not the report. `infra/visits.sh` remains an ad hoc view.

The API process takes a short lease on `growth_checkpoints` before a rollup. A second process skips the tick. The lease expires after 10 minutes if the holder dies, and the next pass recomputes only unfrozen days. Frozen daily pageviews are not rebuilt from a later partial raw set. Raw rows are deleted only before the earlier of the UTC and WAT day starts that contain the retention cutoff, so an open WAT day is not trimmed. After identity keys are purged, lifetime distinct visitors become `unavailable` instead of a smaller exact count.

Suggested limits, already the defaults:

| Setting | Default |
| --- | --- |
| `GROWTH_RAW_RETENTION_DAYS` | 30 |
| `GROWTH_IDENTITY_RETENTION_DAYS` | 400 |
| `GROWTH_IDEMPOTENCY_RETENTION_DAYS` | 90 |
| `GROWTH_ROLLUP_LOOKBACK_DAYS` | 3 |
| `TRUST_PROXY_HOPS` | 1 |

`GROWTH_HASH_KEY` should be set before the first collected visit and then left alone. It is a server secret. The examples leave it empty. A tick that sees more than 50,000 raw rows in the retention window skips the recompute instead of growing without a bound.

`TRUST_PROXY_HOPS=1` matches Caddy. The forwarded address is used only for the collect rate limit and is not stored.

## Migration

`api/lib/db/migrations/0015_growth_reporting.sql` creates the tables and grants them to `oren_api_runtime` when that role exists. The normal `api-migrate` service applies it. It does not insert visits, imports, or grants.

Rollback before any report data matters: drop the `growth_*` tables in reverse dependency order (`growth_import_observations` before `growth_import_batches`). Do not drop them after production collection without an export. Upgrade is the next migration; these tables are additive.

## Export

`GET /api/admin/reports/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Africa/Lagos&format=csv`

The same path with `format=json` returns the traffic report. Both require `marketing.read`.

Other read routes, all under `/api/admin/reports` and all `marketing.read`:

- `GET /coverage`
- `GET /traffic`
- `GET /funnel` and `GET /retention` (`groupBy=week` or `groupBy=campaign` on the funnel)
- `GET /compare?dimension=campaign|content|term|slot`
- `GET /external?family=x|revenue|token`
- `GET /snapshots`

`POST /api/admin/imports/aggregates` requires `marketing.import`. A repeated body is a duplicate, not a second total.

## Access

Do not run these against production unless you mean to. The command refuses `DEPLOYMENT_ENV=production` and any `oren.finance` database host until you pass `--allow-production`. This change did not pass that flag.

From a built API checkout:

```bash
node dist/src/admin/reporting/growth-cli.js access issue \
  --manual --label "marketer" --permission marketing.read --user "did:privy:..."
```

Omit `--user` to print a machine token once. Only the hash is stored. Add `--apply` to write.

Revoke:

```bash
node dist/src/admin/reporting/growth-cli.js access revoke --manual --id <grant-uuid> --apply
```

`infra/growth/reporting-role.sql` creates a `NOLOGIN` role named `oren_reporting` with select access to rolled-up and imported tables only. It is not applied by migrate. It has no password and no trade grants.

## History and backfill

The recovery notes, CSV, and observation JSON are in `infra/growth/history/` and `api/src/admin/reporting/fixtures/`. They are reported aggregates. Import is manual:

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

`--apply` inserts real log lines with an idempotency key. It does not turn an aggregate snapshot into people. A frozen day is not rebuilt from a partial log after its raw rows are gone.

## Collection

The site posts pageviews and setup actions to `POST /api/growth/collect`. Bots, prefetches, assets, `/_next`, `/api/`, and `localhost` are dropped. The OAuth consent page sends the stored UTM header and can record an explicit cancel as `oauth_refused`. A reporting write cannot change the OAuth redirect, a research answer, or a trade.

Set `GROWTH_COLLECT_ENABLED=false` to stop new beacons without removing reports.
