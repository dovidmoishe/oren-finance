-- Run as the migration/admin database role with psql variables
-- api_password and gate_password. Never store either password in Git.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE oren_api_runtime LOGIN PASSWORD %L', :'api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') \gexec
SELECT format('CREATE ROLE oren_signer_gate LOGIN PASSWORD %L', :'gate_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_signer_gate') \gexec
ALTER ROLE oren_api_runtime PASSWORD :'api_password';
ALTER ROLE oren_signer_gate PASSWORD :'gate_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO oren_api_runtime, oren_signer_gate', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO oren_api_runtime, oren_signer_gate;

-- The API keeps normal application writes but cannot alter grant limits,
-- budget reservations, signer-gate requests, or delegated execution state.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oren_api_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oren_api_runtime;
-- One-time ALL TABLES grants do not cover tables created later. Defaults apply
-- to objects this role creates after this statement. api-migrate also sets
-- them for the production owner role `oren`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oren_api_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO oren_api_runtime;
-- API's independent approvals must survive a gate compromise. Append-only
-- authorizations cannot be erased to reset the API's own spend accounting.
REVOKE ALL ON mcp_api_trade_grants, mcp_api_trade_authorizations FROM PUBLIC, oren_signer_gate;
REVOKE DELETE, TRUNCATE ON mcp_api_trade_grants FROM oren_api_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON mcp_api_trade_authorizations FROM oren_api_runtime;
REVOKE ALL ON mcp_trade_delegations, mcp_budget_reservations,
  mcp_delegated_executions, mcp_audit_events FROM oren_api_runtime;
GRANT SELECT ON mcp_trade_delegations, mcp_budget_reservations,
  mcp_delegated_executions, mcp_audit_events TO oren_api_runtime;
REVOKE ALL ON mcp_trade_intents FROM oren_api_runtime;
GRANT SELECT, INSERT ON mcp_trade_intents TO oren_api_runtime;
GRANT UPDATE (approval_id, mode, delegation_id, status) ON mcp_trade_intents TO oren_api_runtime;

-- Browser approval must still be able to claim an intent. The API role may
-- convert a prepared delegated intent to browser review only before any
-- reservation exists; it cannot re-open a claimed delegated trade.
CREATE OR REPLACE FUNCTION guard_api_trade_intent_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'oren_api_runtime' THEN
    IF OLD.mode = 'delegated' THEN
      IF OLD.status <> 'prepared' OR NEW.mode <> 'browser'
         OR NEW.status <> 'prepared' OR NEW.delegation_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM mcp_budget_reservations
           WHERE intent_id = OLD.id
         ) THEN
        RAISE EXCEPTION 'API cannot change a claimed delegated intent';
      END IF;
    ELSIF NEW.mode <> 'browser' OR OLD.status <> 'prepared'
       OR NEW.status <> 'executing' OR NEW.approval_id IS NULL THEN
      RAISE EXCEPTION 'API can only claim a prepared browser intent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_api_trade_intent_update ON mcp_trade_intents;
CREATE TRIGGER guard_api_trade_intent_update
BEFORE UPDATE ON mcp_trade_intents
FOR EACH ROW EXECUTE FUNCTION guard_api_trade_intent_update();

GRANT SELECT ON mcp_connections, mcp_trade_intents, mcp_trade_delegations,
  mcp_budget_reservations, mcp_delegated_executions TO oren_signer_gate;
GRANT INSERT, UPDATE ON mcp_trade_delegations, mcp_budget_reservations,
  mcp_delegated_executions TO oren_signer_gate;
GRANT UPDATE (status, idempotency_key, execution_error) ON mcp_trade_intents
  TO oren_signer_gate;
GRANT INSERT ON mcp_audit_events TO oren_signer_gate;
