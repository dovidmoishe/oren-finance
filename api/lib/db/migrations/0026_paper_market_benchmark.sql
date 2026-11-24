CREATE TABLE paper_market_screens (
  epoch integer PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  universe jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE paper_market_accounts (
  policy text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  epoch integer NOT NULL DEFAULT -1,
  revision integer NOT NULL DEFAULT 0,
  last_error text,
  next_at timestamptz NOT NULL DEFAULT now(),
  state jsonb NOT NULL,
  rounds jsonb NOT NULL DEFAULT '[]'
);
