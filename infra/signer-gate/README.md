# Signer gate rollout

The gate is a separate API-image process on the current VPS. It has no published
port and is reachable from the API only on `signer-api`. Its database role can
change delegations, reservations and delegated execution state; the API runtime
role can read those records but cannot change their limits or signed bytes.
The shared VPS root account remains a shared risk. Move the gate and its key to
another host before broadening beyond the owner allowlist.

## Independent co-signing upgrade (migration 0014)

Deploy API, gate and web together with delegated signing disabled during the
upgrade. Apply migration `0014_independent_trade_authorization` as the migration
owner before starting the new services. It creates API-owned grant and
append-only authorization tables and revokes gate access; `roles.sql` preserves
the same separation when roles are provisioned again. Verify actual privileges
with the disposable-database role test before enabling signing.

Existing delegated grants are deliberately **not backfilled** from gate-owned
rows. Browser settings require the owner to revoke, remove wallet signers and
enroll again, then create a fresh OAuth execute connection. The new owner proof
is an Ed25519 wallet signature over exact permission terms, grant ID, quorum,
policy, expiry and action. The API retains the Privy session; it never forwards
that session token to the gate. Both services verify the bounded wallet proof.

Set the reviewed public GitHub repository variables `MCP_SIGNER_QUORUM_ID` and
`MCP_SIGNER_POLICY_ID` before building the production web image. They become
`NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID` and `NEXT_PUBLIC_MCP_SIGNER_POLICY_ID`; local
builds use the same names in `app/.env.local`. The quorum must match the API's
`PRIVY_MCP_SIGNER_QUORUM_ID` and the gate's `SIGNER_GATE_QUORUM_ID`; the policy must
match `SIGNER_GATE_POLICY_ID`. These identifiers are public, not private keys.
Missing or mismatched pins disable enrollment before Privy adds a signer.
Rotation requires a reviewed web rebuild; never populate these pins from a
runtime API response.

For every signature, the API independently validates the canonical Privy
envelope, owned intent, exact Jupiter transaction, protected accounts, raw
amounts, output floor and simulation, then locks its own grant and claims the
exact request against its own budget. Gate-side state cannot reset that budget.
An identical retry may reuse the same authorization; replacement bytes for an
already claimed intent are rejected.

API authorization charges are retained for the entire grant (at most 24 hours),
including uncertain or failed attempts. They are not released based on a gate
failure report. This is deliberately conservative; a safe independent refund
or reconciliation mechanism is separate future work. Browser settings report
the larger of gate reservations and independent API authorizations.

Buys derive microdollars from raw USDC units and reject inconsistent USD fields.
Sells derive shares from raw input and verified mint decimals, rejecting display
share mismatches. Migration's `NOT VALID` buy constraint checks all new/updated
rows without silently rewriting old financial intent data; source checks also
reject inconsistent legacy rows before signing.

Offline checks: `npm run test:mcp:guard`, focused `trade-budget.spec.ts`, and
`app/tests/mcp-grant-authorization.test.mjs`. With an explicitly configured local
`oren_mcp_test` Postgres, run `trade-budget.integration.spec.ts`, apply
`infra/signer-gate/roles.sql` using disposable role passwords, then run
`api/scripts/test-signer-gate-roles.mjs`. Never point these at production.

## Prepare the VPS while execution is disabled

Production access is through GitHub Actions. After the disabled release is
healthy, dispatch **Provision signer gate database roles** on `master` with
confirmation `provision-signer-gate-roles`, or push a one-time
`signer-gate-roles-*` tag pointing at that deployed master commit. The workflow pins the deployed SHA,
applies `roles.sql`, creates `.env.api` and a private
`.env.signer-gate.pending` database URL, restarts only the API, and verifies it
connects as `oren_api_runtime`. It never starts the gate or enables signing.
It refuses to overwrite existing runtime files; inspect the VPS before
retrying a failed run. The pending file is incomplete by design and must not be
renamed until the gate quorum, policy, owner allowlist and API token are set.

After that role workflow passes, **Bootstrap disabled signer gate** can be
dispatched with confirmation `bootstrap-signer-gate` or triggered once by a
`signer-gate-bootstrap-*` tag pointing at the deployed master commit. It
identifies the disposable wallet from the reviewed buy policy's exact token
accounts and a recent browser approval, verifies Privy has zero signers,
creates new independent P-256 API/gate keys and a 2-of-2 quorum, then stores
the keys only on the VPS. The API receives only its key; the gate receives only
its key and a separate database role. It starts the private gate with all
signing flags off and checks both database identities and the gate health
response. A failure after environment changes restores the prior API runtime
file and stops the gate. A created but unattached quorum may remain in Privy
after a failure; inspect the private bootstrap state before any retry.

Once the disabled gate passes its VPS checks, deploy the owner-trial release
with API and gate runtime flags still off. The **Enable owner-only delegated buy
trial** workflow or a one-time `signer-gate-owner-buy-*` tag rechecks Privy
policy, exact two-key quorum, zero wallet signers, owner allowlist and zero
reserved budget before changing flags. It enables buys only and rolls both
services back if activation fails. The owner must then add the signer from
browser settings and create a newly consented Claude execute connection. Keep
the first grant to 1 day, 1 USDC per trade and a small rolling cap because the
reviewed Privy policy itself caps each buy instruction at 1 USDC.

**Kill delegated buy trial** can be dispatched with confirmation
`kill-owner-buy` or a `signer-gate-kill-*` tag. It stops gate signing first,
turns API and gate flags off, and restarts the gate disabled so browser revoke
and reconciliation remain available. After a kill, remove the signer in the
browser; Privy removes every wallet signer. Check for unresolved reservations
and reconcile them before any new grant.

1. Apply all API migrations with the existing admin-only `.env` through
   `api-migrate`. Keep `MCP_DELEGATED_TRADES_ENABLED=false` and
   `SIGNER_GATE_ENABLED=false`.
2. Generate independent random passwords for `oren_api_runtime` and
   `oren_signer_gate`. Run `roles.sql` as the migration owner with psql variables
   `api_password` and `gate_password`. Do not place either on a command line or
   in a log. The provisioning workflow performs this step and stores the gate
   role URL only in the private pending file. Re-run the grants after future
   schema migrations.
3. Create `/opt/oren/.env.api` with the `oren_api_runtime` `POSTGRES_URL` and,
   when ready for the owner trial, only the API quorum key and gate URL/token.
   The later `.env.api` overrides `.env` in Compose. The API service blanks
   standalone `POSTGRES_USER`, `POSTGRES_PASSWORD`, and gate-private-key
   variables. Until `.env.api` exists, the existing API keeps using its old
   admin URL **only while delegated execution is disabled**. Verify the
   resolved API container uses `oren_api_runtime` before enabling signing.
4. Create `/opt/oren/.env.signer-gate` from `env.example`, mode `0600`, with the
   distinct `oren_signer_gate` Postgres URL and the gate quorum key. The API
   public key and gate private key must belong to the same reviewed 2-of-2
   Privy quorum; the policy owner must be a separate key. Put the policy's
   normalized semantic fingerprint in `SIGNER_GATE_POLICY_HASH`.
5. Create `.env.signer-gate` only after its credentials and restricted role are
   ready. Production deployment detects this file and includes the
   `delegated-trades` Compose profile on every release. Start it with the API
   execution flag and gate buy/sell flags off.
   Confirm `/health` from inside the API network and confirm there is no host
   port for the gate. The regular production deployment leaves this profile off.

Runtime flags and named allowlists gate signing; the source compile-time latch
is currently open. Keep execution flags off during this upgrade until migration,
role, enrollment and funded acceptance checks pass. PR previews always reject
delegated execution. The 2-of-2 unfunded proof alone is not a live-trading release.

### Opening delegated trading to all users

The original three-rule policy is a disposable, wallet-specific $1 TSLAx buy
proof. Public enrollment flags alone do not turn it into a public trading policy.
For public buy/sell access, prepare a **new** policy with
`trading-policy.mjs` and `prepare-trading-policy.mjs` in a one-off container.
Keep its separate owner key in a mode-600 provisioning file outside the running
API/gate mounts. Never update an enrolled policy in place to add selling.

The public policy uses 100-mint inline chunks because Privy rejects larger
`in` lists and does not support `in_condition_set` on these Jupiter IDL fields.
Shared deny rules cap the buy USDC input and sell quoted proceeds at $25,
slippage at 50 bps and platform fees at zero. Only compute-budget instructions
and approved stock/USDC Jupiter routes are allowed. Account-only IDLs preserve
the reviewed account order; full IDLs decode numeric limits. Every wallet,
ATA, stock notional, daily budget and grant expiry is still independently
verified by API and gate before either key authorizes signing.

Pin the provider-readback fingerprint, policy owner and new policy ID on the
gate; set matching `PRIVY_MCP_SIGNER_POLICY_ID` on the API and public
`MCP_SIGNER_POLICY_ID` build variable. Release the compatible API, gate and web
together. Older grants return `reenrollmentRequired`; users revoke/remove the
old signer, explicitly select Buy and sell, activate the new grant and reconnect
their agent. A buy-only grant must never be upgraded by a database edit.

The policy has a seven-day hard expiry in addition to each grant's 24-hour
maximum. Rotate it through the same reviewed rebuild/re-enrollment process
before that deadline. Provider policy creation/readback and offline tests do
not establish funded trade success; report live execution acceptance separately.
Use a fresh private `/state` directory for each rotation; an existing directory
is an idempotent checkpoint for one candidate, including its fixed expiry.

Set `MCP_DELEGATED_TRADES_PUBLIC=true` on the API **and** `SIGNER_GATE_PUBLIC=true`
on the gate. Each service checks its own flag, so both must agree before any
non-allowlisted user can enroll or trade; with either flag off, the named
allowlists apply as before. A `*` allowlist entry is rejected on both services.
Public access lifts only the allowlist: every grant still needs the owner's
wallet-signed terms, the $25 per-trade and $50 daily ceilings, 0.5% slippage,
24-hour expiry, the tradable-stock check and the two-key quorum all still apply.
Turn the flags off to return to the allowlist without a redeploy of code.

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
If Privy removal fails after the gate revokes a grant, retry removal from the
same settings session or use the wallet's Privy signer controls. The gate stays
revoked, and a fresh grant cannot enroll until Privy reports zero signers.
