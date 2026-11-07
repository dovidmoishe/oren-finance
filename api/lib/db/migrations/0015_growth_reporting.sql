CREATE TABLE growth_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission text NOT NULL CHECK (permission IN ('marketing.read', 'marketing.import')),
  principal_kind text NOT NULL CHECK (principal_kind IN ('privy_user', 'machine')),
  privy_user_id text,
  token_hash text,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK (
    (principal_kind = 'privy_user' AND privy_user_id IS NOT NULL AND token_hash IS NULL)
    OR (principal_kind = 'machine' AND token_hash IS NOT NULL AND privy_user_id IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX growth_access_token_hash_idx ON growth_access_grants (token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX growth_access_user_idx ON growth_access_grants (privy_user_id);
--> statement-breakpoint
CREATE TABLE growth_pageviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  visitor_hash text NOT NULL,
  session_hash text NOT NULL,
  visitor_stability text NOT NULL CHECK (visitor_stability IN ('durable', 'day')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  source text NOT NULL CHECK (source IN ('beacon', 'caddy')),
  ingest_key text NOT NULL UNIQUE,
  excluded boolean NOT NULL DEFAULT false,
  exclude_reason text
);
--> statement-breakpoint
CREATE INDEX growth_pageviews_occurred_idx ON growth_pageviews (occurred_at);
--> statement-breakpoint
CREATE TABLE growth_daily_metrics (
  day date NOT NULL,
  timezone text NOT NULL CHECK (timezone IN ('UTC', 'Africa/Lagos')),
  grain text NOT NULL CHECK (grain IN ('site', 'path', 'campaign')),
  dimension text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('beacon', 'caddy')),
  pageviews integer NOT NULL,
  sessions integer NOT NULL,
  daily_uniques integer NOT NULL,
  frozen boolean NOT NULL DEFAULT false,
  rolled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, timezone, grain, source, dimension)
);
--> statement-breakpoint
CREATE TABLE growth_visitors (
  visitor_hash text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  stability text NOT NULL CHECK (stability IN ('durable', 'day'))
);
--> statement-breakpoint
CREATE TABLE growth_sessions (
  session_hash text PRIMARY KEY,
  visitor_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE growth_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'setup_cta', 'oauth_completed', 'oauth_refused', 'oauth_failed',
    'oauth_expired', 'oauth_revoked', 'research_success'
  )),
  account_hash text,
  session_hash text,
  source_id text NOT NULL,
  lane text,
  tool_name text,
  slot text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  is_first boolean NOT NULL DEFAULT false,
  UNIQUE (event_type, source_id)
);
--> statement-breakpoint
CREATE INDEX growth_funnel_events_time_idx ON growth_funnel_events (occurred_at);
--> statement-breakpoint
CREATE UNIQUE INDEX growth_funnel_first_research_idx
  ON growth_funnel_events (account_hash)
  WHERE event_type = 'research_success' AND is_first;
--> statement-breakpoint
CREATE TABLE growth_attribution_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL CHECK (subject_kind IN ('visitor', 'account')),
  subject_hash text NOT NULL,
  touch text NOT NULL CHECK (touch IN ('first', 'last')),
  touched_at timestamptz NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  path text,
  UNIQUE (subject_kind, subject_hash, touch)
);
--> statement-breakpoint
CREATE TABLE growth_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL,
  source_system text NOT NULL,
  provenance text NOT NULL,
  verification text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  timezone text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE growth_import_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES growth_import_batches (id),
  snapshot_id text NOT NULL,
  metric text NOT NULL,
  family text NOT NULL,
  grain text NOT NULL CHECK (grain IN ('day', 'window', 'intraday', 'point')),
  period_start timestamptz,
  period_end timestamptz,
  day date,
  value numeric(20, 4),
  coverage text NOT NULL CHECK (coverage IN (
    'complete', 'partial', 'unknown', 'excluded', 'unresolved',
    'lower_bound', 'superseded', 'as_reported'
  )),
  usable_in_totals boolean NOT NULL DEFAULT false,
  usable_as_window boolean NOT NULL DEFAULT false,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  UNIQUE (batch_id, snapshot_id, metric),
  CHECK (coverage <> 'unknown' OR value IS NULL),
  CHECK (NOT usable_in_totals OR (coverage = 'complete' AND grain = 'day' AND value IS NOT NULL)),
  CHECK (NOT usable_as_window OR (coverage = 'complete' AND grain = 'window' AND value IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX growth_import_obs_metric_idx ON growth_import_observations (metric, day);
--> statement-breakpoint
CREATE TABLE growth_checkpoints (
  name text PRIMARY KEY,
  cursor_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE growth_coverage (
  source text PRIMARY KEY CHECK (source IN ('beacon', 'caddy')),
  started_at timestamptz NOT NULL,
  notes text
);
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON
    growth_access_grants, growth_pageviews, growth_daily_metrics, growth_visitors,
    growth_sessions, growth_funnel_events, growth_attribution_touches,
    growth_import_batches, growth_import_observations, growth_checkpoints, growth_coverage
  FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      growth_access_grants, growth_pageviews, growth_daily_metrics, growth_visitors,
      growth_sessions, growth_funnel_events, growth_attribution_touches,
      growth_import_batches, growth_import_observations, growth_checkpoints, growth_coverage
    TO oren_api_runtime;
  END IF;
END $$;
