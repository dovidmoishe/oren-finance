# Reviewed trade platform fees

OFF by default. Fees help cover Oren-paid gas sponsorship and associated token
account rent. They are independent of PRIVY_REVIEWED_GAS_SPONSORSHIP and
ATA_RENT_SPONSORSHIP; a fee does not promise either subsidy.

## Enable

1. Create or confirm an existing, initialized classic SPL Token USDC account for
   Dave's own receive-only wallet. Its mint must be
   EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v and its program must be the classic
   Token program, not Token-2022. Oren never creates or funds this account.
2. Apply migration 0024_platform_fees.sql through the existing migration runner.
   Like 0023, it adds SQL and a journal entry; no incremental snapshot is added.
3. Set PLATFORM_FEE_BPS=50 and PLATFORM_FEE_USDC_ACCOUNT to that token account.
   Alternatively set PLATFORM_FEE_OWNER to derive the owner's classic USDC ATA.
   If both are set they must agree. No destination is built into the code.
4. Recreate the API service to load the configuration. Set PLATFORM_FEE_BPS=0
   and recreate the API to disable fees everywhere.

PLATFORM_FEE_BPS accepts integers 0..255 and defaults to 0. Invalid settings,
missing destinations and mismatched account/owner settings disable the fee with
one sanitized startup warning. Configuration validates addresses and ATA derivation
locally; operators must confirm account initialization, Token program ownership
and the USDC mint before enabling. There is no background RPC validation.

## Coverage and routing

Reviewed in-app and MCP browser-review market swaps pay the same bps, including
each basket leg. Only pairs with exactly one classic USDC side qualify. Buys
take the fee from the input budget; sells take it from output. Output amounts,
reviewed floors, route comparisons and balance simulations use net amounts.
Provider amounts are retained without subtracting fees a second time.

Jupiter Swap API v1 receives platformFeeBps on quote and feeAccount on every
swap attempt, including both retry paths. Reviewed fee-bearing transactions have
their ExactIn Jupiter route fee bps and destination checked against the pinned
quote, resolving lookup tables independently. Unsupported instruction formats
require a fresh compatible quote. Simulation checks input/output balances and
receipt of the fee at the configured destination. Cached quotes cannot adopt
a new rate or destination when configuration changes. Approval JSON stores the
public fee details; executions store nullable bps, raw USDC amount and mint.

TITAN_PLATFORM_FEE_ENABLED defaults to false. When a reviewed trade owes a fee
and Titan fee support is off, the router uses Jupiter only, including shadow
mode. This avoids comparing a fee-free Titan route with a fee-bearing Jupiter
route. Enable the flag only after Titan validates the fee account. With it on,
both venues receive identical fees, Titan buys set feeFromInputMint=true, and
the router compares provider net outputs and network costs as before. Titan's
returned swap instructions are passed through unchanged; recipient availability
and net balances are still checked before browser signing. Missing or mismatched
provider fee metadata is rejected rather than silently dropping the fee.

## Exclusions

Agent/delegated/automatic signing stays exactly fee-free. The existing
delegated-jupiter-guard, signer gate and enrolled Privy policy remain unchanged.
Charging delegated trades requires a new signer policy with platform_fee_bps
eq N and platform_fee_account pinned, plus explicit user re-consent. Browser
review of an agent's proposal is a separate user-reviewed flow.

Jupiter Trigger limit orders and withdrawals are unchanged and are not covered.

## Provider references

- [Jupiter Swap v1 fee parameters](https://github.com/jup-ag/docs/blob/main/swap/v1/add-fees-to-swap.mdx)
- [Titan fee request and response types](https://github.com/Titan-Pathfinder/titan-sdk-ts/blob/main/src/types/v1.ts)

The offline suites validate request serialization, unsigned transactions,
simulation results and stored records. No funded trade or live provider fee
collection is part of this rollout.
