-- Official market events (Phase 1: US macro releases) and the sync lease.
-- App memory only; the publishing agencies remain the record. There is no
-- consensus column by design: only official dates, times, and published values.
CREATE TABLE market_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL DEFAULT 'macro' CHECK (family IN ('macro', 'company')),
  kind text NOT NULL,
  title text NOT NULL,
  country text NOT NULL DEFAULT 'US' CHECK (country ~ '^[A-Z]{2}$'),
  scheduled_at timestamptz NOT NULL,
  time_precision text NOT NULL CHECK (time_precision IN ('date', 'datetime')),
  date_status text NOT NULL DEFAULT 'scheduled'
    CHECK (date_status IN ('scheduled', 'released', 'cancelled')),
  previous numeric,
  actual numeric,
  unit text,
  source text NOT NULL,
  source_event_id text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX market_events_source_event_idx ON market_events (source, source_event_id);
--> statement-breakpoint
CREATE INDEX market_events_scheduled_at_idx ON market_events (scheduled_at);
--> statement-breakpoint
CREATE TABLE market_event_sync_state (
  job text PRIMARY KEY,
  lease_owner text,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text
);
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON market_events, market_event_sync_state FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON market_events, market_event_sync_state
      TO oren_api_runtime;
  END IF;
END $$;
