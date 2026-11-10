CREATE TABLE IF NOT EXISTS "trade_email_preferences" (
  "user_id" text PRIMARY KEY NOT NULL,
  "trade_receipts_enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "trade_receipt_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "execution_id" uuid NOT NULL REFERENCES "executions"("id"),
  "transaction_signature" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trade_receipt_jobs_status_check"
    CHECK ("status" IN ('pending', 'processing', 'retry', 'completed', 'dead'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "trade_receipt_jobs_execution_idx"
  ON "trade_receipt_jobs" ("execution_id");
CREATE INDEX IF NOT EXISTS "trade_receipt_jobs_available_idx"
  ON "trade_receipt_jobs" ("status", "available_at");
