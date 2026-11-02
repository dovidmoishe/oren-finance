# Signer gate rollout

The gate is a separate API-image process on the current VPS. It has no published
port and is reachable from the API only on `signer-api`. Its database role can
change delegations, reservations and delegated execution state; the API runtime
role can read those records but cannot change their limits or signed bytes.
The shared VPS root account remains a shared risk. Move the gate and its key to
another host before broadening beyond the owner allowlist.

## Prepare the VPS while execution is disabled

1. Apply all API migrations with the existing admin-only `.env` through
   `api-migrate`. Keep `MCP_DELEGATED_TRADES_ENABLED=false` and
   `SIGNER_GATE_ENABLED=false`.
2. Generate independent random passwords for `oren_api_runtime` and
   `oren_signer_gate`. Run `roles.sql` as the migration owner with psql variables
   `api_password` and `gate_password`. Do not place either on a command line or
   in a log. Re-run the grants after future schema migrations.
3. Create `/opt/oren/.env.api` from the existing API runtime settings. Replace
   `POSTGRES_URL` with the `oren_api_runtime` connection URL. Remove
   `POSTGRES_USER`, `POSTGRES_PASSWORD`, the migration/admin Postgres URL,
   `SIGNER_GATE_PRIVATE_KEY`, and any policy-owner key. Keep only the API
   quorum key in `PRIVY_MCP_SIGNER_PRIVATE_KEY`.
4. Create `/opt/oren/.env.signer-gate` from `env.example`, mode `0600`, with the
   distinct `oren_signer_gate` Postgres URL and the gate quorum key. The API
   public key and gate private key must belong to the same reviewed 2-of-2
   Privy quorum; the policy owner must be a separate key. Put the policy's
   normalized semantic fingerprint in `SIGNER_GATE_POLICY_HASH`.
5. Start the `delegated-trades` Compose profile with the API execution flag
   and gate buy/sell flags off.
   Confirm `/health` from inside the API network and confirm there is no host
   port for the gate. The regular production deployment leaves this profile off.

The API startup still rejects `MCP_DELEGATED_TRADES_ENABLED=true` until the
route and funded-wallet release gate is explicitly opened in code. PR previews
always reject delegated execution. The 2-of-2 unfunded proof alone is not a
live-trading release.

## Request and retry states

- `challenged`: the gate has built and simulated a fresh exact-mint Jupiter
  transaction, atomically reserved budget, and stored a 30-second canonical
  Privy request. Only the API key may sign that exact challenge. An expired
  challenge that never reached Privy can be reconciled as a definite failure.
- `signing` or `pending` without signed bytes: Privy may have signed even if
  its response timed out. Do not build new bytes or release the reservation.
  Inspect Privy request/idempotency logs and the wallet's chain history, then
  resolve manually. The API returns pending to MCP.
- `signed`, `broadcast` or `pending` with signed bytes: the database contains
  the only transaction allowed for this intent. Reconcile the saved chain
  signature first. If the blockhash is still valid, rebroadcast only those
  bytes. Never re-quote or replace the transaction.
- `confirmed`: consume budget. A confirmed chain failure may release budget.
  An absent chain status or expired blockhash alone is ambiguous and stays
  pending for review.

The reservation and execution row commit in one transaction. Check this
invariant during deployment and after a crash:

```sql
SELECT r.id, r.intent_id, r.created_at, i.status
FROM mcp_budget_reservations r
JOIN mcp_trade_intents i ON i.id = r.intent_id
LEFT JOIN mcp_delegated_executions e ON e.intent_id = r.intent_id
WHERE r.status = 'reserved' AND e.id IS NULL;
```

Inspect and reconcile every row before a rollout or kill-switch drill. Do not
delete reservations to clear the count. Turn off the API execution flag and
gate buy/sell flags for a kill switch; keep the gate container available for
revoke and reconcile requests. Privy `removeSigners` removes **all** signers on
that wallet; only enroll wallets with zero existing signers, and warn the owner
before browser revocation.
