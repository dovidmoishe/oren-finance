-- Email reminders for official US releases (market_events). A reminder follows
-- the event's current scheduled_at, so a moved release still reminds 15
-- minutes before its new time. App memory only; the agencies stay the record.
-- 'sent' means the reminder email was queued; a failed or system-canceled
-- email moves it to 'failed', like price_alerts 'triggered'.
CREATE TABLE "release_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "market_events" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active','sent','canceled','failed')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_reminders_active_rule" ON "release_reminders" ("user_id", "event_id") WHERE "state" = 'active';
--> statement-breakpoint
CREATE INDEX "release_reminders_active_event" ON "release_reminders" ("event_id") WHERE "state" = 'active';
--> statement-breakpoint
CREATE INDEX "release_reminders_sent" ON "release_reminders" ("id") WHERE "state" = 'sent';
--> statement-breakpoint
CREATE INDEX "release_reminders_user" ON "release_reminders" ("user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "notification_jobs" DROP CONSTRAINT "notification_jobs_kind_check";
--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_kind_check" CHECK ("kind" IN ('brief', 'brief-email', 'alert-email', 'reminder-email'));
--> statement-breakpoint
-- Default privileges from 0021 already cover tables `oren` creates. The
-- explicit grant also covers a migration run by another owner. DML only.
DO $$ BEGIN
  REVOKE ALL ON release_reminders FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON release_reminders TO oren_api_runtime;
  END IF;
END $$;
