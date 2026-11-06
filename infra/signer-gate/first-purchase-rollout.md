# Delegated first-purchase rollout

The delegated route accepts at most one Associated Token Account `CreateIdempotent`
(data byte `1`, six accounts), before the single Jupiter shared-account route.
Both signing services independently derive the destination from the authenticated
wallet, reviewed output mint and on-chain mint owner (Token or Token-2022).
The payer and owner must be that wallet. The source account must already exist.
All creation accounts remain static, and simulation still enforces the original
input/output limits and existing SOL fee/rent caps. No arbitrary transfers,
source-account creation, extra signers or extra setup instructions are allowed.
Before reserving a trade, the gate checks that its fingerprint-verified policy
also covers creation for this output mint. An old swap-only policy retains
browser fallback rather than causing a rejected signing call and pending budget.

Policy generation preserves existing behavior unless the operator explicitly
passes `--allow-destination-account-creation` to `prepare-trading-policy.mjs`.
This generates a NEW six-rule candidate: the existing four swap/expiry rules
plus mint-restricted stock and USDC idempotent-creation rules. Never update an
already enrolled production policy in place. Use the SAME reviewed launch-mint
file and reviewed expiry; this change does not authorize mint-list or duration
expansion. Keep the new policy unattached until readback/fingerprint verification
and isolated unfunded sign-only proof pass.

Before deployment, verify Privy's one-byte ATA discriminator decoder with a real
idempotent instruction. Confirm valid first buys/sells sign unchanged, and wrong
mints, wrong programs, non-idempotent/nested-recovery instructions, excess spend,
slippage and platform fees are rejected. The API and gate must additionally
reject wrong payer/owner/destination; the static policy alone cannot bind those
to the current user's intent. Then coordinate the new policy ID/hash across API,
gate and web build pins, and require renewed wallet consent and agent connection.
Existing grants cannot silently gain the new authorization.

This change does **not** sponsor gas or fund wallets. The user's wallet remains the
sole transaction signer and fee/rent payer. It needs enough SOL for the network
fee and creation rent; an unfunded simulation is not a successful funded trade
check. Privy sponsorship needs separate integration/verification, including rent
coverage, payer signatures, budget controls and the current 2-of-2 sign-only flow.
Do not launch a zero-SOL promise based on this change alone.
