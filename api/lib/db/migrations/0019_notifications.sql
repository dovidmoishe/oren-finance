ALTER TABLE "cached_stocks" ADD COLUMN "alert_variants" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "brief_due_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "brief_wallet" text;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "brief_wallet_since" timestamptz;
--> statement-breakpoint
CREATE INDEX "user_preferences_brief_due" ON "user_preferences" ("brief_due_at") WHERE "morning_brief";

--> statement-breakpoint
CREATE TABLE "notification_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "logical_key" text NOT NULL UNIQUE,
  "user_id" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('brief', 'brief-email', 'alert-email')),
  "payload" jsonb NOT NULL,
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'running', 'sending', 'accepted', 'complete', 'canceled', 'failed', 'uncertain')),
  "run_after" timestamptz NOT NULL DEFAULT now(),
  "lease_until" timestamptz,
  "lease_token" uuid,
  "attempts" integer NOT NULL DEFAULT 0,
  "provider_id" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "notification_jobs_pending" ON "notification_jobs" ("run_after", "id") WHERE "state" = 'pending';
--> statement-breakpoint
CREATE INDEX "notification_jobs_leases" ON "notification_jobs" ("lease_until") WHERE "state" IN ('running', 'sending');
--> statement-breakpoint
CREATE INDEX "notification_jobs_user" ON "notification_jobs" ("user_id", "kind", "state");

--> statement-breakpoint
CREATE FUNCTION cancel_changed_brief_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.morning_brief AND (
    NOT NEW.morning_brief OR OLD.brief_time IS DISTINCT FROM NEW.brief_time
    OR OLD.time_zone IS DISTINCT FROM NEW.time_zone
  ) THEN
    UPDATE notification_jobs SET state = 'canceled', updated_at = now()
    WHERE user_id = NEW.user_id AND kind IN ('brief', 'brief-email') AND state IN ('pending', 'running');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cancel_changed_brief_jobs
AFTER UPDATE OF morning_brief, brief_time, time_zone ON user_preferences
FOR EACH ROW EXECUTE FUNCTION cancel_changed_brief_jobs();

--> statement-breakpoint
CREATE TABLE "brief_valuations" (
  "user_id" text NOT NULL,
  "local_date" date NOT NULL,
  "wallet" text NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "value" jsonb NOT NULL,
  PRIMARY KEY ("user_id", "local_date", "wallet")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "asset_id" text NOT NULL,
  "ticker" text NOT NULL,
  "variant" text NOT NULL,
  "mint" text NOT NULL,
  "direction" text NOT NULL CHECK ("direction" IN ('above','below')),
  "target" numeric(24, 8) NOT NULL CHECK ("target" > 0),
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active','triggered','canceled')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "quote_at" timestamptz,
  "quote_price" numeric,
  "triggered_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_active_rule" ON "price_alerts" ("user_id", "mint", "direction", "target") WHERE "state" = 'active';
--> statement-breakpoint
CREATE INDEX "price_alerts_active_mint" ON "price_alerts" ("mint") WHERE "state" = 'active';
--> statement-breakpoint
CREATE INDEX "price_alerts_user" ON "price_alerts" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE "price_poll_cursor" (
  "mint" text PRIMARY KEY,
  "polled_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_budgets" (
  "scope" text NOT NULL,
  "minute" timestamptz NOT NULL,
  "used" integer NOT NULL,
  PRIMARY KEY ("scope", "minute")
);
