CREATE TABLE IF NOT EXISTS paper_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, asset_id text NOT NULL,
 strategy text NOT NULL, mint text NOT NULL, active boolean NOT NULL DEFAULT true,
 book jsonb NOT NULL, liquidation_equity_usdc_raw text, last_bar bigint, revision integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(), valued_at timestamptz DEFAULT now(), last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS paper_runs_owner_asset_strategy ON paper_runs(owner_id,asset_id,strategy);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS paper_runs_due ON paper_runs(next_at) WHERE active;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS paper_events (
 run_id uuid NOT NULL REFERENCES paper_runs(id), bar_time bigint NOT NULL,
 observed_at timestamptz NOT NULL, evidence jsonb NOT NULL, PRIMARY KEY(run_id,bar_time)
);
