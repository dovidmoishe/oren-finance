CREATE TABLE IF NOT EXISTS paper_ai_screens (LIKE paper_market_screens INCLUDING ALL);
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('paper_ai_accounts') IS NULL THEN
    CREATE TABLE paper_ai_accounts (LIKE paper_market_accounts INCLUDING ALL);
    ALTER TABLE paper_ai_accounts RENAME COLUMN policy TO account_id;
  END IF;
END $$;
