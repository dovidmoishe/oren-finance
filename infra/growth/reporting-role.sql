-- Optional read-only role for a future reporting connection.
-- Do not run this against production as part of deploy.
-- It creates NOLOGIN role with no password. An operator must set a password
-- and a connection limit deliberately, outside this repository.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_reporting') THEN
    CREATE ROLE oren_reporting NOLOGIN;
  END IF;
END $$;

GRANT SELECT ON
  growth_daily_metrics,
  growth_import_batches,
  growth_import_observations,
  growth_coverage,
  growth_checkpoints
TO oren_reporting;

-- Raw pageviews, funnel account hashes, attribution, and access grants stay
-- with the API role. Reports are served by the API, which already removes
-- personal fields. This role cannot grant trade authority.
