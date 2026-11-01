# Oren MCP server with Privy auth: design and handoff

> **Status (1 Nov 2026):** PR #8 merged. MCP OAuth, Privy email-OTP consent, read tools and browser buy review are implemented behind `MCP_OAUTH_ENABLED=false`; delegated signing is not implemented. The production flag remains off. `feat/mcp-local-connector` adds Codex loopback callbacks and restricts those clients to `oren.read`. This document's later research sections are historical design context.
> **Researched:** 31 Oct 2026 (WAT, UTC+1). Policies and specs change often, so re-check the Sources before you ship.
> **Audience:** Dave, continuing in Codex. This file is meant to stand on its own, so you should not need any other context.
> **Legend:** **[verified]** = read on the cited page on 31 Oct 2026. **[unverified]** = from search snippets, third-party summaries, or my own reading, and not confirmed on a primary page. **[interpretation]** = my reading of policy text. It is not legal advice.

---

## Codex local connection (pending OAuth deployment)

After the API deployment includes `feat/mcp-local-connector` and production OAuth is enabled, add the existing API as a personal remote MCP server:

```sh
codex mcp add oren --url https://api.oren.finance/mcp
codex mcp login oren --scopes oren.read
```

The browser opens Oren's existing Privy email OTP login and consent page. Google credentials are not involved. Codex loopback clients can receive `oren.read` only; the API rejects their `oren.trade.prepare` consent requests. Check the three read tools and revoke the connection from Oren's connection management page after acceptance. Do not attempt login while `MCP_OAUTH_ENABLED=false`; the discovery endpoint returns 404.

---

## 0. TL;DR

- **Intent.** Let users of agent chats (ChatGPT, Claude, Cursor, Codex, our own Oren agent) connect an **Oren MCP server**, sign in with the **same Privy account** they use on oren-finance, and **trade tokenized stocks (xStocks)** on Solana through the existing Jupiter and Titan routing (`SWAP_ROUTER_MODE`).
- **Proposed architecture; delegated signing remains unproven.** Privy does not provide the MCP OAuth authorization server described here, and Privy tokens cannot be passed through as MCP tokens. We would run an **OAuth 2.1 authorization server (AS)** whose browser login uses Privy and which issues its own audience-bound MCP tokens, keyed to the Privy user ID (`did:privy:...`). Signing then happens either (a) under a **Privy signer + policy** the user grants at consent time, for bounded trades, or (b) on an **Oren approval page**, reusing the existing `trade_approvals` flow, for everything else. Path (a) requires the §6.6 compatibility proof.
- **Distribution constraints from the research:**
  - **ChatGPT, including custom MCP / developer-mode connectors: not allowed.** OpenAI's *App Developer Terms* §1.6(h) explicitly covers "custom connectors created in ChatGPT developer mode" and says Apps must not "initiate, execute, or otherwise facilitate money transfers, cryptocurrency transfers, or other financial or investment transactions through the Services." **[verified]** The plugin and app submission guidelines separately ban "Execution of money transfers, crypto transfers, or investment trades." **[verified]**
  - **Codex plugins: not allowed** in the public directory, which is the same directory and the same guidelines as ChatGPT. The App Developer Terms define "Apps" to include plugins, so the §1.6(h) ban likely also reaches privately installed plugins. **[interpretation]**
  - **Claude directory and official plugin marketplace: no.** "We do not generally allow cryptocurrency software in our directory" (exception only with express written permission). **[verified]**
  - **Claude custom connectors added by URL: no Anthropic review, and no crypto ban found.** The directory policy covers the directory only. The Usage Policy still applies, and it has high-risk finance requirements. **[verified that custom connectors are not reviewed; "no ban" is unverified, since I did not read the full Usage Policy PDF]**
  - **Cursor: user-added remote MCP (mcp.json / deeplink) needs no review.** The Marketplace is curated and has no crypto clause in the Publisher Terms I fetched, but approval is at Cursor's sole discretion. **[verified: no crypto keyword in the terms; listing outcome unknown]**
  - **Claude Code self-hosted plugin marketplaces** (any git repo plus `/plugin marketplace add`) skip Anthropic review. **[verified from docs snippets]**
- **Recommended surfaces, in order:** (1) **Oren's own agent** (`api/src/agent`, already has `prepareSwap`), (2) **Claude custom connector**, (3) **Cursor (and Claude Code) via URL / self-hosted plugin**. Expose only **read-only and quote tools** to ChatGPT/Codex, or nothing there; see §2 and Open Questions.
- **Motivation from prod data:** 72 of 77 `executions` are stuck in `awaiting_signature`, because users drop off at the Privy approval step in the web app. A chat-native, policy-bounded signer for small trades attacks exactly that funnel.

---

## 1. Intent and scope

### Goals
1. A remote MCP server (Streamable HTTP) for Oren: `https://<api-host>/mcp`. The host is TBD; see Open Questions.
2. MCP OAuth 2.1 sign-in that resolves to the **same Privy user and embedded Solana wallet** as the web app (`app/components/auth/privy-session.tsx`, `api/src/auth/privy-wallet-auth.ts`). The browser login uses Oren's existing **email OTP** flow (`EmailLogin` / `useLoginWithEmail`); OAuth authorizes the MCP client after that login.
3. Tools for portfolio, stock lookup, quotes, and **swap execution** through the existing router (`api/src/execution/swap-router.ts`: `jupiter` / `shadow` / `best`).
4. Two-phase money movement: **prepare → (policy-bounded auto-sign | human approval page) → submit** via the existing Alchemy RPC path (`api/src/execution/approval-rpc.service.ts`).
5. Revocation, audit log, and server-side rolling caps.

### Non-goals (for v1)
- EVM. Limit orders and vault lock/unlock over MCP; add these later behind the same approval page.
- Listing in the ChatGPT/Codex directory or the Claude directory (blocked by policy; see §2).
- Custodial or app-owned server wallets.

### Product authorization decision
The user chose bounded quick trades with a browser-based Privy enrollment. The browser verifies identity and installs a revocable signer grant once; it does not need to remain open for each trade. `AGENTS.md` now allows delegated signing only within an explicit grant, with the server validating the exact prepared trade before signing. A Privy login session alone does not authorize future trades. Trades outside the grant use a fresh human approval or fail closed.

---

## 2. Research findings: platform policy (Step 1)

### 2a. ChatGPT: developer mode / custom MCP connectors added by URL

| Item | Finding | Status |
|---|---|---|
| Scope of the developer terms | *App Developer Terms* (updated 28 Sep 2026): "'Apps' include apps built using the Apps SDK, plugins (which may contain Apps SDK apps and custom skills), **custom connectors created in ChatGPT developer mode**, and custom GPT actions…" | **[verified]** |
| The ban | §1.6 Restrictions: "Your API, App, and App Responses must not: … (h) **initiate, execute, or otherwise facilitate money transfers, cryptocurrency transfers, or other financial or investment transactions through the Services**." | **[verified]** |
| External checkout | §7.7: "Your App may not enable, allow, or facilitate purchases of digital currencies…" | **[verified]** |
| Directory / submission rules | Plugin guidelines and app submission guidelines, under "Prohibited fraudulent, deceptive, or high-risk services": "Crypto or NFT offerings involving speculation, consumer deception, or financial abuse" and "**Execution of money transfers, crypto transfers, or investment trades**". Commerce is limited to physical goods. | **[verified]** |
| Developer mode status | The Help Center says full MCP (write actions) is beta for Business, Enterprise, and Edu, and admins enable it. An OpenAI staff forum post says the explicit "developer mode" toggle was removed: users add custom MCP servers at chatgpt.com/plugins → Add → "Create custom MCP server", and the RBAC setting was renamed "Create custom MCP servers". OpenAI says it does **not** vet custom MCP apps but runs "policy screening of MCP prompts… checks on write-capable actions… online/offline moderation of tool calls" (App Security Whitepaper). | **[verified from snippets; plan eligibility for Plus/Pro unverified]** |

**Conclusion [interpretation]:** a ChatGPT custom connector that executes, or even "facilitates", crypto or tokenized-stock trades violates the App Developer Terms, which bind the developer once you create the App. This is true whether or not the app is published. A "prepare in chat, sign on oren.xyz" design still likely counts as "facilitate". Read-only tools (portfolio, prices, analysis) are not named in §1.6(h), but tokenized stocks may also fall under the usage policies' finance rules (not checked). **Do not target ChatGPT for trading.**

### 2b. Claude: custom connectors added by URL vs the Connectors Directory

| Item | Finding | Status |
|---|---|---|
| Directory policy §4.A | "Software that transfers money or other financial assets, or executes financial transactions autonomously on behalf of users, without human-in-the-loop safeguards. **We do not generally allow cryptocurrency software in our directory.**" The section is prefaced by "Unless otherwise expressly permitted by us in writing…". | **[verified]** |
| Recent change | A third-party change tracker (docswatch, 28 Oct 2026) reports that the clause previously listed cryptocurrency as an asset type. That meant crypto with human-in-the-loop (HITL) safeguards *was* allowed. It is now excluded regardless of safeguards. | **[unverified, third party]** |
| Custom vs directory | "Both run on the same MCP infrastructure… The difference is review, discoverability, and distribution." Custom connectors get **no Anthropic review**, have no in-product discovery, and always show the external-link modal. An install link is available: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=NAME&connectorUrl=ENCODED_URL` | **[verified]** |
| Usage Policy | Still applies to all use, including agents acting through tools. Personalized financial / digital-asset recommendations are "high-risk" (qualified human review, plus AI disclosure). Fraudulent or unauthorized transactions are prohibited. | **[unverified: from search synthesis; full PDF not read]** |
| MCP requirements (directory) | OAuth 2.0; tool annotations `title`, `readOnlyHint`, `destructiveHint`; tool names ≤ 64 chars; Streamable HTTP | **[verified]**. Good practice even for custom use. |

**Conclusion:** a **Claude custom connector is the best-supported third-party chat surface** for trading. It cannot be listed, so distribution means sharing the install link from the Oren app. Keep human approval (HITL) for anything above small caps, to stay inside the Usage Policy's spirit.

### 2c. Plugin and marketplace routes

| Route | How an MCP is bundled | Crypto rules found | Can a trading MCP ship there? |
|---|---|---|---|
| **OpenAI plugin directory (ChatGPT + Codex)**: one universal directory | ZIP package with a remote MCP (domain verification, demo creds, 5 positive and 3 negative tests, `readOnlyHint`/`openWorldHint`/`destructiveHint` with justifications) | Same plugin guidelines ban as above. App Developer Terms §1.6(h) | **No** **[verified]** |
| **Codex repo/personal marketplaces** (`$REPO_ROOT/.agents/plugins/marketplace.json`, `~/.agents/plugins/marketplace.json`) | Local or team distribution, no directory review | No separate rule found, but the App Developer Terms define "Apps" to include plugins | **Likely no** **[interpretation]** |
| **Claude official plugin directory** (`anthropics/claude-plugins-official`, submit via claude.com/docs/plugins/submit) | Plugins can include MCP servers. Local MCP servers must now ship *inside* a plugin (MCPB desktop extensions are deprecated) | Subject to Anthropic Software Directory Policy → crypto generally disallowed | **No** without written permission **[verified]** |
| **Claude Code self-hosted marketplace** (`.claude-plugin/marketplace.json` in any git repo or URL; users run `/plugin marketplace add <repo>`) | Plugin points at our remote MCP URL | No Anthropic review. Usage Policy applies | **Yes, technically** **[verified from docs snippets]** |
| **Cursor Marketplace** (cursor.com/marketplace/publish) | `.cursor-plugin/plugin.json` + `mcp.json` (can be a `url` server). Must be open source and is manually reviewed, including every update | Publisher Terms (6 May 2026): **no crypto or financial clause found** (keyword search of the full text). Anysphere "may approve or reject any application for any reason". The Marketplace is "curated… trusted partners". Plugins must be free | **Possible but discretionary** **[verified terms text; outcome unknown]** |
| **Cursor user-added MCP** (`~/.cursor/mcp.json`, project `.cursor/mcp.json`, or an "Add to Cursor" deeplink) | Remote URL with OAuth (DCR or static `CLIENT_ID`) | No review | **Yes** |
| **cursor.directory** (community) | Listing of MCPs and plugins | Rules **not checked** | **[unverified]** |
| **Other hosts** (Windsurf, VS Code Copilot, Goose, etc.) | Generic remote MCP | **Not researched** | **[unverified]** |

---

## 3. Research findings: MCP auth + Privy (from the prior research page)

Source: the research Page "MCP + Privy auth and agent transactions: feasibility and architecture" (Grok canvas, 31 Oct 2026). Its full content is folded in below.

### 3.1 MCP authorization today (spec version 2026-07-28)
- MCP server = OAuth **resource server**. It publishes Protected Resource Metadata (**RFC 9728**) and answers `401` with `WWW-Authenticate: resource_metadata=...`.
- The AS publishes **RFC 8414** metadata or OIDC discovery (clients must support both).
- Client registration: **Client ID Metadata Documents (CIMD)** SHOULD be supported. **DCR (RFC 7591)** is now deprecated, kept for backward compatibility. Pre-registration is allowed.
- **PKCE S256 required.** The `resource` parameter (**RFC 8707**) goes in both the authorize and token requests.
- **Audience binding:** servers must reject tokens not issued for them. **Token passthrough to upstream APIs is forbidden.**
- **RFC 9207** `iss` in the authorization response: SHOULD today, expected to become MUST.
- **Step-up:** `403 insufficient_scope` triggers re-authorization with more scopes (e.g. a separate `trade` scope).
- **Refresh tokens:** public clients need rotation. `offline_access` belongs in the AS metadata, not the resource's scopes.
- **URL-mode elicitation** (since 2025-11-25) can send the user to an out-of-band page (e.g. confirm a payment). It must **not** be used to authorize access to the MCP server itself.

### 3.2 Client support (from each vendor's docs)
| Client | Remote MCP auth support |
|---|---|
| Claude (web, desktop, mobile, Code, Cowork) | Auth specs 2025-03-26, 2025-06-18, and 2025-11-25. CIMD preferred (needs `client_id_metadata_document_supported` plus `none` in token auth methods), else DCR, else Anthropic-held credentials. Callback `https://claude.ai/api/mcp/auth_callback`; loopback for Claude Code. Needs a 401 to start sign-in. Uses only the **first** `authorization_servers` entry. Endpoint timeout 10 s (30 s for refresh). No `client_credentials`. |
| ChatGPT / Codex | OAuth 2.1 auth code + PKCE S256. CIMD (`none` or `private_key_jwt`), DCR, or a predefined client. Strict RFC 9207 `iss` checks. Per-tool `securitySchemes` plus `_meta["mcp/www_authenticate"]` trigger the linking UI. mTLS client certs available. No machine-to-machine grants. MCP Apps UI widgets run in an iframe. |
| Cursor | Auth code + PKCE. Reads RFC 9728 and RFC 8707. DCR as a public client, or a static `CLIENT_ID` in mcp.json. Callbacks `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`. Lists Elicitation and MCP Apps as supported. |
| Oren's own agent | Anything we implement. Today it calls services in-process (`api/src/agent/tools/agent-tool.registry.ts`), so it doesn't need MCP to benefit from the signer work. |

Not checked: whether ChatGPT and Claude render URL-mode elicitation today. Cursor lists Elicitation but not which modes. **Always return a plain-link fallback.**

### 3.3 Can Privy be the OAuth server?
| Topic | Finding |
|---|---|
| OAuth AS for MCP clients | **None found** in docs.privy.io (no `/authorize`, DCR, or CIMD for third-party MCP clients). Medium confidence; absence is not proof. |
| Agent authorization | Yes, an **OAuth 2.0 Device Authorization Grant** at `auth.privy.io/api/oauth/v2/*`. Access token lasts 15 min; refresh token 30 days, rotated. Exchanged for an ephemeral HPKE-encrypted signing key, then wallet RPC. Grants can be listed and revoked (`DELETE /grants/{id}`). Intended for self-hosted agents and CLIs (Claude Code, Codex, OpenClaw). Use from a multi-tenant remote server is **undocumented**. |
| Official MCP server | `@privy-io/mcp-server` is a **local stdio** dev/admin tool that needs the Privy app secret. It is not an end-user login. |
| Privy access tokens | ES256 JWT, `iss` privy.io, **`aud` = our Privy app ID**, `sub` = Privy DID, about 1 h. Good for proving identity on *our* AS page. **Wrong audience** to be an MCP token. |
| Name clash | `mcp.privy.com` belongs to **Privy.com** (marketing popups), an unrelated company. Ignore it. |

**Bridge patterns**
| Pattern | How | Fit |
|---|---|---|
| **A. Own thin AS + Privy login (recommended)** | Our `/authorize` page loads the Privy React SDK. The server verifies the Privy access token (we already do this in `PrivyWalletAuth`), maps `sub` → user, gets consent (+ optional signer grant), then issues **our own** audience-bound JWT. **Cloudflare `workers-oauth-provider`** supports MCP 2026-07-28, CIMD, DCR, PKCE, RFC 8707/9207, and stores tokens hashed. It is a good reference, or a base if we host the AS on Workers. | Keeps Privy as the single identity |
| B. Hosted IdP (Auth0/Stytch) as AS + Privy custom-JWT auth | The IdP is the MCP AS. Privy trusts the IdP JWT | Moves identity off Privy login; migration risk |
| C. Privy device grant inside tools | A tool starts a Privy device flow and shows a URL. The server stores Privy tokens per MCP user | Unofficial for remote servers; still needs A or B for MCP auth |

**Not researched:** Dynamic, Clerk, WorkOS, Descope MCP auth offerings.

### 3.4 How transactions get signed
| Option | Who signs | Chat UX | Guardrails | Revocation |
|---|---|---|---|---|
| **a. Signer on the user's embedded wallet** | Our server's authorization key / key quorum, added by the user via `addSigners` | No per-transaction prompt | Per-signer override **policy enforced in Privy's TEE**: program allowlist, amounts, time | User `removeSigners`, and the server stops on its own |
| b. App-owned server wallet | Our backend | No prompt | Wallet policies | Custodial-like. **Out of scope** |
| **c. Human confirms on our page** | The user, in a Privy session on our domain | One click out per transaction | User sees the exact summary; server re-checks | Nothing standing to revoke |
| d. Privy device grant | Agent process, short-lived keys | Approve once in the browser | Wallet/app policies, up to 30 days | `DELETE /grants/{id}`; JWT valid ≤ 15 min after revoke |

**Recommendation: a hybrid of (a) for small trades and (c) above the caps.** Notes:
- (a) makes our authorization key a high-value secret. Keep it in a KMS/HSM and use a key quorum for policy changes.
- Privy **rolling spend caps (aggregations) are documented only for EVM methods**, so **Solana daily caps must be enforced server-side**.
- (c) is what Oren already does in the web app. See §4.

### 3.5 Who else does this
| Company | What | Relevance |
|---|---|---|
| **Coinbase** | Remote MCP at `agents.coinbase.com/mcp`, OAuth 2.1, works in Claude and ChatGPT. The user picks which portfolios to share. A local CDP CLI MCP for developers | **Closest analog**. How it squares with OpenAI §1.6(h) is unknown; possibly read-only in ChatGPT (**unverified**) |
| Privy | Agent CLI, agents.privy.io sandbox, device-grant auth, local MCP server, auto.exchange recipe (bearer API key) | Building blocks, but no hosted OAuth MCP |
| Crossmint | Agent Wallets with on-chain caps, counterparties, and time windows | Same delegation model, enforced on-chain |
| thirdweb | Remote MCP with wallet tools; `secretKey` in the URL | Counter-example for auth |
| Turnkey | Enclave signing + policy engine (third-party comparison only) | Alternative signer |
| Dynamic | Not researched | |

---

## 4. Current codebase: what we can reuse

Paths are relative to the repo root. The snapshot is from `origin/master` @ `a8992e6` (31 Oct 2026).

| Area | File(s) | Relevance to MCP |
|---|---|---|
| Privy auth (server) | `api/src/auth/privy-wallet-auth.ts` (`PrivyWalletAuth`: `requireWallet`, `requireSigner`, `signingRequest`, `signTransaction`), `api/src/auth/auth.module.ts` | Verifies the Privy access token (`@privy-io/node` `verifyAccessToken`), checks the wallet is a linked **Privy embedded** wallet, and builds the Privy wallet-RPC `signTransaction` request with `privy-idempotency-key` = approval id. `signTransaction` passes the **user's authorization signature** via `authorization_context`. **Reuse for the AS login page and for both signing paths.** |
| Privy auth (web) | `app/components/auth/privy-session.tsx` (`useAuthorizationSignature().generateAuthorizationSignature`, `authorizeTrade`), `app/components/auth/privy-auth.tsx`, `app/services/privy-signer.ts`, `app/app/providers.tsx` | The approval page and consent page live in `app/`, reusing these hooks. |
| Server approval flow | `api/src/execution/approval.controller.ts` (`POST /execution/approvals`, `GET :id/authorization`, `POST :id/approve`, `GET pending/:wallet`, `GET :id`), `approval.service.ts`, `approval.repository.ts`, `approval-rpc.service.ts` | Already implements **prepare → simulate (`rpc.inspect` with balance expectation) → user authorization signature → Privy sign-only → validate signed bytes → persist before broadcast → Alchemy broadcast → track**. Statuses: `prepared → signing → signed → submitted → confirmed / failed`. **This is the MCP "execute" backend.** |
| DB | `api/lib/db/schema.ts`: `trade_approvals` (`user_id`, `wallet_id`, `transaction`, `signed_transaction`, `status`, `details`, `expires_at`); `executions` with `execution_status` enum `preparing, awaiting_signature, submitted, confirming, confirmed, failed` and `execution_feature` (`direct`, `agent`, `basket`, …). Migrations in `api/lib/db/migrations` (drizzle, `api/drizzle.config.ts`) | Add `mcp` to `execution_feature`; add MCP OAuth tables (§6.3). |
| Routing | `api/src/execution/swap-router.ts` (`SWAP_ROUTER_MODE` = `jupiter` / `shadow` / `best`; Titan only for the top `TITAN_MAX_VARIANT_QUOTES = 2` variants; requote after 5 s; Titan must beat Jupiter net of fees by ≥ 1 bps), `api/src/execution/jupiter/*`, `api/src/execution/titan/*` | Unchanged. MCP tools call `ExecutionService`, as the agent does. |
| Titan tx allowlist | `api/src/execution/titan/titan-tx.builder.ts`: `TITAN_SWAP_PROGRAM_IDS = ['T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT']`, plus `TITAN_EXTRA_PROGRAM_IDS` env; ComputeBudget, System, Token, Token-2022, ATA, and Memo with per-instruction discriminator checks (`assertAllowedInstructions`) | **Directly reusable as the Privy policy allowlist source of truth.** The server already rejects disallowed instructions before signing. |
| Kill switch | `api/src/config/deployment.ts` `assertFinancialExecutionEnabled()` (disabled in previews); `ApprovalService.prepare` requires `SOLANA_NETWORK === 'mainnet'` | MCP execute tools must call the same guard. Devnet testing of policies needs a separate harness (§7 Phase 0). |
| Existing agent tools | `api/src/agent/tools/agent-tool.registry.ts`: `getPortfolio`, `getPortfolioActivity`, `getStock`, `searchStocks`, `getStockChart`, `getStockNews`, `analyzeStock`, `getSignals`, `findOpportunities`, `getSwapQuote`, `prepareSwap` (feature `agent`; on `PriceMovedError` it returns an alternative quote and **never auto-executes**), `proposeLimitOrder`, `getLimitOrders`, `getVaults`, `prepareLock`, `prepareUnlock`, `createBasket`, `prepareBasketPurchase`, `prepareCopyPortfolio`, `getLeaderboard`, `getTraderProfile`, `getTradingCalendar(Day)`, `getBitgetMarketContext` | **The MCP tool surface should be a thin adapter over this registry** (shared JSON schemas, same handlers), so the web agent and MCP never diverge. |
| Web agent UI | `app/components/agent/*` (`agent-action-review.tsx` = in-app review of prepared actions), `app/services/agent-service.ts`, `app/services/approval-service.ts`, `app/hooks/use-quote-execution.ts` | The approval-page UX already exists; the MCP approve page can reuse `agent-action-review` + `useQuoteExecution`. |
| Deploy | `deploy.yml`, `.github/workflows/deploy-production.yml`, `api/Dockerfile`, `app/Dockerfile`, `Caddyfile`, `infra/vps-bootstrap.sh`, `infra/preview/compose.yml` | Prod runs on a VPS via docker compose behind Caddy. The MCP endpoint is most simply a new Nest module in `api` behind a new Caddy route (§6.1). |

**Drop-off data point:** 72 of 77 `executions` rows sit at `awaiting_signature` (prod, per Dave). The web flow requires the user to open the app and produce a Privy authorization signature for each trade. MCP alone won't fix that if every trade still needs a click-out. The **policy-bounded signer (path a)** is what removes the step for small trades. Measure before and after with `executions.feature_source = 'mcp'`.

---

## 5. Architecture

### 5.1 Components
```
Agent client (Claude / Cursor / Claude Code / own; ChatGPT read-only at most)
   │  Streamable HTTP + Bearer (aud = MCP URL)
   ▼
Oren MCP resource server  ── api/src/mcp/*  (Nest module in api/)
   │  in-process calls
   ├── AgentToolRegistry / ExecutionService / SwapRouter (Jupiter + Titan)
   ├── ApprovalService (trade_approvals)  ──► Privy wallet RPC (sign-only)  ──► Alchemy RPC broadcast
   └── McpRiskEngine (server-side caps, rolling USD limits, allowlists)
Oren OAuth AS  ── api/src/mcp-auth/* (endpoints) + app/app/oauth/* (Privy login + consent UI)
   └── verifies Privy access token via PrivyWalletAuth; issues own JWTs; optional addSigners on consent
Oren approval page  ── app/app/approve/[id] (reuses privy-session authorizeTrade + approval-service)
```

### 5.2 Sequence (mermaid)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant C as Agent client (Claude / Cursor / own)
  participant M as Oren MCP server (api /mcp)
  participant A as Oren OAuth AS (api + app /oauth)
  participant P as Privy (auth + wallet RPC, TEE policies)
  participant R as SwapRouter (Jupiter / Titan)
  participant S as Solana (Alchemy RPC)

  C->>M: tools/call (no token)
  M-->>C: 401 WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"
  C->>M: GET /.well-known/oauth-protected-resource
  C->>A: GET /.well-known/oauth-authorization-server
  C->>U: open /authorize (PKCE S256, resource=MCP URL, CIMD or DCR client_id)
  U->>A: Oren email OTP login through Privy
  A->>P: verifyAccessToken(privy JWT) -> sub = did:privy:...
  A->>U: consent: scopes (read, trade) + limits
  opt user enables "quick trades" (path a)
    U->>P: addSigners(oren signer, policyIds) on embedded Solana wallet
  end
  A-->>C: redirect code + iss, then token exchange (code_verifier, resource)
  A-->>C: access token (aud = MCP URL, sub = Privy DID, scope) + rotating refresh token

  C->>M: tools/call get_swap_quote (Bearer)
  M->>R: quote (SWAP_ROUTER_MODE jupiter|shadow|best)
  R-->>M: quote
  M-->>C: summary + quote_id (nothing signed)
  C->>M: tools/call prepare_swap(quote_id)
  M->>R: build tx (Jupiter or Titan; Titan allowlist check)
  M->>S: simulate + balance expectation (ApprovalRpc.inspect)
  M-->>C: human-readable intent + intent_id (trade_approvals row, status prepared)
  C->>M: tools/call execute_swap(intent_id)
  M->>M: re-validate owner, expiry, slot, caps (McpRiskEngine)
  alt within caps AND signer granted (path a)
    M->>P: wallet RPC signTransaction, authorized by Oren signer key (policy checked in TEE)
    P-->>M: signed tx
    M->>S: broadcast (persist signed bytes first)
  else above caps OR no signer (path c)
    M-->>C: URL elicitation / link https://app/approve/intent_id
    U->>A: open approve page, same Privy user (sub must match)
    U->>P: generateAuthorizationSignature (user)
    A->>M: POST /execution/approvals/:id/approve
    M->>P: signTransaction (user authorization_context)
    M->>S: broadcast
  end
  S-->>M: signature / confirmation
  M-->>C: result + explorer link (executions.feature_source = mcp)
```

### 5.3 Tool surface (v1)
All tools carry `title`, `readOnlyHint`, `destructiveHint`, and `openWorldHint`. Names stay ≤ 64 chars.

| Tool | Scope | Hint | Backed by |
|---|---|---|---|
| `get_portfolio`, `get_activity` | `oren.read` | readOnly | registry `getPortfolio`, `getPortfolioActivity` |
| `search_stocks`, `get_stock`, `get_stock_chart`, `get_stock_news`, `analyze_stock`, `get_signals` | `oren.read` | readOnly | registry |
| `get_swap_quote` | `oren.read` | readOnly | registry `getSwapQuote` → `SwapRouter` |
| `prepare_swap` | `oren.trade` | not destructive (no funds move) | `ApprovalService.prepare({kind:'swap'})`, which creates a `trade_approvals` row |
| `execute_swap(intent_id)` | `oren.trade` | **destructive** | new `McpExecutionService` (path a or c) |
| `get_trade_status(intent_id)` | `oren.read` | readOnly | `ApprovalService.status` |
| `revoke_quick_trades` | `oren.trade` | destructive | calls Privy `removeSigners` and flags the grant |

The wallet is **never a tool argument**. It is derived from the token's Privy user → linked embedded wallet. This differs from the in-app registry, which takes `wallet` as input. Reject any mismatch.

---

## 6. Detailed design

### 6.1 Hosting
- Option 1 (selected): new Nest modules `api/src/mcp/` (resource server, Streamable HTTP via the current `@modelcontextprotocol/server` v2 SDK) and `api/src/mcp-auth/` (OAuth AS through `oidc-provider` with durable Postgres storage), served on the existing API container and API domain. Login/consent UI lives in the existing Next app and reuses the Privy email OTP flow.
- Option 2: the AS on Cloudflare Workers with `workers-oauth-provider`, and the MCP on the VPS. Battle-tested OAuth, but it splits infra.
- Claude's 10 s endpoint timeout: keep `/token` and `/register` fast; there are no Privy calls on `/token`.

### 6.2 OAuth AS requirements checklist
- `/.well-known/oauth-authorization-server` (RFC 8414): `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]`, `authorization_response_iss_parameter_supported: true`, `scopes_supported: ["oren.read","oren.trade","offline_access"]`, and a `registration_endpoint` (DCR fallback for Cursor).
- `/.well-known/oauth-protected-resource` on the MCP host (RFC 9728), with a **single** `authorization_servers` entry (Claude only reads the first).
- Redirect URI allowlist: `https://claude.ai/api/mcp/auth_callback`, Claude Code loopback, `https://www.cursor.com/agents/mcp/oauth/callback`, `http://localhost:8787/callback`, plus CIMD-declared URIs. Loopback rules apply.
- Access token: short JWT (5–15 min), `aud` = MCP URL, `sub` = Privy DID, plus `scope`, `jti`, and `grant_id`. Refresh token: opaque, rotated, **stored hashed**, with reuse detection.
- `oren.trade` requires step-up: a `403 insufficient_scope` from trade tools if the grant is read-only.
- Never return or forward the Privy access token. Never put tokens in URLs.

### 6.3 New tables (drizzle, `api/lib/db/schema.ts`)
- `mcp_clients`: client_id (CIMD URL or DCR id), metadata, redirect_uris, created_at.
- `mcp_grants`: id, privy_user_id, wallet, wallet_id, client_id, scopes, `quick_trade_enabled`, `privy_signer_id`, `privy_policy_ids`, limits JSON (per-trade USD, daily USD, max slippage bps, expiry), revoked_at.
- `mcp_auth_codes` (hashed, 60 s TTL, PKCE challenge, resource) and `mcp_refresh_tokens` (hashed, family id, rotated_from).
- `mcp_audit`: grant_id, tool, intent_id, decision (auto / needs_approval / denied + reason), usd_value, signature, ts.
- Add `'mcp'` to the `execution_feature` enum. Link `trade_approvals` to `grant_id` (nullable column).

### 6.4 Signing paths in detail
- **Path c (ships first, policy-compatible with AGENTS.md):** `execute_swap` returns `needs_approval` + `approve_url = https://<app>/approve/<intent_id>`, via URL elicitation where supported, otherwise plain text. The page loads the approval (`GET /execution/approvals/:id`), checks that the **Privy session `sub` matches the approval's `user_id`** (anti-phishing), and runs the existing `authorizeTrade` → `POST :id/approve`. Then `get_trade_status` polls.
- **Path a (Phase 3, needs a product decision):** at consent, the user opts into "quick trades". The client calls Privy `addSigners` on the embedded Solana wallet with Oren's signer (an authorization key / key quorum held in a KMS) and a policy:
  - methods: `signTransaction` only (Oren broadcasts via Alchemy, matching today's sign-only flow); deny `exportPrivateKey` and everything else (policies are deny-by-default).
  - `solana_program_instruction` programId allowlist = the **same set as `titan-tx.builder.ts`** (ComputeBudget, System, Token, Token-2022, ATA, Memo, Titan `T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT`, plus `TITAN_EXTRA_PROGRAM_IDS`), plus Jupiter Aggregator v6 `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` **[unverified: from search; confirm against Jupiter docs and real prepared txs]**, plus any lookup or Jupiter-specific programs observed in real Jupiter txs.
  - System `Transfer.lamports` ≤ a small cap. SPL `TransferChecked` only to the user's own token accounts, if that is expressible.
  - `system.current_unix_timestamp` < grant expiry (e.g. 30 days → re-consent).
  - **Server-side (not Privy):** per-trade USD cap, rolling 24 h USD cap, slippage ceiling, xStocks-only mint allowlist, rate limit per grant. Privy aggregations are EVM-only.
  - Server signing call: wallet RPC `signTransaction` authorized by Oren's signer key instead of the user's `authorization_context`. Extend `PrivyWalletAuth` with `signAsDelegatedSigner(...)`.
- Every path re-runs `ApprovalRpc.inspect` (simulation + balance expectation) and slot validity right before signing, as `ApprovalService.approve` does today.

### 6.5 Security notes
- Prompt injection is the main threat. Mitigations: two-phase intents, the server derives the wallet, an xStocks-only mint allowlist, small auto caps, human approval above them, `destructiveHint` so hosts prompt, and an audit log.
- The authorization key lives in a KMS/HSM; use a key quorum for policy changes.
- Revocation: a settings page in `app/` listing MCP grants → revoke tokens + `removeSigners`. The server checks `mcp_grants.revoked_at` before every sign.
- Don't log JWTs or Privy errors verbatim; follow the existing redaction in `PrivyWalletAuth.signTransaction`.

### 6.6 Quick-trade security contract (implementation gate)

**Enrollment:** The MCP OAuth redirect opens Oren's browser page. The server verifies the Privy access token and resolves the linked embedded Solana wallet. The consent screen names the MCP client, allowed tool scope, eligible assets, per-trade and rolling spend caps, slippage cap, and expiration. The user separately adds Oren's signer to that wallet with a restrictive Privy override policy. Store the grant only after verifying the returned signer, policy and wallet IDs against Privy. The MCP client receives an Oren token bound to that client, resource, user and grant; it never receives the Privy token, signer key or wallet authorization signature. Closing the browser must not affect an active grant.

**Execution:** The MCP token identifies the grant; the model cannot choose a wallet, raw transaction, program ID, output address or signer. `execute_swap` accepts only an Oren-prepared intent ID. The server reloads the intent and quote, checks ownership, expiry, asset/mint and route allowlists, slippage, simulation and balance changes, grant status, and the exact transaction bytes. Reserve rolling spend capacity and claim the intent atomically before the signing call, including concurrent requests across workers. Use the existing per-wallet signing lock and Privy idempotency key. Persist signed bytes before broadcast. Unknown Privy or RPC outcomes remain pending for reconciliation; never create or sign a replacement transaction merely because the request timed out.

**Revocation:** Disable the grant in Oren's database before calling Privy `removeSigners`; reject new signs immediately, including requests holding an otherwise valid MCP token. Revoke or rotate MCP refresh tokens and invalidate access-token use through the grant lookup. If Privy removal is uncertain, keep the Oren grant disabled and retry removal through a controlled reconciliation job. The signer key stays in a dedicated secret store and never in the MCP process response or logs.

**Fail-closed release gates:**
1. Verify with Privy's current API and a disposable wallet that the *sign-only* `signTransaction` method is covered by the intended Solana override policy. The published Solana policy examples use `signAndSendTransaction`, while Oren signs first and broadcasts through Alchemy. Do not infer that one method covers the other. [Privy Solana examples](https://docs.privy.io/controls/policies/example-policies/solana).
2. Exercise actual prepared Jupiter and Titan multi-instruction transaction shapes, including Token-2022 and address lookup tables. Privy says address-based policy checks fail when the address is loaded from an ALT; program, instruction, amount and time checks can still work. Record allowed and rejected cases. [Privy ALT limitation](https://docs.privy.io/controls/policies/example-policies/solana#address-lookup-tables-alts).
3. Prove a policy cannot bypass a transfer limit through a broader ALLOW rule; Privy's own examples warn about this. Independently validate decoded transaction effects on Oren's server. Never rely on a generic program allowlist or a USD estimate alone to prove the destination and amount are safe.
4. Test concurrent cap reservations, duplicate `execute_swap` calls, token theft after revocation, signer-removal failure, expired quotes, price movement, simulation mismatch, and uncertain submission. Keep the kill switch off until these pass and a limited human-controlled acceptance trade is reviewed.

The current `ApprovalService.prepare` and `approve` methods require a Privy bearer token. An MCP bearer token must not be passed into them as if it were a Privy token. Refactor the approval core to accept a server-verified identity and authorization context, with separate HTTP adapters for Privy web calls and MCP grants. Retain every existing byte, expiry, lock and submission invariant during that refactor.

---

## 7. Phased build plan (for Codex)

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Spikes** | (1) Isolated Privy test wallet and policy to prove `signTransaction` authorization. (2) Offline and disposable-wallet fixtures for actual Jupiter/Titan multi-instruction swaps, Token-2022, ALT behavior and policy bypass attempts. (3) Confirm Jupiter program IDs from prepared transactions. No production wallet or funds. | Written evidence in this doc for every pass/fail case; delegated signing remains disabled until §6.6 gates pass |
| **1. Read-only MCP** | `api/src/mcp/` with Streamable HTTP. In a non-production test environment only, expose public stock search/market data behind a feature flag. Portfolio, activity and all wallet-derived tools require OAuth before exposure. | MCP Inspector lists public tools; no private data is reachable without auth |
| **2. OAuth AS + Privy login** | `api/src/mcp-auth/` + `app/app/oauth/authorize`: metadata, CIMD + DCR, PKCE, RFC 8707/9207, rotating refresh, hashed storage, tables from §6.3, consent page | Sign in works from Claude custom connector, Cursor, and Claude Code; tokens rejected with the wrong `aud` |
| **3. Trade via approval page (path c)** | `prepare_swap`, `execute_swap` → `needs_approval` link, `app/app/approve/[id]` page reusing `privy-session.authorizeTrade` + `approval-service`, `get_trade_status`, `feature_source = 'mcp'` | An end-to-end mainnet trade of a small xStock from Claude with click-out approval |
| **4. Quick trades (path a)** | Browser signer grant at consent, atomic `McpRiskEngine` reservations, delegated signing, revoke UI, audit, and §6.6 release gates | Trades under the cap execute with the browser closed; above the cap they fall back to path c; revoked grants cannot sign another transaction |
| **5. Distribution** | Claude install link in the Oren app; Cursor deeplink + optional Marketplace submission (open-source plugin repo); Claude Code self-hosted marketplace repo; update `AGENTS.md` and `docs/api-build-board.md` | Listed or shareable on the allowed surfaces only |

Board hygiene: per `AGENTS.md`, add these phases to `docs/api-build-board.md` / `.html` when work starts. Note: `docs/` is listed in `.gitignore` (line 60), so the board files and this doc are untracked by default. Committing this doc needs `git add -f docs/mcp-privy-auth.md`, or a `.gitignore` exception such as `!docs/mcp-privy-auth.md`.

---

## 8. Open questions
1. **Resolved product decision:** bounded, revocable quick trades are in scope. `AGENTS.md` now states the authorization requirements. Privy policy compatibility and exact limits remain release gates.
2. **ChatGPT:** ship nothing, or a read-only connector? Get an OpenAI policy answer first, since §1.6(h) "facilitate" is broad.
3. **Claude:** request written permission from Anthropic for a directory listing (HITL + caps), or stay custom-connector only?
4. **Legal/compliance:** tokenized stocks (xStocks) eligibility and geo-restrictions for users arriving via third-party agents; the Anthropic Usage Policy high-risk finance requirements (AI disclosure, human review of *recommendations*).
5. **Hosting:** Nest-in-`api` vs Cloudflare Workers AS? Which hostnames (`mcp.` / `auth.`)?
6. **Caps:** default per-trade and daily USD limits for quick trades; slippage ceiling.
7. Does URL-mode elicitation render in Claude / Cursor today? (unverified)
8. Does a Privy signer policy accept Titan's and Jupiter's real multi-instruction transactions (Phase 0)?
9. Should limit orders, vault lock/unlock, and baskets come to MCP later (path c only)?
10. Unresearched alternatives: Dynamic, Clerk, WorkOS, and Descope MCP auth; Turnkey details are third-party only.

---

## 9. Sources

### Platform policy (Step 1, fetched 31 Oct 2026)
- OpenAI App Developer Terms (updated 28 Sep 2026): https://openai.com/policies/developer-apps-terms/
- OpenAI Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines
- OpenAI App submission guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines
- OpenAI plugin submission: https://developers.openai.com/plugins/deploy/submission
- OpenAI plugin submission errors (final directory checks): https://developers.openai.com/plugins/deploy/submission-errors
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI package your plugin (repo/personal marketplaces): https://developers.openai.com/plugins/build/plugins
- Codex plugins: https://developers.openai.com/codex/plugins
- Connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI Help: Developer mode / custom MCP servers: https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
- OpenAI forum (staff), developer mode toggle removed: https://community.openai.com/t/developer-mode-missing-from-security-login-on-chatgpt-pro/1402157
- OpenAI App Security Whitepaper: https://cdn.openai.com/business-guides-and-resources/app-security-whitepaper.pdf
- OpenAI Commerce policies: https://openai.com/policies/commerce-policies/
- Anthropic Software Directory Policy: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- docswatch change note (third party): https://docswatch.stevetoth.ai/anthropic/software-directory-policy/2026-10-28/
- Claude: directory vs custom connectors: https://claude.com/docs/connectors/building/directory-vs-custom
- Claude: submit a connector: https://claude.com/docs/connectors/building/submission
- Claude: connector verification: https://claude.com/docs/connectors/verification
- Claude: submit a plugin: https://claude.com/docs/plugins/submit
- Claude Code: publish a plugin / host a marketplace: https://code.claude.com/docs/en/plugins/publish , https://code.claude.com/docs/en/plugins/host-marketplace
- anthropics/claude-plugins-official: https://github.com/anthropics/claude-plugins-official
- Anthropic Usage Policy (PDF, not fully read): https://assets.claude.com/88cf16e8b7d203be16d2c726bcd28a6ec7c7f5c8.pdf ; agents guidance: https://support.claude.com/en/articles/12005017-using-agents-according-to-our-usage-policy
- Cursor plugins: https://cursor.com/docs/plugins.md ; reference: https://cursor.com/docs/reference/plugins
- Cursor Marketplace security: https://cursor.com/help/security-and-privacy/marketplace-security
- Cursor Marketplace Publisher Terms (6 May 2026): https://cursor.com/marketplace-publisher-terms

### MCP, Privy, and prior art (from the research Page)
- Research Page: https://cursor.com/canvas/store-649dd10b-bb27-4639-9980-c6a9a18ee419/83c957a1-9a2e-4551-8cf7-032301d860ef
- MCP authorization: https://modelcontextprotocol.io/specification/draft/basic/authorization
- MCP versioning: https://modelcontextprotocol.io/specification/versioning
- MCP elicitation (URL mode): https://modelcontextprotocol.io/specification/draft/client/elicitation
- MCP security best practices: https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- Apps SDK auth: https://developers.openai.com/apps-sdk/build/auth ; UI: https://developers.openai.com/apps-sdk/build/chatgpt-ui
- OpenAI plugin security & privacy: https://developers.openai.com/plugins/guides/security-privacy
- Claude connector auth: https://claude.com/docs/connectors/building/authentication ; custom connectors help: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Cursor MCP: https://cursor.com/docs/context/mcp
- Privy agent authorization (device grant): https://docs.privy.io/recipes/agent-integrations/agent-authorization
- Privy agent wallets: https://docs.privy.io/wallets/overview/solutions/agent-wallets ; agentic wallets recipe: https://docs.privy.io/recipes/agent-integrations/agentic-wallets
- Privy signers: https://docs.privy.io/wallets/using-wallets/signers/overview ; add: https://docs.privy.io/wallets/using-wallets/signers/add-signers ; configure: https://docs.privy.io/wallets/using-wallets/signers/configure-signers ; remove: https://docs.privy.io/wallets/using-wallets/signers/remove-signers
- Privy policies: https://docs.privy.io/controls/policies/overview ; Solana examples: https://docs.privy.io/controls/policies/example-policies/solana
- Privy access tokens: https://docs.privy.io/authentication/user-authentication/access-tokens ; custom JWT auth: https://docs.privy.io/authentication/user-authentication/jwt-based-auth/overview
- privy-io/privy-mcp-server: https://github.com/privy-io/privy-mcp-server
- cloudflare/workers-oauth-provider: https://github.com/cloudflare/workers-oauth-provider
- Coinbase for Agents (remote MCP): https://docs.cdp.coinbase.com/coinbase-for-agents/overview ; CDP for Agents: https://docs.cdp.coinbase.com/get-started/build-with-ai/cdp-for-agents
- Crossmint Agent Wallets: https://docs.crossmint.com/agents/wallets/overview ; comparison: https://www.crossmint.com/learn/agent-wallets-compared
- thirdweb MCP: https://portal.thirdweb.com/ai/mcp

### Program IDs
- Titan swap program `T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT`: already in `api/src/execution/titan/titan-tx.builder.ts` ("Portal docs"); also https://orbmarkets.io/address/T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT/anchor-idl and https://github.com/Titan-Pathfinder/titan-v2-cpi-example
- Jupiter Aggregator v6 `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` **[unverified: search result; confirm]**: https://www.helius.dev/parsed-data/jupiter/aggregator-v6 , https://github.com/jup-ag/instruction-parser
- The Jupiter Trigger (limit order) program ID was not looked up.
