CREATE TABLE IF NOT EXISTS prediction_creation_drafts (
 id uuid PRIMARY KEY, wallet text NOT NULL, version integer NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS prediction_creation_wallet_idx ON prediction_creation_drafts(wallet);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prediction_creation_versions (
 id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES prediction_creation_drafts(id),
 version integer NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT prediction_creation_version_idx UNIQUE(draft_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prediction_creation_attempts (
 id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES prediction_creation_drafts(id),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS prediction_creation_attempt_draft_idx ON prediction_creation_attempts(draft_id);
