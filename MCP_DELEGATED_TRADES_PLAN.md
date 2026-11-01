# Build plan: delegated trade signing from Claude/agent chats

> **Status:** browser buy/sell intents, delegation/reservation schema, exact-mint fresh quote path and disabled execution-scope consent foundations are implemented on PR #18. Enrollment and signing remain unimplemented; startup rejects enabling delegated trades until route-level proof. Updated 1 Nov 2026 (WAT, UTC+1).
> **Audience:** Codex, implementing in this repo. Read `AGENTS.md` (money-move rule, line 39) and `MCP_PRIVY_AUTH.md` §6.6 first; this plan implements that contract.
> **Legend:** **[doc]** = read on the cited docs.privy.io page on 1 Nov 2026. **[unverified]** = my understanding, not confirmed on a primary source; Phase 0 must prove it. **[code]** = read in this repo.

---

## Implementation update (1 Nov 2026)

- Migration `0009_mcp_trade_sides.sql` adds side, stock mint, share amount, and raw input/output bounds to MCP intents. `prepare_trade` can now prepare buys or sells for browser review; the review and API approval checks bind sells to the mint, shares, and raw input. `prepare_buy` remains available. No delegated signing or broadcast was added.
- The remaining delegation schema starts at migration `0010`, not `0009`. A live route requires a disposable-wallet proof that Privy enforces input amount, mint, destination, and expiry for that provider. Tier 1 program-only policies are insufficient for live headless trades; unsupported providers use browser approval.
- Sell budgets must cap the prepared share input and use an independent stock reference valuation. Count the greater of reference value and quoted USDC proceeds against per-trade and rolling-day limits.
- PR previews keep financial execution disabled. With the trusted controller from PR #20 installed and this branch rebased onto that change, they can exercise password-gated MCP OAuth, preparation and browser review through a controlled client. External Claude cannot traverse the gateway without its session; the isolated Privy policy and real signing proof must run separately.
- The owner approved using the existing production Privy app for Phase 0, but only with a newly created disposable user and embedded Solana wallet. The test account was not yet present in the configured app at the first read-only lookup. Never enroll or remove signers on an existing user wallet; the route proof and negative tests remain mandatory before enabling headless signing.
- Source-IDL review found that Jupiter's `route`/`routeV2` accounts omit a named source mint and source token account, while `sharedAccountsRoute`/`sharedAccountsRouteV2` name both source and destination mints/accounts ([Solana Foundation Jupiter v6 IDL](https://github.com/solana-foundation/surfpool/blob/main/crates/core/src/scenarios/protocols/jupiter/v6/idl.json)). Treat non-shared Jupiter routes as browser-only unless the live Privy proof establishes another enforced input binding. Titan's published `swap_route_v2` names both mints and token accounts ([Titan IDL](https://github.com/Titan-Pathfinder/titan-v2-cpi-example/blob/main/titan_swap.json)). This is a source-layout inference, not a passed Privy policy test.

---

## 1. Goal and non-goals

**Goal.** A user who has opted in on oren.finance can say "buy $20 of TSLAx" in Claude. Claude calls `prepare_trade`, shows the terms, the user confirms in chat, Claude calls `execute_trade`. Oren then quotes again, checks the trade against the user's grant and budget, signs with **Oren's Privy signer (a key quorum) under a restrictive per-wallet Privy policy**, and broadcasts. The browser can stay closed. Trades are USDC→xStock buys and xStock→USDC sells, routed by `SwapRouter` (`SWAP_ROUTER_MODE=best`, Jupiter `api.jup.ag/swap/v1` vs Titan).

**Non-goals (v1).** Limit orders, baskets, vault lock/unlock, SOL or arbitrary token pairs, and transfers or withdrawals. Codex/loopback clients and ChatGPT stay out (`clientMayPrepareTrades` remains Claude-only). No app-owned or custodial wallets. We will not use Privy's own swap action (`/wallets/actions/swap`), because routing stays in `SwapRouter`. No policy-only security: Oren-side guards are the primary control, and the Privy policy limits damage if Oren's server is compromised.

**Security stance.** Confirming in chat is a UX step. It is **not** a security boundary, because the model relays it. The boundaries are: (1) the user's browser opt-in, with budgets, (2) Oren's server-side guards, which are atomic and run right before signing, and (3) the Privy policy enforced in the TEE. Every one of them has to allow a trade before it is signed.

---

## 2. Current state (what exists on master) [code]

| Area | Where | Notes for this work |
|---|---|---|
| OAuth AS | `api/src/mcp-auth/oauth-runtime.ts` `createMcpOAuthRuntime` (oidc-provider; scopes `openid oren.read oren.trade.prepare offline_access`; AccessToken 600 s; Grant/RefreshToken 7 d; `resourceIndicators.getResourceServerInfo` scope string). `clientMayPrepareTrades()` = only `https://claude.ai/api/mcp/auth_callback` | Add `oren.trade.execute` in 3 places here, and add `clientMayExecuteTrades()` |
| Consent | `api/src/main.ts` `POST /oauth/interaction/:uid` (allowed-scope list, `requireMcpIdentity`, inserts `mcp_connections`), `GET /oauth/connections`, `POST /oauth/connections/:grantId/revoke`, `/.well-known/oauth-protected-resource/mcp` (`scopes_supported`) | Add the scope. Refuse `oren.trade.execute` unless an active delegation exists |
| MCP resource | `api/src/mcp-auth/mcp-resource.ts`: `requireMcpAccess` (opaque token → `mcp_connections` row, 7-day createdAt check, `verifyMcpWallet`); `handleMcpRequest` registers `get_portfolio`, `search_stocks`, `get_stock`, `prepare_buy`, `execute_buy` (browser link only), `trade_status` | New tools go here. Split into `mcp-tools/*.ts` if the file grows past ~400 lines |
| Intents | migration `0008_mcp_trade_intents.sql`; `mcp_trade_intents` (amount_usd, slippage 1..50, 10 min expiry, `approval_id`); browser review `app/app/app/trades/review/[id]/trade-review.tsx` + `GET /mcp/intents/:id`, `POST /mcp/intents/:id/approval/:approvalId` in `main.ts` | Extend the table; keep the browser path as the fallback |
| Approval core | `api/src/execution/approval.service.ts` `prepare()` (quote→tx, `rpc.inspect` with expectation, ≤60 s expiry, `assertSlotValid`), `approve()` (claim → `auth.signTransaction` → `rpc.validateSigned` → persist signed bytes → `rpc.broadcast`), `approval.repository.ts` `claim()` (status `prepared→signing`, catches unique 23505 = per-wallet lock) | Refactor so the sign step is pluggable (user authorization vs delegated signer); keep every invariant |
| Privy server | `api/src/auth/privy-wallet-auth.ts` `PrivyWalletAuth` (`@privy-io/node` ^0.36; `signTransaction(walletId, authorizationSignature, tx, approvalId, expiresAt)` with `authorization_context.signatures`, `idempotency_key`, `request_expiry`; redacted logging) | Add `signTransactionAsSigner()` and `getWalletSigners()` |
| Swaps | `swap-router.ts` (`quote`, `prepare`); `jupiter/jupiter.service.ts` `prepareSwap` (`postSwap` with `useSharedAccounts:false`, falls back to default = shared accounts); `titan/titan-tx.builder.ts` (`assertAllowedInstructions`, `assertOnlyWalletSigns`, compiles v0 with on-chain ALTs); `swap-terms.ts` (`expectationFor`, `enforcedMinimumOut`); `swap-balance-guard.ts` | **Jupiter transactions currently get no instruction allowlist.** Add one (§6.3) |
| Kill switches | `config/deployment.ts` `assertFinancialExecutionEnabled()` (off in previews); `MCP_OAUTH_ENABLED` (read raw from `process.env`) | Add `MCP_DELEGATED_TRADES_ENABLED` |
| Web | `app/app/connect/mcp/mcp-connect.tsx` (consent copy says "cannot sign or submit"), `app/app/settings/mcp/page.tsx` (list/revoke), `app/components/auth/privy-session.tsx`; `@privy-io/react-auth` ^3.51 (no `useSigners` usage yet) | New chat-trading settings plus enrollment |

---

## 3. User flow

1. **Opt in (browser, once per ≤7 days).** At `/settings/mcp` → "Chat trading", the user signs in with email OTP and picks per-trade USDC cap, daily USDC cap, sides (buy / buy+sell) and expiry (1–7 days, default 7). Oren creates a per-wallet Privy policy (§4.2) and returns `{signerId, policyId, delegationId}`. The browser calls Privy `useSigners().addSigners({address, signers:[{signerId, policyIds:[policyId]}]})` **[doc: add-signers]**. Oren verifies the signer on the wallet server-side, then marks the delegation `active`.
2. **Connect Claude.** In the existing OAuth consent at `/connect/mcp`, if Claude requests `oren.trade.execute` and the user has an active delegation, the consent screen shows the caps and expiry and a checkbox "Let this agent execute trades within these limits". Without an active delegation the scope is dropped. The connection still works with `oren.read oren.trade.prepare` (browser review).
3. **Trade.** `prepare_trade({assetId, side, amountUsd | amountShares, slippageBps})` returns `{intentId, summary, maxSpendUsd, minReceive, priceLimit, expiresAt, mode:'delegated'|'browser'}`. Claude shows the summary, and the user says yes (Claude's own tool-approval prompt is driven by `destructiveHint:true`). `execute_trade({intentId, idempotencyKey})` returns `{status:'submitted', signature, explorerUrl}` or a refusal: `{status:'needs_browser_approval', approvalUrl}`, `price_moved`, `over_budget`, or `delegation_inactive`. Claude polls `trade_status`.
4. **Disable / revoke.** "Turn off chat trading" disables the delegation in Oren's DB **first**, then calls `useSigners().removeSigners({address})` **[doc: remove-signers]** (this removes *all* signers on the wallet). Revoking the Claude connection also blocks execution.

---

## 4. Privy signer and policy design

### 4.1 Privy facts this design relies on (all [doc] unless marked)
- A signer is a **key quorum** registered in the dashboard or API; Oren holds the P-256 private key, and Privy never sees it. Policies are optional, and **each signer can have only one override policy**. — https://docs.privy.io/wallets/using-wallets/signers/configure-signers , https://docs.privy.io/wallets/using-wallets/signers/add-signers
- Server signing uses `@privy-io/node`'s `AuthorizationContext` with `authorization_private_keys: [...]`, or `sign_functions: [fn]` for a KMS (ECDSA P-256 over the payload, base64 result). — https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server
- Wallets with signers show `delegated: true` in `user.linked_accounts`. — https://docs.privy.io/wallets/using-wallets/signers/use-signers
- Server-side signer removal = update the wallet's `additional_signers`, and **the wallet owner (the user) must sign** that request. So Oren cannot remove its own signer server-side without the user. — https://docs.privy.io/wallets/using-wallets/signers/remove-signers
- Policy evaluation runs in the TEE. Rules apply **per RPC method**, and a method with no rule is denied. DENY beats ALLOW, and no matching rule means DENY. **Every instruction in a Solana transaction must evaluate to ALLOW.** — https://docs.privy.io/controls/policies/overview
- Solana field sources: `solana_program_instruction.programId`; `solana_system_program_instruction` (`instructionName`, `Transfer.{from,to,lamports}`); `solana_token_program_instruction` (Transfer, TransferChecked, Burn, MintTo, CloseAccount, InitializeAccount3 fields); `solana_instruction_data` (Anchor-IDL-decoded args and named accounts); `system.current_unix_timestamp`. Operators: `eq neq lt lte gt gte in(≤100) in_condition_set contains starts_with ends_with`. — overview
- `solana_instruction_data` takes a **modern Anchor IDL (≥0.30, explicit discriminators), ≤32 KB each and 128 KB per policy**. It must be paired with a `programId` condition. Vectors, enums and floats can't be compared. **Template variables are not supported** there. — https://docs.privy.io/controls/policies/example-policies/solana-idls
- `{{wallet.address}}` template variable works with `eq`/`in` on address fields, but not in IDL conditions or aggregations. — https://docs.privy.io/controls/policies/template-variables
- **ALTs:** Privy does not resolve lookup-table addresses. A condition that inspects an address loaded from an ALT fails and the tx is rejected. Conditions on `programId`, `instructionName`, amounts, decoded args and time work with ALT (v0) transactions. — https://docs.privy.io/controls/policies/example-policies/solana#known-limitations
- **Stateful (aggregation) limits are Ethereum-only** (`eth_signTransaction`, `eth_signUserOperation`), are updated *after* signing (racy), and are capped at 10 per app. → Solana daily budgets must live in Oren's DB. — https://docs.privy.io/controls/policies/stateful-policies
- A policy **without an owner can be changed with the app secret alone**. Set `owner_id` to a key quorum, after which policy updates need that owner's signature. — https://docs.privy.io/controls/policies/create-a-policy , https://docs.privy.io/controls/policies/update-a-policy

### 4.2 What the policy can and cannot enforce for Jupiter/Titan swaps
**Can (TEE-enforced, subject to live proof):** only `signTransaction` (sign-only; Oren broadcasts via Alchemy), and therefore no `signMessage`, `signAndSendTransaction` or `exportPrivateKey`. Top-level program allowlist. No top-level SPL `Transfer`/`TransferChecked`/`Approve` (deny-by-omission) and no System `Transfer`. `CloseAccount.destination` = the wallet. Grant expiry via timestamp. IDL rules must bind input amount, both mints and the user's source/destination accounts. Jupiter's shared-account route exposes those fields; its non-shared route does not expose the source mint/account. Address conditions work only when the relevant keys are static rather than ALT-loaded.

**Cannot (enforce in Oren):** inner/CPI instructions. The docs only say instructions in the transaction are evaluated, and nothing documents CPI evaluation **[unverified, assume NOT evaluated]**, so the token movements done by Jupiter/Titan inside their programs are invisible to the policy. It also cannot enforce: actual amount received vs quote, quote freshness, rolling daily spend on Solana, per-intent binding or idempotency, which MCP client or grant asked, OAuth revocation, sells' USD notional (input is xStock raw units with different decimals), or anything about addresses that a v0 tx loads from an ALT.

**Unknowns Phase 0 must settle:**
- Does `solana_token_program_instruction` parse **Token-2022** instructions? xStocks are Token-2022.
- Is `SyncNative` (absent from the documented field list) matchable by `instructionName`, or does it need a programId-only allow?
- Can the published Jupiter v6 IDL be converted to Anchor ≥0.30 and trimmed under 32 KB with args and accounts intact?
- Are the exact instruction names Jupiter returns today `route` / `shared_accounts_route`, or `*_v2` variants?
- Does Titan publish an Anchor IDL Privy accepts (orbmarkets lists one for `T1TAN…`)?
- Does calling `addSigners` again with the same `signerId` replace the override policy?
- What shape does the server-side wallet read (`wallets().get`) return for signers and their policy ids?
- Is there a per-app limit on the number of policies?

### 4.3 Policy: one per delegation, owner = Oren policy-admin quorum (exact rules, `chain_type:'solana'`, all `method:'signTransaction'`)
Created with `privy.policies().create({...owner_id: PRIVY_POLICY_ADMIN_QUORUM_ID})` from a new `api/src/mcp-auth/delegation-policy.ts` `buildDelegationPolicy(input)`. The function is pure and snapshot-tested. Its values are literals, because template variables can't be used in IDL conditions.
1. `deny-after-expiry`: `system.current_unix_timestamp gte <expires_at_unix>` → **DENY**.
2. `compute-budget`: `programId eq ComputeBudget111111111111111111111111111111` → ALLOW.
3. `ata-create`: `programId eq ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` → ALLOW. The owner/funder can't be checked here (not a supported field source); Oren's allowlist checks it, and the worst case is rent paid by the user.
4. `token-close-to-self`: `solana_token_program_instruction.instructionName eq CloseAccount` AND `CloseAccount.destination eq {{wallet.address}}` → ALLOW.
5. `memo`: `programId in [MemoSq4g…, Memo1Uhk…]` → ALLOW (only if Phase 0 shows Titan emits it).
6. `jupiter-shared-route`: `programId eq JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` plus a proven IDL condition for `sharedAccountsRoute`/`sharedAccountsRouteV2`, the exact user source/destination token accounts, input/output mints, `inAmount` capped in raw units for both buys and sells, slippage and expiry. Non-shared `route`/`routeV2` stays on browser approval unless a separate proof binds its omitted source fields.
7. `titan-swap`: `programId eq T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT` plus proven IDL conditions for `swap_route_v2` input/output mints and token accounts, `amount` capped in raw units for both sides, and expiry. Extra Titan program IDs require separate proof.
8. No System-program rule. System `Transfer`/`CreateAccount` at top level are denied. If Phase 0 finds Jupiter emits a top-level System instruction, add `instructionName eq CreateAccount` only with evidence, and never `Transfer`.
9. No `exportPrivateKey`/`signMessage`/`signAndSendTransaction`/`*` rules, so they are denied by default.

**Tier 1** (program-ID-only) is a diagnostic fallback only. It must never authorize live headless trades. If route-level amount, mint, destination and expiry checks cannot be proven for one provider, that provider stays on browser approval. Record the proven provider and rule set in the Phase 0 results before enabling a live route.

### 4.4 Keys
- `PRIVY_MCP_SIGNER_QUORUM_ID`: the key quorum added to wallets. Its private key is `PRIVY_MCP_SIGNER_PRIVATE_KEY` (P-256, base64/PEM) for Phase 1. Before all-users rollout, move it to a KMS via `sign_functions`.
- `PRIVY_POLICY_ADMIN_QUORUM_ID`: owns the policies. **A different key, held offline/CI-only**, not on the API host if feasible, so a stolen signer key or app secret cannot loosen policies. Open question: per-user policy creation at enrollment needs *creation* rights only. Confirm that creating a policy with an `owner_id` does not require the owner's signature **[unverified]**. If it does, create the policies with a dedicated creation key and transfer ownership.

---

## 5. Oren-side guards (all enforced in `execute_trade`, in this order)
1. **Kill switch:** `MCP_DELEGATED_TRADES_ENABLED==='true'` and `assertFinancialExecutionEnabled()` and `SOLANA_NETWORK==='mainnet'`. Phase 2 also checks that `userId ∈ MCP_DELEGATED_TRADES_ALLOWED_USERS` (comma-separated Privy DIDs). If any check fails, return `delegation_inactive` and fall back to the browser link.
2. **Token/connection:** `requireMcpAccess` with `oren.trade.execute` in `tokenScopes` and in `connection.scopes`. The client must pass `clientMayExecuteTrades`.
3. **Delegation:** a `mcp_trade_delegations` row for `(userId, walletId)` with `status='active'`, `expires_at > now()`, and `connection.created_at > delegation.activated_at` (re-consent after re-enrollment). Privy must still show the wallet `delegated:true` with our signer, checked via `PrivyWalletAuth.getWalletSigners()` and cached ≤60 s.
4. **Intent:** owned by `(grantId, clientId, userId, wallet)`, `status='prepared'`, not expired (prepare TTL 5 min), side allowed by the delegation, asset tradable, mint in the xStock allowlist (from `MarketService` variants). The model supplies only `intentId` and `idempotencyKey`, never a wallet, mint, amount or transaction.
5. **Fresh quote and price protection:** re-quote the exact stored mint via `ExecutionService.getQuoteForMint`, never a process-local quote ID. Require the fresh route's enforced minimum output ≥ stored `min_out_raw` and its raw input ≤ stored `max_in_raw`, including sells. Require slippage ≤ the intent and delegation maxima and quote age ≤ 15 seconds. If a check fails, return `price_moved`; never auto-retry or switch variants.
6. **Transaction checks:** `ApprovalService.prepare` (existing simulation via `rpc.inspect` with `SwapExpectation`, slot expiry), plus the **new** `assertDelegatedSwapShape(tx, wallet, mints)` in `api/src/execution/delegated-tx-guard.ts`. That function decodes the v0 message with ALTs resolved from chain, allows only the §4.3 programs, applies the Titan-style per-instruction checks to both providers (reuse `assertAllowedInstructions` logic, generalized from `TitanInstruction` to compiled instructions), applies `assertOnlyWalletSigns`, requires fee payer = wallet, and requires `user_source/destination` accounts on the route instruction to be the wallet's ATAs.
7. **Budget (atomic):** in one DB transaction, lock the delegation row, require a newly consented active Claude connection, claim the intent and reserve its amount. Count all unresolved reservations, regardless of age, plus confirmed trades created in the rolling 24 hours against both caps. Buys charge exact USDC input. Sells reject raw share input above the prepared ceiling and charge the greatest of prepared and fresh independent stock reference values and quoted USDC proceeds. Keep a reservation on uncertain outcomes. The hard ceilings `MCP_DELEGATED_MAX_PER_TRADE_USD` (default 100) and `MCP_DELEGATED_MAX_DAILY_USD` (default 250) clamp user settings.
8. **Idempotency/claim:** `UPDATE mcp_trade_intents SET status='executing', idempotency_key=$k WHERE id=$id AND status='prepared' RETURNING`. A repeat call with the same key returns the current status. A different key on a non-prepared intent returns a conflict. `trade_approvals.id` is the Privy `idempotency_key`. The existing per-wallet `claim()` lock still applies.
9. **Rate limits:** DB-backed, counting `mcp_audit_events` of type `execute_attempt`: ≤3/min and ≤30/day per user, and ≤10/min per connection for `prepare_trade`. The in-memory `SlidingWindowRateLimiter` is not enough, because there's one instance today but there may be more later.
10. **Sign → persist → broadcast:** the shared approval core with `signer = delegated`. Unknown Privy/RPC outcomes leave the reservation `reserved` and the intent `executing` for reconciliation in `trade_status` (existing `ApprovalService.status` logic). Never re-sign a new tx because of a timeout. On a definite failure, release the reservation. On confirmation, consume it.
11. **Audit:** every step writes `mcp_audit_events`, with no JWTs, raw Privy errors or tx bytes. Use the existing redaction style in `PrivyWalletAuth.signTransaction`.

---

## 6. Changes by file

### 6.1 Data model: `api/lib/db/migrations/0010_mcp_delegated_trades.sql` (+ `api/lib/db/schema.ts`, `meta/_journal.json`)
- `mcp_trade_delegations`: `id uuid pk`, `user_id`, `wallet_id`, `wallet`, `status text check in ('pending_signer','active','revoked','expired')`, `privy_signer_id`, `privy_policy_id`, `policy_tier smallint`, `policy_hash text` (sha256 of the canonical policy JSON), `per_trade_limit_usd numeric(18,6)`, `daily_limit_usd numeric(18,6)`, `max_slippage_bps int check 1..50`, `allow_sell bool`, `expires_at timestamptz`, `created_at`, `activated_at`, `revoked_at`, `revoke_reason`. Unique partial index on `(wallet_id) WHERE status IN ('pending_signer','active')`. Checks: `per_trade ≤ daily`, `expires_at ≤ created_at + interval '7 days'`.
- `mcp_budget_reservations`: `id uuid`, `delegation_id fk`, `intent_id uuid UNIQUE`, `amount_usd numeric(18,6) check > 0`, `status check in ('reserved','consumed','released')`, `created_at`, `settled_at`. Index on `(delegation_id, created_at)`.
- `mcp_trade_intents` additions: `side text default 'buy' check in ('buy','sell')`, `mode text default 'browser' check in ('browser','delegated')`, `status text default 'prepared'` (`prepared, executing, submitted, confirmed, failed, expired, needs_browser`), `amount_raw numeric` (sells), `min_out_raw numeric`, `max_in_raw numeric`, `quote_ref text`, `delegation_id uuid`, `idempotency_key text`, `executed_at`. Relax `amount_usd` to nullable with `CHECK (amount_usd > 0 OR amount_raw > 0)`. Unique `(id, idempotency_key)`.
- `trade_approvals`: add `authorization_source text default 'user' check in ('user','mcp_delegated')` and `mcp_intent_id uuid`.
- `mcp_audit_events`: `id bigserial`, `user_id`, `delegation_id`, `grant_id`, `client_id`, `intent_id`, `type`, `detail jsonb`, `created_at`. Index on `(user_id, created_at desc)`.
- `ALTER TYPE execution_feature ADD VALUE IF NOT EXISTS 'mcp'` in its **own** migration file, because that statement can't run inside a transaction block. Check how `lib/db/migrate.mjs` wraps statements.

### 6.2 OAuth / consent
- `oauth-runtime.ts`: add `oren.trade.execute` to `scopes`, to `getResourceServerInfo().scope`, and add `clientMayExecuteTrades()` (same Claude-only rule; keep it a separate function so it can diverge).
- `main.ts`: add the scope to `scopes_supported` and to the interaction allowed list. On POST, keep `oren.trade.execute` only if `clientMayExecuteTrades` passes **and** an active delegation exists for `owner.walletId` **and** the body has `acceptDelegatedTrading:true`; otherwise drop it silently. `GET /oauth/interaction/:uid` returns `delegation: {perTrade, daily, expiresAt}|null` for the consent copy.
- `mcp-resource.ts` `requireMcpAccess`: accept `oren.trade.execute`. Revoking a connection already revokes its tokens; that is unchanged.

### 6.3 API: delegation endpoints (Privy-session-authenticated, same CORS block as `/mcp/intents`)
- `POST /mcp/delegation` `{perTradeUsd, dailyUsd, expiresInDays, allowSell}`: calls `requireMcpIdentity`, clamps to the hard ceilings, derives the user's USDC/xStock ATAs, runs `buildDelegationPolicy`, calls `privy.policies().create`, inserts `pending_signer`, and returns `{delegationId, signerId, policyId}`.
- `POST /mcp/delegation/:id/activate`: checks the identity matches, reads the wallet's signers from Privy, and requires exactly our `signerId` with override policy `policyId` and `delegated:true`. Then sets `active` and audits. The old active row becomes `revoked`, via a transaction under the unique index.
- `POST /mcp/delegation/:id/revoke`: sets `revoked` before any Privy call and audits. Keep unresolved reservations charged until confirmation or definite failure, even after revocation. The client then calls `removeSigners`.
- `GET /mcp/delegation`: returns the current delegation, used today vs the cap, and the last 50 `mcp_audit_events` and intents (activity).
- Background, piggy-backed on an existing poller: mark delegations past `expires_at` as `expired`. They are also checked at execute time.

### 6.4 Approval core refactor (`approval.service.ts`)
Extract `signAndSubmit(row, sign: (row) => Promise<string>)` out of `approve()`. Keep the claim, re-inspect, slot check, expiry rechecks, `validateSigned`, persist-before-broadcast, and the pending-on-timeout semantics. `approve()` passes the user signer. The new `approveDelegated(intent, delegation)` creates the row through an identity-based `prepareFor({userId, walletId, wallet}, …)`. That method doesn't need a Privy bearer; per `MCP_PRIVY_AUTH.md` §6.6, never pass an MCP token in as a Privy token. It then passes `PrivyWalletAuth.signTransactionAsSigner(walletId, tx, approvalId, expiresAt)`, which calls `wallets().solana().signTransaction(walletId, {transaction, authorization_context:{authorization_private_keys:[key]} | {sign_functions:[kms]}, idempotency_key, request_expiry})` with the same redacted error handling. **Existing `approval.service.spec.ts` must pass unchanged.**

### 6.5 MCP tools (`mcp-resource.ts`)
- `prepare_trade` (`oren.trade.prepare`, `destructiveHint:false`): input `{assetId, side:'buy'|'sell', amountUsd?, amountShares?, slippageBps≤50}`. Quotes via `ExecutionService.getQuote`, stores the intent with `min_out_raw`, `max_in_raw`, `mode` (delegated if the token has execute scope and the delegation is active and the trade fits remaining budget), and a 5-min expiry. Returns a plain-language summary and `remainingDailyUsd`. Keep `prepare_buy` as an alias for one release.
- `execute_trade` (`oren.trade.execute`, `destructiveHint:true, idempotentHint:true, openWorldHint:true`): input `{intentId: uuid, idempotencyKey: string(16..64)}`. Runs §5. Return the browser review URL only for a valid, owned, still-prepared intent when the route is unsupported, the delegation is inactive, or the trade exceeds budget. Invalid ownership, forged terms, and ambiguous execution return an error or pending status without a new approval link. `execute_buy` stays as the browser-only path.
- `trade_status`: extend with `side`, `mode`, `status`, `signature`, `explorerUrl`, and the reservation state.
- `get_trading_limits` (`oren.read`, readOnly): returns `{enabled, perTradeUsd, dailyUsd, usedTodayUsd, expiresAt, sides}`.

### 6.6 Web (`app/`)
- `app/app/settings/mcp/page.tsx`: add a "Chat trading" card with off/on, caps, sides, expiry, used-today bar, activity list (from `GET /mcp/delegation`), and a "Turn off" button. New component `app/components/mcp/chat-trading-settings.tsx` uses `useSigners` from `@privy-io/react-auth`: `addSigners` after `POST /mcp/delegation`, then `/activate`; `/revoke`, then `removeSigners`. If the Privy call fails, the server row stays `pending_signer` (harmless) or `revoked`, and the UI says so.
- `app/app/connect/mcp/mcp-connect.tsx`: when `delegation` is present and the scope is requested, show the limits and the opt-in checkbox, and replace the current copy "cannot sign or submit a trade" with accurate copy for each case.
- Connection rows show "Executes trades within limits" when the scopes include `oren.trade.execute`.

### 6.7 Env (`api/src/config/env.schema.ts` + spec; `.env.example`; `infra/mcp/enable-oauth.sh` untouched)
`MCP_DELEGATED_TRADES_ENABLED` (default `false`), `MCP_DELEGATED_TRADES_ALLOWED_USERS` (list; empty means everyone once the flag is on, so require explicit `*` to mean all), `PRIVY_MCP_SIGNER_QUORUM_ID`, `PRIVY_MCP_SIGNER_PRIVATE_KEY`, `PRIVY_POLICY_ADMIN_QUORUM_ID`, `MCP_DELEGATED_MAX_PER_TRADE_USD` (100), `MCP_DELEGATED_MAX_DAILY_USD` (250), `MCP_DELEGATED_QUOTE_MAX_AGE_MS` (15000), `XSTOCK_DELEGATED_MINT_ALLOWLIST` (optional override). Startup fails if the flag is on without the signer vars, and is refused in preview (as `MCP_OAUTH_ENABLED` is).

---

## 7. Test plan

### 7.1 Unit/integration (jest, `*.spec.ts`)
- `delegation-policy.spec.ts`: snapshot of the exact rules; expiry DENY present; no `*`/`exportPrivateKey`/`signMessage` rules; all IDL conditions paired with `programId`; IDL size ≤32 KB.
- `delegated-tx-guard.spec.ts`: real Jupiter and Titan fixtures (add `api/src/test/jupiter-swap.fixtures.ts` from Phase 0 captures) pass. These are rejected: an SPL Transfer/TransferChecked/Approve/SetAuthority to a third party; a System Transfer; an unknown program; a second signer; a fee payer ≠ wallet; a route destination ATA not owned by the wallet; a non-allowlisted mint.
- `budget.spec.ts` against real Postgres: 20 concurrent executes at the cap → exactly ⌊cap/notional⌋ succeed. Released reservations free budget, the 24 h window rolls, and an over-per-trade request is rejected before any Privy call.
- `mcp-resource.spec.ts`: scope gating (read-only and prepare-only tokens can't see `execute_trade`); Codex loopback can't get execute; revoked connection / revoked or expired delegation / kill switch off → `delegation_inactive`; same idempotency key twice → one sign call; different key → conflict; price moved → no sign.
- `approval.service.spec.ts`: unchanged tests pass, plus delegated-path tests for persist-before-broadcast and timeout-leaves-pending.
- `privy-wallet-auth.spec.ts`: `signTransactionAsSigner` passes `authorization_private_keys` and the idempotency key, and redacts errors.

### 7.2 Phase 0 disposable-wallet policy proof (`api/scripts/privy-policy-proof.mjs`, manual, **gate for any code that signs**)
Use the existing production Privy app **only with a newly created disposable test user and embedded Solana wallet**, as approved by the owner. First run `api/scripts/inspect-proof-wallet.mjs` with `PROOF_WALLET_EMAIL` and the public `PROOF_WALLET_ADDRESS` supplied by the user; continue only when `proofReady` is true (the exact linked email and address, one embedded Solana wallet, no signer or delegation). The first supplied wallet belonged to a different email and was rejected by this gate. Never use an existing production user wallet. Fund the disposable wallet only after the policy harness is ready, with about 5 USDC and 0.02 SOL on mainnet. Create a dedicated test signer quorum and owner-protected policy, then add the signer through the browser. Call `signTransaction` via that signer (sign-only, no broadcast unless noted) on:
- **Positive:** a real Jupiter shared-account USDC→xStock and xStock→USDC transaction, and the corresponding Titan routes, including Token-2022 and ALT cases. Broadcast one ~$1 buy and sell per provider only after the sign-only and denial matrix passes. Record program IDs, instruction names, static versus ALT-loaded accounts, and top-level Token-2022 instructions. Test `useSharedAccounts:false` as a diagnostic expected denial until its source-account binding is proven.
- **Negative (each must be denied by Privy, with the error code recorded):** top-level USDC `TransferChecked` to an outside address; System `Transfer` of 0.001 SOL; a Memo/other non-allowlisted program (e.g. an Orca Whirlpool direct swap); a Jupiter route with `slippage_bps` 500; a non-allowlisted `destination_mint`; `in_amount` over the cap; a destination ATA owned by another wallet; a user ATA forced into an ALT; a request after the policy expiry (use a policy with expiry = now+2 min); `signMessage`; `exportPrivateKey`; `signAndSendTransaction`; a policy update signed only by the signer key or app secret; signing after `removeSigners`.
- **Output:** append the results table to this file (§10), including the exact provider/instruction variant and policy rule set. If route-level proof fails for a provider, keep it on browser approval. A program-ID-only Tier 1 result never unlocks signing.

---

## 8. Phased rollout
| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Policy proof (§7.2), confirm the Jupiter IDL/instruction names, Token-2022 parsing, signer read shape | Results table complete; Dave signs off on the tier |
| 1 | Merge all code behind `MCP_DELEGATED_TRADES_ENABLED=false`: migrations, guards, refactor, UI hidden behind the same flag exposed via an API capability | CI green; with the flag off, prod behaviour is identical (execute scope dropped, `execute_trade` not registered) |
| 2 | Flag on, `MCP_DELEGATED_TRADES_ALLOWED_USERS=<Dave's DID>`, caps $25/trade, $50/day, 1-day expiry, buy-only first, then sells | 10+ real trades on Jupiter and Titan; revoke/kill switch drills (flag off → next execute refused within one request); audit and reconciliation checked; zero unexplained reservations |
| 3 | All users (`*`), KMS signer, default caps $50/$100 (hard ceilings 100/250), monitoring alerts on Privy policy denials, price_moved rate, and stuck `executing` > 5 min | 2 weeks without incident; then consider raising ceilings |

The kill switch is `MCP_DELEGATED_TRADES_ENABLED=false` plus a restart. It is checked on every execute and doesn't depend on Privy. For a suspected key compromise: flip the flag, rotate the signer key quorum (old-key signatures then fail **[unverified: confirm rotation semantics]**), and bulk-mark delegations `revoked` so users must re-enroll.

---

## 9. Risks and open questions
1. **CPI blindness:** Privy can't see Jupiter/Titan internal transfers, so a compromised Oren server plus signer key could route funds out through a swap program. Mitigations: KMS, Tier 2 destination/mint IDL checks, small caps, short expiry.
2. **ALT failures:** Jupiter may put user accounts in ALTs on some routes, making Tier 2 account conditions fail closed. Mitigation: call `/swap-instructions` and compile with user accounts static (as `TitanTxBuilder` does), or drop those conditions.
3. **Prompt injection** can make Claude prepare and execute within limits without real user intent. Accepted within caps; `destructiveHint` makes Claude ask. Consider an MCP form elicitation confirm (Claude support unverified).
4. `removeSigners` removes **all** signers, which would matter if Oren later adds other signers (e.g. limit orders).
5. Policy count/limits per app, policy-creation auth with `owner_id`, `addSigners` replace semantics, key rotation: all unverified (§4.2).
6. Regulatory/policy: Anthropic usage policy and xStocks eligibility (see `MCP_PRIVY_AUTH.md` §8). ChatGPT/Codex stay excluded.
7. Should sells count toward the daily cap? The plan says yes (conservative). Dave to decide.
8. Delegation expiry (≤7 days) vs OAuth grant (7 days from connection): users re-enroll weekly. Is that acceptable UX?

## 10. Phase 0 results (fill in)
| Case | Provider | Expected | Actual | Privy error code | Notes |
|---|---|---|---|---|---|
