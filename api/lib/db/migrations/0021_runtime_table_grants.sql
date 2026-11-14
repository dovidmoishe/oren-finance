-- api-migrate runs this as the database owner (production role `oren`), not as
-- oren_api_runtime. roles.sql's one-time GRANT ON ALL TABLES did not cover
-- tables created later. Skip cleanly where the runtime role does not exist
-- (dev, CI, preview). GRANT is idempotent. Privileges are DML only: no TRUNCATE or ownership.
-- Default privileges apply only to objects `oren` creates after this migration.
-- A later sensitive table must REVOKE in its own migration.
DO $$
DECLARE
  rel text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    RETURN;
  END IF;
  FOREACH rel IN ARRAY ARRAY[
    'notification_jobs',
    'price_alerts',
    'notification_budgets',
    'price_poll_cursor',
    'brief_valuations',
    'user_preferences'
  ]
  LOOP
    IF to_regclass('public.' || rel) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO oren_api_runtime',
        rel
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  allowed boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren') THEN
    RETURN;
  END IF;
  allowed := current_user = 'oren'
    OR COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false);
  IF NOT allowed THEN
    allowed := pg_has_role(current_user, 'oren', 'MEMBER');
  END IF;
  IF NOT allowed THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE oren IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oren_api_runtime';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE oren IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO oren_api_runtime';
END $$;
