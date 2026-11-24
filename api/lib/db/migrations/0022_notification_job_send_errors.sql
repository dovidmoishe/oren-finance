-- Last Senviok submission error for a notification job. Both columns stay
-- null until a send fails. 0021_runtime_table_grants already grants table-level
-- SELECT, INSERT, UPDATE, DELETE on notification_jobs to oren_api_runtime when
-- that role exists. PostgreSQL applies that UPDATE to columns added later, so
-- this migration does not issue another GRANT.
ALTER TABLE "notification_jobs"
  ADD COLUMN "last_error" text,
  ADD COLUMN "last_error_status" integer;
