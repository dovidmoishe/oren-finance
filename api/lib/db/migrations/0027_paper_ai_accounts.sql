CREATE TABLE paper_ai_screens (LIKE paper_market_screens INCLUDING ALL);
--> statement-breakpoint
CREATE TABLE paper_ai_accounts (LIKE paper_market_accounts INCLUDING ALL);
--> statement-breakpoint
ALTER TABLE paper_ai_accounts RENAME COLUMN policy TO account_id;
