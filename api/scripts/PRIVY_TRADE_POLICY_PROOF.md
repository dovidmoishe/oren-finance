# Privy delegated trade policy proof

## Current result: live headless gate failed

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
A server check of instruction count is necessary but does not repair the Privy
signer policy if the trade signer key is misused. Do not fund this wallet
for a delegated trial or enable headless execution with this policy. Keep
Jupiter and Titan on browser approval until a Privy-enforced aggregate input or
single-route constraint is proven, including Token-2022 and lookup-table cases.

The owner revoked the proof signer in the browser after the failed gate.
Privy read-back showed zero additional signers and no delegation; the wallet
still held zero SOL. Privy's removal operation removes every signer on the
wallet. The temporary browser proof page was removed from the PR after this
drill.

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
