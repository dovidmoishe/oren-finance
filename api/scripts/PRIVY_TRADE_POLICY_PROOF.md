# Privy delegated trade policy proof

## Single-key policy result: whole-transaction cap failed

On 2026-11-02, the owner granted a proof-only signer to an unfunded disposable
embedded Solana wallet. Privy read-back confirmed exactly one additional signer
and the intended owner-protected Jupiter buy policy. No proof transaction was
broadcast.

The sign-only probes produced these results:

| Candidate | Privy result |
| --- | --- |
| Message signing, SOL transfer, SPL transfer | `policy_violation` |
| One reviewed Jupiter shared-account USDC to Token-2022 xStock buy | Signed |
| Input above 1 USDC, slippage above 50 bps | `policy_violation` |
| Wrong input/output mint or source/destination token account | `policy_violation` |
| Reviewed route plus SOL transfer | `policy_violation` |
| **Two reviewed 1 USDC routes in one transaction** | **Signed** |

The policy evaluates each Jupiter instruction separately. [Privy's policy
overview](https://docs.privy.io/controls/policies/overview) says every Solana
instruction is evaluated against the rules. It does not cap the sum of input
across a transaction, so it cannot satisfy Oren's per-trade input bound.
[Stateful policy aggregations](https://docs.privy.io/controls/policies/stateful-policies)
currently list Ethereum signing methods only and are not a proven Solana fix.
A server check of instruction count in the same process as a single trade key
does not protect against that process misusing the key. The revised design uses
a separate signer gate and a Privy 2-of-2 key quorum. Keep headless execution
disabled until the funded Jupiter trial and deployment gates pass. Titan stays
on browser approval until its own route proof passes.

The owner revoked the proof signer in the browser after the failed gate.
Privy read-back showed zero additional signers and no delegation; the wallet
still held zero SOL. Privy's removal operation removes every signer on the
wallet. The temporary browser proof page was removed from the PR after this
drill.

## Two-key sign-only result: unfunded Jupiter buy passed

On 2026-11-02, new API and gate P-256 keys were registered as a 2-of-2 Privy
signer quorum. The policy-owner quorum remained separate. The owner granted the
new quorum and the exact reviewed Jupiter buy policy to the same unfunded
disposable wallet using the preview browser. Privy read-back confirmed one
additional signer and the expected policy. The wallet held 0 SOL.

The gate decoded a fresh real Jupiter shared-account USDC to Token-2022 TSLAx
buy, including its address lookup table, and rejected a transaction with two
routes before either key signed. Privy denied the API key alone and gate key
alone with 401. Both keys signed one reviewed sign-only buy. Independently
generated signatures over the same canonical Privy request also signed the
identical message. Privy denied message signing, SOL and SPL transfers, and
policy updates by the trade keys; a separate policy-owner key passed a no-op
control update. No trade was broadcast.

The owner then removed the proof signer in the browser. Privy read-back showed
zero signers and no delegation; public RPC still showed 0 SOL. The temporary
preview proof page was removed. The unfunded key-quorum proof does **not**
establish a funded buy, sell, or Titan route. The compile-time and runtime
headless execution flags remain off.

## Reproduce the sign-only checks

The scripts use `PROOF_WALLET_EMAIL`, `PROOF_WALLET_ADDRESS`, the Privy app
credentials and Solana RPC credentials from the local environment. Proof keys
and policy metadata live only in ignored `api/.proof/`. The scripts refuse to
run when the wallet has a SOL balance.

1. Run `test-proof-signer-denials.mjs` with
   `PROOF_TEST_SIGNER_DENIALS=true`.
2. Run `test-proof-jupiter-buy-policy.mjs` with
   `PROOF_TEST_JUPITER_BUY_POLICY=true`.

The second script intentionally exits nonzero when Privy signs the two-route
transaction. Its JSON result reports `proofPassed: false`. Retain that check
in any revised policy proof.

For the two-key proof, use `PROOF_TWO_KEY=true` with
`test-proof-two-key-signing.mjs`, `test-proof-signer-denials.mjs`, and
`test-proof-policy-owner.mjs`. These require the exact new signer/policy
read-back and an unfunded wallet. The gate's real transaction validator is
also exercised by `check-jupiter-gate-transaction.mjs` and its focused tests.
