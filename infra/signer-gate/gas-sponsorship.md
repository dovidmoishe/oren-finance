# Trade gas sponsorship

Native Privy App-pays sponsorship is implemented behind independent switches.
This branch does not change production configuration, policies, wallets or grants.
No SDK upgrade, new MCP tool, user step or database migration is required.

## Scope and authorization

- Eligible user-reviewed swap, limit-open and limit-cancel approvals use the same
  review and wallet authorization flow. Withdrawals and vault operations stay on
  their existing path. Transactions with existing signatures, extra required
  signers, excessive packet size or top-level SPL CloseAccount instructions stay
  on the existing user-paid path; review continues to show the actual user fee.
- MCP retains the same propose/execute/status tools, two-party signatures,
  independently checked grants and ledgers, Jupiter-only instruction validation,
  asset allowlist, spend/slippage limits, revocation and quote refresh behavior.
  A legacy sign-only policy continues to use sign-only even with sponsorship
  enabled. An ineligible route also retains sign-only before any signing attempt.
  The API independently refuses sponsored requests unless opted in.
- The authorization covers `signAndSendTransaction`, `sponsor: true`, Solana
  mainnet CAIP-2, a unique reference/idempotency ID, the original transaction and
  request expiry. Neither the assistant nor the MCP client supplies these bytes.

## Preparation and confirmation

The RPC preflight uses a separate **public** funded system account as the fee
payer in an unsigned simulation only. It preserves every instruction account,
including the user's ATA rent payer. It never signs, funds or broadcasts that
simulation. The account must have at least 0.01 SOL and cannot overlap static
trade accounts. Use an operator-selected stable public account; no private key
is needed or used. Balance checks still enforce the reviewed input/output and
SOL rent allowance; network fees above 0.002 SOL reject sponsorship.

Eligible approvals report zero network gas payable by the user. Token account
creation rent and native SOL trade inputs are separate and still need wallet
funds. This is not a promise of zero-SOL first purchases. Multisigner/pre-signed
limit transactions are intentionally ineligible because changing their message
would invalidate the other signatures.

Privy signs and broadcasts in one request. Oren claims the approval/execution
durably before that call and saves the returned chain hash immediately. It does
not subsequently broadcast the unsigned or simulation transaction. On-chain
confirmation verifies both signatures and requires the same program IDs,
instruction data, account identities and privileges, permitting only the separate
fee payer and blockhash rewrite (and the user's implicit fee-payer writability).
Only then does Oren mark success, settle delegated budget or record a fill.

After a timeout or crash, status polling reads Privy's `/v1/transactions` by
reference ID and checks the wallet, chain, sponsorship and reference identity.
It does not send again, change keys or fall back to a user-paid trade. Empty or
unavailable lookup results stay pending, including after the original blockhash
expires: Privy replaced that blockhash. Explicit pre-submission 400/401/403/404/422
rejections can release the attempt; ambiguous errors and 409 retain it. Pending
attempts with no recoverable provider record need operator reconciliation;
never tell users to create a replacement until the outcome is established.

## Rollout

1. Verify TEE execution, Solana mainnet App-pays sponsorship and billing in Privy.
   Configure Privy's per-wallet/per-user/rate and budget controls. Do not enable
   client-side sponsorship; Oren routes these requests through its servers.
2. For reviewed trades, configure `PRIVY_GAS_SIMULATION_PAYER` and opt in with
   `PRIVY_REVIEWED_GAS_SPONSORSHIP=true` in the API environment.
3. For MCP, first prepare a **new, unattached** candidate with the existing
   `prepare-trading-policy.mjs --gas-sponsorship` option and the same reviewed
   mint, expiry, account-creation and spend settings. The candidate retains all
   sign-only rules and adds identical bounded `signAndSendTransaction` copies,
   including expiry DENYs. Never edit an enrolled policy in place.
4. Read back/fingerprint the candidate and prove the native sponsored method's
   instruction policy enforcement in an isolated disposable wallet. Exercise
   allowed buy/sell routes and reject wrong mint, authority, recipient, spend,
   slippage, fees, extra instruction and expired/revoked grant cases. This native
   provider acceptance proof is not a local mocked test and is still required.
5. Coordinate the reviewed policy ID/hash across API, gate and web build pins.
   Any adoption of a different policy requires the existing renewed consent and
   connection flow. Do not rotate the active pins merely to turn on the flags:
   that would interrupt old grants. Current grants cannot silently gain a new
   signing permission. The legacy-policy path is unchanged until this rollout.
6. Opt in independently with `PRIVY_MCP_GAS_SPONSORSHIP=true` on the API and
   `SIGNER_GATE_GAS_SPONSORSHIP=true` on the gate; set the public simulation
   payer on both. A missing or unfunded simulation payer fails before signing.
7. Validate eligible buy/sell, existing/missing ATA, fee display, confirmation,
   quota settlement and recovery after a dropped HTTP response in the isolated
   environment before a production rollout. Do not widen spend or permissions.

Switching sponsorship off changes new preparations; already claimed sponsored
attempts still reconcile read-only. No operator should clear their reservation
based on wall-clock expiry or replay a request after Privy's 24-hour idempotency
window. No production change is performed by the application test suites.

Primary references:
[setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup),
[fee-payer behavior](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview),
[transaction handling](https://docs.privy.io/wallets/gas-and-asset-management/gas/transaction-handling),
[reference lookup](https://docs.privy.io/api-reference/transactions/external-id),
[idempotency](https://docs.privy.io/api-reference/idempotency-keys),
[sponsorship controls](https://docs.privy.io/wallets/gas-and-asset-management/gas/security).
