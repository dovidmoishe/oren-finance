CREATE TABLE admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_master boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('invited', 'active', 'revoked')),
  must_change_password boolean NOT NULL DEFAULT true,
  temp_password_expires_at timestamptz,
  temp_password_used_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES admin_accounts(id),
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE TABLE admin_permissions (
  account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('reports.read', 'dashboard.access')),
  PRIMARY KEY (account_id, permission)
);
--> statement-breakpoint
CREATE TABLE admin_sessions (
  id_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE TABLE admin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX admin_login_attempts_subject_idx ON admin_login_attempts (subject_hash, created_at);
--> statement-breakpoint
CREATE TABLE admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON admin_accounts, admin_permissions, admin_sessions,
    admin_login_attempts, admin_audit_events FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON admin_accounts, admin_permissions,
      admin_sessions, admin_login_attempts, admin_audit_events TO oren_api_runtime;
  END IF;
END $$;
