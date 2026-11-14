# Notification worker rollout

The API stores schedules and notification jobs in Postgres. The worker process
runs BullMQ lanes for generation, alert polling, and email. Each Redis
environment has a dedicated persistent volume with AOF and no eviction. Queue
payloads are empty. The job ID points to Postgres, which is the authority on
whether work may run or an email may be submitted.

## Preview

The trusted preview controller must install the updated default-branch Compose
bundle before the new worker profile is available on the VPS. A PR image alone
cannot change the trusted controller's Compose configuration. Start the profile
only in an isolated preview project using the controller's env file and
project name. Run the normal migration first.

Create the optional `notifications.env` in the preview stack directory with
permissions limited to the deploy user. Set `MORNING_BRIEF_ENABLED=true`,
`NOTIFICATION_FIXTURE_RECIPIENT` to the exact verified test address, a unique
unsubscribe secret, and both provider budgets. An empty
`NOTIFICATION_PILOT_USERS` list is valid. Set a time shortly ahead in
Preferences. Run
`docker compose --profile notifications up -d notification-redis notification-worker`
with the preview stack's normal flags and env. Refresh the preview API service
if its environment file changed. Preview is always fixture mode and records
a fixture acceptance in Postgres without sending email.

## Production

Apply the release migration first. The production deploy enables the
`notifications` Compose profile, so `notification-redis` and
`notification-worker` start with the API. Place notification settings in
`.env.notifications` and use the same immutable API image for the API and
worker. Configure a verified Senviok sender, a unique unsubscribe secret,
both HTTPS origins, and both provider budgets. Budget the snapshot requests
below the Tokens quota so existing API traffic has headroom.

`MORNING_BRIEF_ENABLED=true` schedules the Morning Brief for every signed-in
user who turns it on in Preferences (their `briefTime` and `timeZone`) and
who still has a verified email at send time. Briefs do not read
`NOTIFICATION_PILOT_USERS`. An empty pilot list is valid with briefs on.
There is no separate public flag: the feature switch is the rollout switch.
Leave `MORNING_BRIEF_ENABLED` unset to keep briefs off.

The scheduler does not load every opted-in user. Each minute it locks at
most 100 due preference rows. New brief jobs are admitted only at the brief
share of the provider budgets. With alerts also on, briefs keep
`floor(email budget × 0.8)` email slots and half of the Tokens.xyz snapshot
budget (at least one snapshot when the budget is a single shared slot).
Price scans use the same `tokens-snapshots` bucket. At the production budgets
of 5 emails per minute and 2 Tokens.xyz calls per minute, that admits 1 new
brief per minute while alerts are on, and 2 per minute while alerts are off.
In-flight `brief` and `brief-email` jobs are capped at that rate times the
2 hour grace window (`BRIEF_GRACE_MS`). Users who share a brief time and do
not fit stay due in `user_preferences` and are picked up on a later minute,
oldest due time first. A stored due time older than 2 hours counts as missed.
If that user's latest local occurrence is still inside the window it can
still be admitted; otherwise the preference moves to the next occurrence and
no stale brief is built. With alerts on, one shared clock time can finish
about 120 briefs before the rest roll to the next day. A provider stall
stops admission instead of queueing work the grace window would cancel.

Price alerts stay off until both `PRICE_ALERTS_ENABLED` and
`TOKENS_ALERT_TIMESTAMPS_VERIFIED` are true. Set them only after the feed
contract, price timestamps, coverage, and rate/load checks pass. List only
the confirmed mints in `NOTIFICATION_ALERT_MINTS`. An empty allowlist keeps
alerts disabled. Missing, stale, or out-of-order quotes never fire an alert.

`PRICE_ALERTS_PUBLIC` defaults to false, which keeps alerts on the pilot
allowlist. Set it to `true` to let every signed-in user with a verified
email create and receive price alerts. `NOTIFICATION_PILOT_USERS` is only
the private-alert allowlist. Morning Brief does not need it.

When both features are off, the worker process stays idle. It does not open
a queue or send mail. Compose restarts a process that exits
(`restart: unless-stopped`), so the idle worker stays running instead of
exiting. Startup with an empty pilot list:

| Morning Brief | Price alerts | `PRICE_ALERTS_PUBLIC` | Redis and both budgets | Result |
| --- | --- | --- | --- | --- |
| off | off | either | either | idle |
| on | off | either | set | ready |
| on | on | true | set | ready |
| off | on | true | set | ready |
| on or off | on | false | set | refuses to start (pilot accounts) |
| on | off | either | missing | refuses to start (Redis and budgets) |

`api-migrate` runs `lib/db/migrate.mjs` as the admin `POSTGRES_URL` in `.env`
(production owner role `oren`) before the API and worker start. It does not
use `oren_api_runtime`. Migration `0021_runtime_table_grants` grants
`SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `notification_jobs`,
`price_alerts`, `notification_budgets`, `price_poll_cursor`,
`brief_valuations`, and `user_preferences` when `oren_api_runtime` exists,
and sets default privileges so later tables and sequences created by `oren`
receive the same DML grants. It does not grant `TRUNCATE` or ownership.
Dev, CI, and preview databases without that role skip the statements and
still migrate. Production already has `oren_api_runtime`, so a normal
deploy applies the grants. Nothing has to be run by hand first, and
`roles.sql` does not need to be provisioned again. A fresh database that
migrates before the role exists gets the same table grants from `roles.sql`
(`GRANT ... ON ALL TABLES`) and the same defaults for objects that owner
creates afterwards. Sensitive MCP tables must still revoke in their own
migration, because default privileges grant ordinary app DML.

## Operations

The worker reports due queue depth, lag, and newly uncertain deliveries. Use
`notification_jobs` for state counts and inspect the Senviok dashboard when
the provider ID or outcome is uncertain. An accepted email has a provider
message ID. An uncertain send is held for reconciliation and is never
automatically retried. Stop the worker or disable the relevant feature and
restart the API and worker to pause dispatch. Redis loss is recoverable from
the Postgres ledger. Treat the ledger and unsubscribe secret as private.
