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
`NOTIFICATION_FIXTURE_RECIPIENT` to the exact verified test address,
`NOTIFICATION_PILOT_USERS` to its Privy user ID, a unique unsubscribe secret,
and both provider budgets. Set a time shortly ahead in Preferences. Run
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

Morning Brief stays limited to `NOTIFICATION_PILOT_USERS`. Leave
`MORNING_BRIEF_ENABLED` unset until those Privy IDs are listed. An empty
pilot list is valid while Morning Brief is off.

Price alerts stay off until both `PRICE_ALERTS_ENABLED` and
`TOKENS_ALERT_TIMESTAMPS_VERIFIED` are true. Set them only after the feed
contract, price timestamps, coverage, and rate/load checks pass. List only
the confirmed mints in `NOTIFICATION_ALERT_MINTS`. An empty allowlist keeps
alerts disabled. Missing, stale, or out-of-order quotes never fire an alert.

`PRICE_ALERTS_PUBLIC` defaults to false, which keeps alerts on the pilot
allowlist. Set it to `true` to let every signed-in user with a verified
email create and receive price alerts. The worker then does not need
`NOTIFICATION_PILOT_USERS` unless Morning Brief is also enabled.

When both features are off, the worker process stays idle. It does not open
a queue or send mail. Compose restarts a process that exits
(`restart: unless-stopped`), so the idle worker stays running instead of
exiting. The worker still refuses to start when Morning Brief is on, or
when alerts are on and not public, and the pilot list is empty.

## Operations

The worker reports due queue depth, lag, and newly uncertain deliveries. Use
`notification_jobs` for state counts and inspect the Senviok dashboard when
the provider ID or outcome is uncertain. An accepted email has a provider
message ID. An uncertain send is held for reconciliation and is never
automatically retried. Stop the worker or disable the relevant feature and
restart the API and worker to pause dispatch. Redis loss is recoverable from
the Postgres ledger. Treat the ledger and unsubscribe secret as private.
