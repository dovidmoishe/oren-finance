# Reviewed-buy ATA rent sponsorship

This feature is OFF by default. It pays for a separate, single-instruction idempotent
associated token account creation before returning a prepared direct stock BUY.
It does not modify Jupiter or Titan swap bytes, Privy App-pays gas sponsorship,
approval authorization, signer-gate policies, or sell behavior. Users may still
need SOL for other account costs on routes that require them. A fallback retains
the existing user-paid setup path and does not show an error to the user.

## Configuration

Set these only in the API environment; no client, MCP, or signer-gate switches are needed.

- `ATA_RENT_SPONSORSHIP=false`: master kill switch. Off performs no sponsor RPC, DB, or signing work.
- `ATA_RENT_SPONSOR_SIGNER=privy`: currently the only implementation of the injectable signer interface.
- `ATA_RENT_SPONSOR_PRIVY_WALLET_ID`: dedicated application-controlled Privy Solana server-wallet ID.
- `ATA_RENT_SPONSOR_ADDRESS`: its matching public address; checked against Privy before signing.
- `ATA_RENT_MIN_TRADE_USDC=5`: exact USDC input minimum (up to six decimal places).
- `ATA_RENT_PER_USER_CAP=5`: lifetime reservation cap across all of a user's wallets.
- `ATA_RENT_DAILY_BUDGET_SOL=0.1`: global UTC-day budget, including rent and transaction fees.
- `ATA_RENT_SPONSOR_MIN_BALANCE_SOL=0.02`: retained balance floor; estimated setup cost must also fit.
- `ATA_RENT_CONFIRM_TIMEOUT_MS=8000`: total preparation overhead deadline, maximum 30000 ms.

The existing `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ALCHEMY_API_KEY`, and
`SOLANA_NETWORK` configure the signer and RPC. Preview financial execution remains
disabled. An invalid master boolean follows existing environment validation.
Other missing/invalid subsidy settings make sponsorship unavailable and emit one
sanitized startup warning, rather than preventing ordinary trading.

## Admission and recovery

Only authenticated direct browser stock quotes with a server-supplied reviewed
user identity qualify. Agent, MCP (including their browser review), delegated,
basket/copy, sell, and limit flows do not qualify. The mint account owner selects
SPL Token or Token-2022; ATA derivation and creation use that same program.
Token-2022 rent includes ImmutableOwner and mint-required account extensions.
Swaps with non-idempotent ATA setup or an unresolved instruction program ID remain
on the existing user-paid path: precreating an account must never invalidate
unchanged provider instructions.
The user's USDC ATA must hold the whole exact routed input.

Apply migration `0023_ata_rent_sponsorships.sql` using the existing DB migration
runner before enabling. A transaction-scoped global advisory lock serializes
pair, lifetime cap, and budget admission across instances; the unique wallet/mint
index is a second safeguard. No RPC or signing happens under that lock.
`lamports` is a conservative rent-plus-fee reservation, not a claim of actual
onchain expenditure. Reserved, sponsored, and failed rows all consume lifetime
capacity and daily budget. Recent reservations also carry across UTC midnight
for five minutes to cover a still-live transaction. Five-minute-old reservations
are lazily marked failed on the next admission. Never delete attempts, recycle
pairs, or automatically refund uncertain reservations; closing an account never
earns another subsidy.

The signer only signs; Oren validates the exact message and signature, saves the
signature before RPC broadcast, then polls confirmed status or ATA existence.
All RPC and Privy fetches are aborted at the total deadline, with additional abort
checks before each mutation. An uncertain send/timeout never triggers a new setup
transaction. A crash after signing but before broadcast may consume a reservation
without spending SOL; this deliberately favors abuse prevention over retries.
Inspect the saved signature onchain to reconcile uncertain attempts. There is no
automatic reconciliation worker or retry that could spend more funds.

Events use Nest structured logging: `ata_rent_sponsored`, `ata_rent_skipped`
(reason enum), `ata_rent_failed`, `ata_rent_unavailable`, and
`ata_rent_low_balance` (warning at most once per minute per instance).
Skip events are debug level. Events never contain addresses or provider error
bodies. Only the prepare response and persisted approval details carry
`ataRentSponsored: true` after successful setup. The review translates
`Account setup: Covered by Oren` in every supported locale.

## Provisioning and rollout questions

An operator must provision a dedicated application-controlled Solana server wallet
through Privy's dashboard or wallet creation API, fund it with a bounded amount
of SOL, and supply its ID/address. This implementation expects application
authentication to authorize that wallet; a user-owned wallet or a quorum requiring
additional authorization keys is unavailable with this signer. No provisioning,
funding, policy creation, or production configuration is performed by this change.

Privy documents default-deny policies and per-instruction Solana evaluation:
[policy overview](https://docs.privy.io/controls/policies/overview).
Before rollout, verify whether the deployed policy engine can restrict this server
wallet's `signTransaction` to the Associated Token Program's CreateIdempotent
instruction, exact payer/owner/mint account positions, and both token programs.
A program-only allowlist may also allow undesired associated-token instructions;
do not claim it proves ATA-creation-only authorization. Provisioning ownership,
supported policy conditions, funding limits, and policy enforcement on disposable
wallets remain operator decisions.

Run `node --test scripts/test-ata-rent.mjs` in `api/` for offline real-SDK transaction
and Privy request checks, in addition to the standard Jest and authorization suites.
No test needs credentials or contacts a real RPC/Privy endpoint.

## Platform fee revenue

Reviewed market swaps can independently collect an Oren USDC fee to help cover
sponsorship costs. It defaults off, has broader reviewed-trade coverage than the
ATA subsidy, and does not change subsidy admission. See [platform fees](platform-fee.md)
for PLATFORM_FEE_BPS, PLATFORM_FEE_USDC_ACCOUNT, PLATFORM_FEE_OWNER and
TITAN_PLATFORM_FEE_ENABLED.
