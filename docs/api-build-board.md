# Oren Build Board

> **Shared source of truth** for agents (Codex, Cursor, etc.).  
> Visual twin: [`api-build-board.html`](api-build-board.html)  
> Project agent contract: [`../AGENTS.md`](../AGENTS.md)

**Active phase:** `22-panta-foundation`  
**Last updated:** 2026-10-07  
**Planned next (API/agent):** Phase 22 Panta foundation on feat/panta; retain Phase 21 connected-wallet and Dune follow-ups.

---

## Status / Notes

### Done

- **Panta foundation** — Panta foundation on feat/panta: read-only Nest provider, normalized types, optional configuration, bounded fresh/stale cache, sanitized errors and live smoke implemented. Official API/playground contracts documented in docs/panta-integration.md. 30 targeted tests, API build and targeted ESLint pass. Live smoke skipped: URL/key configuration incomplete; pa-access and pa-gate remain in_progress. Settlement documentation conflict and missing resolution/depth APIs are recorded before later writes. Phase 21 connected-wallet/Dune follow-ups remain outstanding.

- **Panta planning** — Panta roadmap added for inspection: phases 22–26 on feat/panta cover Discover, researched Create proposals, stock/versus artwork, reviewed execution, positions/watch and a dedicated launch film after feature validation. Foundation implementation has started; remaining phases are pending and live capabilities still require verification. Existing Phase 21 follow-ups remain active.
- **Launch film revision 4 — simpler graphics and catchier music** — Delivered `oren-launch/renders/oren-launch-simple.mp4`: removed all dot labels, outer explanatory paragraphs, paper labels (including Proposed. Never automatic.) and small research/allocation/review captions. Main headlines use softer power3 entrances with line stagger. Generated one new ElevenLabs take around a repeating four-note nu-disco hook and funky bass; prior take preserved. Verified 25.000 seconds, 1920×1080, 60 FPS, stereo AAC; final audio −16.13 LUFS / −1.95 dBTP. HyperFrames checks pass without warnings; six scene frames and final basket export frame reviewed. Next: creative listening/review.
- **ElevenLabs launch soundtrack** — Generated one successful `music_v2_5` take after the key permission update and delivered `oren-launch/renders/oren-launch-elevenlabs.mp4`. Seven connected music sections match the approved scene durations. Raw MP3, mastered stereo WAV, composition plan and response metadata are preserved; Studio and the landscape builder use the new master. Verified 25.000-second 1080p/60 FPS H.264/AAC export, zero-start streams, unchanged video bitstream hash and final audio at −16.05 LUFS / −3.52 dBTP. HyperFrames checks pass without warnings. Next: human listening and creative review of this first generated take.
- **ElevenLabs music tooling** — Added a key-safe Node generation script, dry-run command and 25-second / seven-section `music_v2_5` plan in `oren-launch/`. Script preserves raw takes, masters audio, stream-copies the approved picture and updates Studio only after success. Credential presence, plan duration and syntax checks pass. Initial provider request returned HTTP 401 `missing_permissions` for `music_generation`; no music was generated. The previous synthesized soundtrack was rejected by the user.
- **Launch film synchronized score** — Delivered `oren-launch/renders/oren-launch-scored.mp4` with original stereo music, 53 named motion cues, quiet typing/candle details, transitions and an Oren closing motif. Includes mastered music-only WAV, editable synthesizer, separate stems and cue sheet. Verified 25.000-second 1080p/60 FPS H.264/AAC export; video bitstream hash exactly matches approved revision 3. AAC audio measures −16.06 LUFS / −1.50 dBTP; both streams start at zero and span 25 seconds. HyperFrames checks pass without warnings. Studio uses the same mastered WAV. Next: listen and creative review.
- **Launch film revision 3** — Delivered `oren-launch/renders/oren-launch-landscape-v3.mp4`: verified 25.000 seconds, 1920×1080, 60 FPS H.264/AAC. Fixed opening stock-card convergence behind the mascot with separated positions and independent outward exits. Added official AAPLx, NVDAx, MSFTx and TSLAx logos from Backed's Solana token metadata, reused across opening, discovery, research and basket scenes. Assets and provenance are local. Lint/runtime/layout/motion pass without warnings; 18/18 contrast checks pass. Dense opening transition samples and final MP4 opening/basket frames reviewed. Next: creative review.
- **Launch film revision 2** — Delivered `oren-launch/renders/oren-launch-landscape.mp4`: verified 25.000 seconds, 1920×1080, 60 FPS H.264 with AAC original audio. White background and local Instrument Sans replace the square treatment; outer marketing labels are removed and an official Solana symbol plus “Solana” sits bottom right. Seven connected beats show gathering stocks, discovery, an agent request, research/candles/news, donut allocation, review/signature and mascot callback. Lint, runtime, layout, motion and contrast pass; mounted-scene frames and final export were reviewed. Next: creative review. Original square MP4 is preserved.
- **Oren launch film** — Completed editable `oren-launch/` HyperFrames source and `renders/oren-launch.mp4`: verified 20.000 seconds, 1440×1440, H.264 at 60 FPS with AAC original audio. Uses current Neue Freigeist fonts, brand palette, exact mascot paths with scripted eye/cursor reactions, morphing product surfaces and an explicit review/signature handoff. Lint, runtime, layout, motion and all 53 contrast checks pass; final export frame and audio verified. Studio: `http://localhost:3017/#project/oren-launch`. Next: creative review and any requested revisions.
- **Production dynamic-route + portfolio equity-boundary fix** — Diagnosed live React server-render digest `550951418` to `sharp`'s Linux x64-v2 binary being incompatible with the VPS CPU. Browser icon and Open Graph art now ship as static assets, runtime error-page imagery bypasses Next image optimization, and `sharp` is development-only; Docker-equivalent standalone smokes return 200 for trader profiles, stock detail, icon, and social image. `getStock` now requires explicit equity evidence, while `resolveMint` awaits and converts non-equity 404s to `null`, preventing ordinary crypto from entering portfolios. Regression tests and API/app builds pass.
- **Leaderboard route resilience + branded error recovery** — Hardened public trader mapping against missing legacy activity/history/position fields, clears stale trader state between profile loads, and safely formats invalid timestamps so `/app/leaderboard/:slug` degrades instead of crashing. Added terminal and global error boundaries with retry/dashboard actions and a custom editorial Oren landscape asset derived from the landing-page visual language. App lint, tests, and production build pass.
- **Stocks-only market guard + agent launcher state** — Market ingestion now rejects non-equity assets leaked by upstream curated/search/trending feeds unless they carry an explicit stock/equity classification or tokenized-equity variant metadata. The floating Oren launcher is hidden whenever the agent sidecar is already open. Mapper regression tests and API/app production builds pass.
- **Production VPS first release** — Pushed deployment commit `dd994fc`, built both Docker images on the VPS, and started healthy Postgres, API, app, and Caddy services. Production migrations ran, 401 stocks were seeded, a compressed database backup was verified, and daily 02:15 UTC local backups were scheduled. A dedicated non-root deployment SSH key works; temporary root setup keys were revoked.
- **Production deployment foundation** — Added immutable SHA-based GHCR API/app releases, GitHub CI and protected-environment VPS deployment/rollback workflow, multi-stage Docker images, Caddy TLS routing for `oren.finance` + `api.oren.finance`, Compose Postgres/migration ordering, liveness/readiness endpoints, VPS bootstrap, and backup helpers. Removed the VPS-specific runbook and production environment template from the public checkout; no live credentials were found in those tracked files.
- **Production release origin defaults** — The release workflow now falls back to the documented `https://oren.finance` and `https://api.oren.finance` origins when Actions variables are unset; explicitly configured variables still override them.
- **Social sharing image** — Added a 1200×630, font-embedded Open Graph route using the Oren landing landscape and a server-safe rendering of the Oren mascot; browser icon uses the same mark.
- **Shared Oren browser icon** — Replaced the legacy favicon with a statically generated Next.js icon route that renders the product's Oren SVG component, keeping browser tabs aligned with the in-app mark.
- **21 Volume Analytics core** — Verified stock/USDC fills now flow through a Postgres outbox and five-second background worker instead of blocking wallet actions. Exact execution IDs replace latest-pending fallback; actual finalized wallet deltas drive idempotent per-stock buy/sell volume; direct, agent, basket, copy, and limit-order sources are attributed; public aggregate endpoints remain available for Dune without wallet exposure. Volume details live on Dune rather than in the app. Optional five-minute Dune uploads contain only fill signatures and stock metadata. API tests and API/app production builds pass.
- **20 Bitget Live Market Context** — Official Bitget V3 Reality stock-info, spot ticker, candles/history, and US market-state APIs now feed a resilient `getBitgetMarketContext` agent tool. Canonical Oren stocks resolve to Bitget rTokens, independent requests run concurrently, live results carry Bitget attribution/timestamps and compact UI artifacts, and bounded timeouts plus fresh/stale caches keep provider failures non-fatal. Real `RNVDAUSDT` ticker/candle/turnover data was verified without mocks or credentials; backend tests and API/app production builds pass.
- **Hero agent gesture polish** — Upgraded the landing Oren mark from a single low-range tilt to layered pointer behavior: pixel-based proximity falloff, fast independent eye tracking, a heavier shell spring, velocity lag, responsive highlight/glow, CTA focus/hover awareness, touch feedback, clean leave-to-rest behavior, and reduced-motion preservation. App lint/tests/logo validation, production build, and desktop browser smoke pass.
- **Oren-context hero landscape** — The public landing page is now intentionally hero-only: a light editorial market landscape frames the existing centered Oren mark, copy, CTA, and product preview. The edge-framing artwork uses restrained chart-like terraces, token forms, and onchain paths, stays hidden on narrow mobile layouts, and fades before the product preview.
- **Public landing + `/app` terminal routing** — The premium light landing hero now owns `/` with an rAF-smoothed pointer-aware Oren mark, unclipped ambient bloom, restrained product preview, and shared primary-button sheen that returns after focus/hover leaves. The authenticated terminal is canonical under `/app/*`; wallet providers are scoped to that layout, internal links moved with it, and legacy terminal URLs redirect safely.
- **Landing product story** — Added responsive, portfolio-led intent processing, conversational portfolio construction, and portfolio-aware NVDAx research sections. They use canonical tokenized-equity notation, respect reduced motion, and retain the existing light terminal system.
- **Landing SaaS continuity pass** — Reframed those product surfaces as one numbered Oren workflow with a persistent desktop progression rail, scroll-timed frame reveals, and a single conversion handoff instead of isolated feature blocks.

- **16 Vault UI** — Full vault page with program-not-live banner; API `VAULT_PROGRAM_LIVE=false` gates prepare/confirm and exposes `programLive` on list.

- **0 Foundation** — Config, Drizzle/Postgres schema+migration, Tokens, Alchemy, common pipes/errors, health
- **1 Portfolio Spine** — portfolio/history/activity + stocks/search/detail/chart + trending
- **2 Trading** — Jupiter quote/prepare/confirm, variant selection, executions persist + portfolio refresh
- **3 Intelligence** — OHLCV indicators, Oren Score, `stock_signals` TTL upsert, analysis + opportunities
- **4 News** — Tokens news wrapper, cached stock news endpoint, portfolio-aware agent news context
- **5 Agent** — OpenAI Responses orchestration, tool registry, persisted threads/messages, artifacts + streaming-ready events
- **6 Vault** — Manual Solana/Anchor lock + unlock transaction builders, indexed vault positions, confirm routes, agent vault tools
- **7 Basket + Polish** — Deterministic basket generation, sequential basket preparation, quote/basket expiry errors, demo walkthrough
- **8 App Data Foundation** — Next app `types/`, API `services/`, and Zustand `store/` data flow scaffolded
- **9 App Shell** — Oren shell, navigation routes, wallet adapter provider/state, UI primitives, typography/theme, and shared feedback states
- **10 Portfolio UI** — Wallet-driven portfolio loading, summary metrics, reusable line/candlestick chart component, positions, activity, and refresh hook
- **Portfolio UI bugfix** — Frontend API requests now preserve the `/api` prefix, and portfolio history/activity responses are normalized for the UI store
- **App shell UI structure** — Removed the left navigation rail, stretched navigation across the top bar, switched to the public Oren logo, made the agent panel a compact floating launcher, and made the home screen markets-first
- **Markets shell polish + signals fix** — Made `stock_signals` persistence use atomic Postgres upsert, switched visible app icons to Hugeicons, trimmed the navbar to Leaderboard / Market, reduced navbar and wallet sizing, and simplified Stocks to one table
- **Compact portfolio overview** — Restored a lightweight connected-wallet portfolio summary above Market with balance, USDC cash, and supported stock positions only
- **App typography** — Switched the Next app to the newly added Neue Haas Grotesk Text and Display files in `app/public/fonts/`
- **Paginated stock market list** — `GET /stocks?page=&limit=` now pages through Tokens upstream, canonical `imageUrl`/`stats` fields map correctly, the app appends pages on scroll, broken logos fall back cleanly, and 24h sparklines render as lines
- **Persisted stock catalog** — Added a migrated `cached_stocks` read-through cache, stale-while-revalidate market pagination/search, and `pnpm db:sync-stocks`; the live seed cached 399 stocks. Market startup no longer blocks on trending/opportunities, and opportunities read persisted signals/catalog rows instead of fetching analysis for the full universe.
- **11 Markets + Stock UI** — Verified canonical search, market lists, stock detail routing, Lightweight Charts, Oren Score/signals, and stock news in the Next app; production build and source lint pass.
- **App UI refresh** — Reworked the app toward a clean white dashboard system with black wallet CTA, compact top navigation, rounded white panels, pink/yellow/lavender metric cards, and polished dashboard/market/stock surfaces.
- **Market list persistence bugfix** — Market refreshes now keep the last loaded stock list visible and merge incoming assets instead of replacing loaded pages with the first page on navigation.
- **Stock detail data correctness** — Chart parsing now supports nested/tuple price data and falls back from price-chart to OHLCV; stock news now filters out broad market headlines that do not mention the asset, ticker, or company.
- **13 Trading + Basket UI** — Stock detail now has a right-rail buy/sell ticket, quote review drawer, wallet signing handoff, confirm/portfolio refresh flow, and reusable basket review with per-leg status.
- **12 Agent UI** — Persistent responsive Oren sidecar, Responses API SSE streaming, wallet-owned Postgres history, local recent chats, real tool traces, structured artifacts, explicit quote/basket review handoffs, accessibility/motion polish, and retry/stop behavior. Strict OpenAI tool schemas now require all declared keys while representing optional values as nullable.
- **14 Social Trading + Leaderboard** — Opt-in public trader profiles, Oren-observed leaderboard ranking, public trader profile pages, signed visibility publishing, proportional copy-portfolio proposals, and agent social tools/artifacts.
- **15 Trading Calendar** — Snapshot-derived daily P&L memory, significant event markers, day drilldowns, calendar UI, and agent tools/artifacts for daily and monthly performance context.
- **18 Agent Technical Analysis** — MACD/ATR/Bollinger/SMA200, swing S/R, trend regime/setup, multi-timeframe TA brief, deterministic summary, news overlay, composite `analyzeStock`, agent TA playbook, and stock/agent UI surfaces.
- **19 Jupiter Limit Orders** — Trigger V1 propose/prepare/confirm/cancel, deterministic TA `limitZones`, agent `proposeLimitOrder`/`getLimitOrders`, stock ticket Limit tab, and market-quote auto-refresh on expiry.
- **Agent fullscreen workspace** — Expandable lg+ two-column agent overlay (thread + artifact rail) on top of the existing sidecar; session-only expanded state, page-context chip, chip summaries in thread, collapse on stock navigation, Escape hierarchy, and sidecar gutter suppressed while expanded.
- **Agent launcher wide-screen positioning** — Anchored the floating agent opener to the centered app shell instead of the viewport edge, so it stays beside the product surface when the browser is zoomed out or displayed on an ultra-wide screen while preserving mobile insets.

### Blockers / follow-ups

- **Panta live verification** — Supply the PANTA_API_BASE_URL/PANTA_API_KEY pair and run the built provider read-only smoke. No authenticated live reads or writes verified; Phase 22 stays in_progress. See [integration handoff](panta-integration.md) for payout, resolution metadata, secondary API and network/eligibility gates.

- Public HTTPS activation requires DNS A records for `oren.finance` + `api.oren.finance` to `104.207.95.184`; Caddy cannot issue certificates while both names fail DNS. Automatic GitHub releases still require published GHCR images and configured Actions secrets (`VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_KNOWN_HOSTS`). The workflow defaults public origins to the documented production domains, and repository Actions variables can override them. The VPS `.env`, migrations, and initial catalog sync are complete. Add encrypted off-VPS backups and test a restore before relying on the local backup schedule.
- Live Postgres migration and Tokens catalog sync are verified; Alchemy and `/api/health` runtime verification remain.
- After the main MVP flow is stable, run `anchor build`, copy the generated IDL into a tracked stable path (`program/idl/program.json` or `api/src/vault/idl/program.json`), and verify or replace the manual vault instruction builders against that IDL.
- Frontend production build, source lint, and local landing-page browser smoke are verified; live browser smoke against a running Nest API still needs `NEXT_PUBLIC_OREN_API_URL` verification.
- Trading UI build/lint is verified; live wallet smoke still needs a connected wallet, active Nest API, and tradable Jupiter route.
- Agent API tests, app stream tests, builds, lint, and disconnected mobile browser acceptance are verified; the connected-wallet live OpenAI/Jupiter acceptance path still requires local provider credentials and a wallet.
- Limit-order live smoke still needs a connected wallet + Jupiter Trigger V1 route; run `0003_limit_orders` migration before testing.
- Bitget's live ticker/candle path is verified; its US market-state endpoint returned an empty list during the smoke run, so session metadata remains optional. A connected live OpenAI agent/UI smoke still depends on the local provider credentials and wallet path.
- Volume analytics requires migration `0004_volume_analytics` before runtime. Connected swap/partial-limit receipt parsing and the public Dune query/dashboard still need live credentials and transaction samples; the app remains functional with Dune disabled.

### Next

- **22 Panta Foundation** — Complete authenticated live read smoke, then Phase 23 Discover. Phase 24 Create remains gated on verified write network/permissions; no signing or publication in foundation.

- **Panta feature path** — Implement on `feat/panta`: 22 Foundation → 23 Discover → 24 Create → 25 Positions/Watch → 26 Validation/Launch. Review this plan before implementation; branch feat/panta is now created and checked out. Native writes are gated on verified provider support.

- **21 Volume Analytics** — Run the migration and connected-wallet smoke; configure the Dune namespace/dashboard. Then return to **17 Demo Polish**.

---

## Progress summary

| Phase                    | Priority | Status    | Tasks |
| ------------------------ | -------- | --------- | ----- |
| 0 · Foundation           | infra    | completed | 5/5   |
| 1 · Portfolio Spine      | P0       | completed | 9/9   |
| 2 · Trading              | P0       | completed | 6/6   |
| 3 · Intelligence         | P0       | completed | 5/5   |
| 4 · News                 | P0       | completed | 4/4   |
| 5 · Agent                | P0       | completed | 5/5   |
| 6 · Vault                | P0       | completed | 6/6   |
| 7 · Basket + Polish      | P1       | completed | 4/4   |
| 8 · App Data Foundation  | P0       | completed | 4/4   |
| 9 · App Shell            | P0       | completed | 6/6   |
| 10 · Portfolio UI        | P0       | completed | 6/6   |
| 11 · Markets + Stock UI  | P0       | completed | 7/7   |
| 12 · Agent UI            | P0       | completed | 5/5   |
| 13 · Trading + Basket UI | P0       | completed | 6/6   |
| 14 · Social Trading      | P0       | completed | 7/7   |
| 15 · Trading Calendar    | P0       | completed | 6/6   |
| 16 · Vault UI            | P0       | completed | 5/5   |
| 17 · Demo Polish         | P1       | in_progress | 3/7   |
| 18 · Agent Technical Analysis | P0  | completed | 6/6   |
| 19 · Jupiter Limit Orders | P0      | completed | 6/6   |
| 20 · Bitget Live Market Context | P0 | completed | 6/6   |
| 21 · Volume Analytics + Dune | P0 | in_progress | 6/7   |
| 22 · Panta Integration Foundation | P0 | in_progress | 3/5 |
| 23 · Panta Discover Agent | P0 | pending | 0/6 |
| 24 · Panta Create Agent + Proposal Sheet | P0 | pending | 0/10 |
| 25 · Prediction Positions + Thesis Watch | P1 | pending | 0/6 |
| 26 · Panta Validation + Launch Motion Film | P1 | pending | 0/6 |

---

## Phases & tasks

Status values: `pending` | `in_progress` | `completed`

### 0 · Foundation (`0-foundation`) — infra — completed

**Goal:** Config, DB, and provider shells so every module can wire in.  
**Depends on:** —

| ID        | Task                                                              | Status    |
| --------- | ----------------------------------------------------------------- | --------- |
| f-env     | ConfigModule + .env (POSTGRES_URL, Tokens, Alchemy, Jupiter, LLM) | completed |
| f-db      | DatabaseModule — Drizzle client, inject db, migrate script        | completed |
| f-tokens  | TokensModule — HTTP client + normalize Equity / TokenizedEquity   | completed |
| f-alchemy | AlchemyModule — balances, tx status, history helpers              | completed |
| f-common  | common/ — errors, wallet validation, response helpers             | completed |

### 1 · Portfolio Spine (`1-portfolio`) — P0 — completed

**Goal:** Wallet → Alchemy → Tokens resolve → prices → portfolio + stock detail + chart.  
**Depends on:** `0-foundation`

| ID          | Task                                                           | Endpoint                        | Status    |
| ----------- | -------------------------------------------------------------- | ------------------------------- | --------- |
| p-construct | PortfolioService — balances → resolveMint → price → Position[] | GET /portfolio/:wallet          | completed |
| p-endpoint  | Ship GET /portfolio/:wallet (available + locked + cash)        | GET /portfolio/:wallet          | completed |
| p-snapshot  | Write portfolio_snapshots on refresh / after mutations         | GET /portfolio/:wallet/history  | completed |
| p-history   | GET /portfolio/:wallet/history from snapshots                  | GET /portfolio/:wallet/history  | completed |
| p-activity  | GET /portfolio/:wallet/activity (Oren + Alchemy)               | GET /portfolio/:wallet/activity | completed |
| p-stocks    | GET /stocks + /stocks/search via Tokens                        | GET /stocks                     | completed |
| p-detail    | GET /stocks/:assetId detail payload                            | GET /stocks/:assetId            | completed |
| p-chart     | GET /stocks/:assetId/chart (normalized candles)                | GET /stocks/:assetId/chart      | completed |
| p-trending  | GET /markets/trending                                          | GET /markets/trending           | completed |

### 2 · Trading (`2-trading`) — P0 — completed

**Goal:** Equity intent → variant → Jupiter quote → prepared tx → confirm → refresh.  
**Depends on:** `1-portfolio`  
**Note:** Also shipped `POST /execution/confirm` (lifecycle + portfolio refresh).

| ID        | Task                                                            | Endpoint                | Status    |
| --------- | --------------------------------------------------------------- | ----------------------- | --------- |
| t-jupiter | JupiterService — getQuote, prepareSwap, validateQuote           |                         | completed |
| t-resolve | Representation selection using Tokens variants + Jupiter output |                         | completed |
| t-quote   | POST /execution/quote from TradeIntent                          | POST /execution/quote   | completed |
| t-prepare | POST /execution/prepare → base64 tx for wallet sign             | POST /execution/prepare | completed |
| t-record  | Persist executions row + lifecycle status transitions           |                         | completed |
| t-refresh | Post-confirm: Alchemy refresh → portfolio → snapshot            |                         | completed |

### 3 · Intelligence (`3-intelligence`) — P0 — completed

**Goal:** OHLCV → indicators → Oren Score → opportunities → analysis.  
**Depends on:** `1-portfolio`

| ID           | Task                                                     | Endpoint                      | Status    |
| ------------ | -------------------------------------------------------- | ----------------------------- | --------- |
| i-indicators | Indicators: momentum, RSI, SMA, volatility, volume trend |                               | completed |
| i-score      | Opportunity score 0–100 with transparent dimensions      |                               | completed |
| i-persist    | Persist stock_signals; periodic job / on-demand refresh  |                               | completed |
| i-analysis   | GET /stocks/:assetId/analysis                            | GET /stocks/:assetId/analysis | completed |
| i-opps       | GET /markets/opportunities ranked + highlights           | GET /markets/opportunities    | completed |

### 4 · News (`4-news`) — P0 — completed

**Goal:** Tokens news → stock page + agent context (+ optional cache).  
**Depends on:** `1-portfolio`

| ID         | Task                                                      | Endpoint                  | Status    |
| ---------- | --------------------------------------------------------- | ------------------------- | --------- |
| n-service  | NewsModule / NewsService wrapping Tokens news             |                           | completed |
| n-endpoint | GET /stocks/:assetId/news                                 | GET /stocks/:assetId/news | completed |
| n-cache    | Optional cached_news for 5–15m TTL                        |                           | completed |
| n-context  | getNewsContextForAgent helper for portfolio-aware digests |                           | completed |

### 5 · Agent (`5-agent`) — P0 — completed

**Goal:** Tool-driven chat: propose only — user always signs money moves.  
**Depends on:** `1-portfolio`, `2-trading`, `3-intelligence`, `4-news`

| ID          | Task                                                            | Endpoint            | Status    |
| ----------- | --------------------------------------------------------------- | ------------------- | --------- |
| a-tools     | Implement AgentTools (portfolio, stock, news, analysis, quote…) |                     | completed |
| a-safety    | Safety: propose → prepare → USER reviews → USER signs           |                     | completed |
| a-endpoint  | POST /agent/message (+ optional streaming later)                | POST /agent/message | completed |
| a-persist   | Optional agent_threads / agent_messages persistence             |                     | completed |
| a-artifacts | Return structured artifacts (basket, quote, analysis)           |                     | completed |

### 6 · Vault (`6-vault`) — P0 — completed

**Goal:** Lock/unlock via timelock program client; index; portfolio reflects locked.  
**Depends on:** `1-portfolio`  
**Program:** `program/` (Anchor) — app integrates + indexes only.
**Note:** V1 uses tested manual instruction builders; IDL import/verification is a tracked follow-up after MVP stabilization.

| ID          | Task                                                        | Endpoint                    | Status    |
| ----------- | ----------------------------------------------------------- | --------------------------- | --------- |
| v-client    | Manual Solana/Anchor instruction builders for lock + unlock |                             | completed |
| v-list      | GET /vaults/:wallet (indexed + enriched)                    | GET /vaults/:wallet         | completed |
| v-lock      | POST /vaults/prepare-lock + confirm-lock                    | POST /vaults/prepare-lock   | completed |
| v-unlock    | POST /vaults/prepare-unlock + confirm-unlock                | POST /vaults/prepare-unlock | completed |
| v-index     | Index vault_positions; never override onchain truth         |                             | completed |
| v-portfolio | Post-confirm portfolio refresh + locked valuation metadata  |                             | completed |

### 7 · Basket + Polish (`7-basket`) — P1 — completed

**Goal:** Basket generate/execute (sequential OK) + API hardening for demo.  
**Depends on:** `2-trading`, `3-intelligence`, `5-agent`

| ID       | Task                                                     | Status    |
| -------- | -------------------------------------------------------- | --------- |
| b-gen    | createBasket tool — allocations + thesis + risk label    | completed |
| b-exec   | prepareBasketPurchase — sequential legs + progress model | completed |
| b-errors | Consistent error shapes + quote expiry handling          | completed |
| b-demo   | End-to-end API walkthrough for core demo script          | completed |

### 8 · App Data Foundation (`8-app-data`) — P0 — completed

**Goal:** Lock the frontend data contract before UI work: API responses are typed, service functions map to Nest routes, and Zustand stores are the only data source components should consume.  
**Depends on:** `0-foundation` through `7-basket`

| ID         | Task                                                                 | Status    |
| ---------- | -------------------------------------------------------------------- | --------- |
| app-types  | Define frontend domain types for portfolio, stocks, execution, agent, vault | completed |
| app-services | Create API client + service functions for shipped Nest endpoints   | completed |
| app-stores | Create Zustand stores consuming services for portfolio, market, stock, agent, execution, vault | completed |
| app-flow   | Establish data flow: API endpoints → `services/` → `store/` → future components | completed |

### 9 · App Shell (`9-app-shell`) — P0 — completed

**Goal:** Replace the starter page with the real Oren application shell and routing structure without building isolated screens in the wrong order.  
**Depends on:** `8-app-data`

| ID          | Task                                                                  | Status  |
| ----------- | --------------------------------------------------------------------- | ------- |
| shell-layout | App frame with header/sidebar/main content/agent panel zones          | completed |
| shell-nav    | Navigation for Portfolio, Markets, Vault, Activity, and stock routes  | completed |
| shell-wallet | Solana wallet connect/disconnect state and address propagation        | completed |
| shell-ui     | Base UI primitives: button, card, tabs, table/list, modal/drawer, toast | completed |
| shell-states | Shared loading, empty, error, and transaction feedback patterns       | completed |
| shell-theme  | Oren visual system: typography, color tokens, spacing, responsive rules | completed |

### 10 · Portfolio UI (`10-portfolio-ui`) — P0 — completed

**Goal:** Connect wallet → portfolio store → dashboard view with available + locked value clearly represented.  
**Depends on:** `9-app-shell`

| ID             | Task                                                                  | Status  |
| -------------- | --------------------------------------------------------------------- | ------- |
| ui-portfolio-load | Load portfolio/history/activity from `usePortfolioStore`          | completed |
| ui-portfolio-summary | Total value, available value, locked value, cash, day change  | completed |
| ui-portfolio-chart | Historical value chart with empty-history handling                | completed |
| ui-positions   | Position list with allocation, available quantity, locked quantity    | completed |
| ui-activity    | Recent activity feed from Oren + Alchemy activity                     | completed |
| ui-portfolio-refresh | Refresh and post-transaction reload behavior                   | completed |

### 11 · Markets + Stock UI (`11-markets-stock-ui`) — P0 — completed

**Goal:** Let users discover canonical equities and open a full stock page without exposing token issuer complexity.  
**Depends on:** `9-app-shell`, `10-portfolio-ui`

| ID              | Task                                                                  | Status  |
| --------------- | --------------------------------------------------------------------- | ------- |
| ui-markets-load | Load stocks, trending, and opportunities from `useMarketStore`        | completed |
| ui-search       | Search by company/ticker with canonical equity results                | completed |
| ui-market-lists | Trending, opportunities, and browsable stock lists                    | completed |
| ui-stock-route  | Dynamic stock detail route by `assetId`                               | completed |
| ui-stock-chart  | Lightweight chart integration using normalized candles                | completed |
| ui-stock-intel  | Oren Score, analysis, signals, risks, and highlights                  | completed |
| ui-stock-news   | Compact relevant news feed                                            | completed |

### 12 · Agent UI (`12-agent-ui`) — P0 — completed

**Goal:** Make Oren feel like a persistent investing copilot that uses real tool outputs and artifacts.  
**Depends on:** `9-app-shell`, `10-portfolio-ui`, `11-markets-stock-ui`

| ID             | Task                                                                  | Status  |
| -------------- | --------------------------------------------------------------------- | ------- |
| ui-agent-panel | Persistent agent panel available across core pages                    | completed |
| ui-agent-chat  | Message composer/history using `useAgentStore`                        | completed |
| ui-agent-tools | Honest tool/activity states without fake progress                     | completed |
| ui-agent-artifacts | Render portfolio, stock, analysis, opportunity, quote, basket artifacts | completed |
| ui-agent-actions | Convert proposed actions into review flows, never auto-sign        | completed |

### 13 · Trading + Basket UI (`13-trading-ui`) — P0 — completed

**Goal:** Turn buy/sell and basket intents into quote → review → wallet signature → confirmation flows.  
**Depends on:** `10-portfolio-ui`, `11-markets-stock-ui`, `12-agent-ui`

| ID              | Task                                                                  | Status  |
| --------------- | --------------------------------------------------------------------- | ------- |
| ui-trade-ticket | Buy/sell ticket for canonical equities                                | completed |
| ui-quote-review | Quote review with expiry, price impact, route summary, warnings       | completed |
| ui-sign-flow    | Wallet signing handoff for prepared transactions                      | completed |
| ui-confirm-flow | Confirmation polling/result display + portfolio refresh               | completed |
| ui-basket-review | Basket allocation review with per-leg progress                       | completed |
| ui-trade-errors | No route, insufficient balance, rejected signature, expired quote states | completed |

### 14 · Social Trading (`14-social-trading`) — P0 — completed

**Goal:** Let users discover top-performing wallets, inspect public trader portfolios, and ask Oren to prepare safe copy-portfolio proposals without ever signing on the user's behalf.  
**Depends on:** `10-portfolio-ui`, `12-agent-ui`, `13-trading-ui`

| ID                    | Task                                                                  | Endpoint                         | Status  |
| --------------------- | --------------------------------------------------------------------- | -------------------------------- | ------- |
| social-profile-model  | Public trader profile model: wallet address, slug, display name, opt-in visibility, avatar/metadata |                                  | completed |
| social-pnl-engine     | Deterministic P&L ranking metrics from portfolio snapshots, executions, and current valuation |                                  | completed |
| social-leaderboard-api | Ranked leaderboard with timeframe filters, P&L, return %, portfolio value, volatility/risk labels | GET /social/leaderboard          | completed |
| social-trader-api     | Public trader profile payload with holdings, allocation, portfolio chart, activity, and visibility checks | GET /social/traders/:slug        | completed |
| social-leaderboard-ui | Leaderboard route/table with rank, P&L, return %, value, timeframe controls, and profile links |                                  | completed |
| social-profile-ui     | Trader wallet/profile page with holdings, amounts, allocation, portfolio chart, and performance context |                                  | completed |
| social-copy-agent     | Agent tool/artifact for "copy this portfolio" that produces a reviewable rebalance/basket proposal only | POST /social/copy-portfolio/prepare | completed |

### 15 · Trading Calendar (`15-trading-calendar`) — P0 — completed

**Goal:** Turn portfolio history into a calendar-based trading memory: daily P&L, significant events, and drilldowns that explain how performance unfolded.  
**Depends on:** `10-portfolio-ui`, `12-agent-ui`, `13-trading-ui`, `14-social-trading`

| ID                  | Task                                                                  | Endpoint                                  | Status  |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ------- |
| calendar-data-model | Daily performance/events model derived from snapshots, executions, vault events, and agent actions |                                           | completed |
| calendar-pnl-engine | Calculate daily P&L, return %, realized/unrealized movement, best/worst contributors, and cumulative value |                                           | completed |
| calendar-api        | Personal trading calendar with month/range filters and day summaries  | GET /portfolio/:wallet/calendar           | completed |
| calendar-day-api    | Day drilldown with trades, holdings impact, deposits/withdrawals, notable events, and market context | GET /portfolio/:wallet/calendar/:date     | completed |
| calendar-ui         | Calendar grid with green/red intensity, event markers, filters, and responsive day drawer |                                           | completed |
| calendar-agent      | Agent summaries for daily/weekly patterns, biggest wins/losses, drawdowns, and social profile context |                                           | completed |

### 16 · Vault UI (`16-vault-ui`) — P0 — completed

**Goal:** Surface locked positions as part of net worth and prepare lock/unlock transactions safely.  
**Depends on:** `10-portfolio-ui`, `13-trading-ui`

| ID              | Task                                                                  | Status  |
| --------------- | --------------------------------------------------------------------- | ------- |
| ui-vault-load   | Load vault positions from `useVaultStore`                             | completed |
| ui-vault-list   | Active locks, value, unlock date, time remaining                      | completed |
| ui-lock-flow    | Lock amount/date review → prepare transaction → wallet sign           | completed |
| ui-unlock-flow  | Unlock eligibility display and prepare-unlock flow                    | completed |
| ui-vault-safety | Premature unlock, failed transaction, and stale index handling         | completed |

### 17 · Demo Polish (`17-demo-polish`) — P1 — in_progress

**Goal:** Make the MVP demo coherent, responsive, and resilient across the full product story.  
**Depends on:** `10-portfolio-ui` through `16-vault-ui`. Prefer landing `18-agent-ta` before the demo script if “ask Oren to analyze a stock” is a beat.

| ID          | Task                                                                  | Status  |
| ----------- | --------------------------------------------------------------------- | ------- |
| polish-responsive | Desktop and mobile layouts for dashboard, stock, agent, review flows | in_progress |
| polish-loading    | Skeletons and optimistic pending states where appropriate          | pending |
| polish-copy       | Clear finance-safe copy for scores, quotes, risks, and agent actions | pending |
| polish-demo       | Run the core demo script end to end against real API responses      | pending |
| polish-build      | Lint/build pass and fix frontend regressions                        | completed |
| polish-launch-video | Create and validate the revised 25-second landscape launch film with editable source and MP4 | completed |
| polish-launch-music | Generate and review ElevenLabs music for the approved landscape film | completed |

### 18 · Agent Technical Analysis (`18-agent-ta`) — P0 — completed

**Goal:** Give the agent a deterministic technical-analysis brief (regime, levels, setup, multi-timeframe indicators, summary) so “analyze this stock” is one tool result, not improvised chat.  
**Depends on:** `3-intelligence`, `5-agent`, `12-agent-ui`  
**Contract:** LLM explains the brief. It does not invent indicators, support/resistance, or a buy/sell instruction. Do not retune Oren Score weights in this phase.

| ID             | Task                                                                 | Endpoint                      | Status  |
| -------------- | -------------------------------------------------------------------- | ----------------------------- | ------- |
| ta-indicators  | MACD, ATR, Bollinger, SMA200; extend daily OHLCV lookback to ~1Y     |                               | completed |
| ta-structure   | Swing S/R, trend regime, setup class, weekly resample, optional 1H   |                               | completed |
| ta-brief       | `TechnicalBrief` types + deterministic `summary` on `StockAnalysis`  | GET /stocks/:assetId/analysis | completed |
| ta-agent       | Composite `analyzeStock` payload + TA playbook in agent prompt       |                               | completed |
| ta-ui          | Richer analysis artifact + stock-detail TA section from the same payload |                           | completed |
| ta-tests       | Indicator fixtures, brief snapshots, agent artifact + app coverage   |                               | completed |

### 19 · Jupiter Limit Orders (`19-limit-orders`) — P0 — completed

**Goal:** Jupiter Trigger V1 limit orders with deterministic TA price zones, agent proposals, and auto-refreshing market quotes.  
**Depends on:** `2-trading`, `13-trading-ui`, `18-agent-ta`  
**Contract:** Propose → user reviews → prepare → user signs. Agent never prepares. Jupiter remains the order ledger.

| ID              | Task                                                                 | Endpoint                              | Status    |
| --------------- | -------------------------------------------------------------------- | ------------------------------------- | --------- |
| lo-zones        | Deterministic `limitZones` on TechnicalBrief from swing S/R / Bollinger |                                   | completed |
| lo-trigger      | Trigger V1 client + USD→making/taking conversion                     |                                       | completed |
| lo-api          | Propose/prepare/confirm/list/cancel + `limit_orders` table           | POST /execution/limit-order…          | completed |
| lo-agent        | `proposeLimitOrder` / `getLimitOrders` tools + artifacts             |                                       | completed |
| lo-ui           | Stock ticket Limit tab, review modal, open-order cancel, agent handoff |                                     | completed |
| lo-quote-refresh| Auto-regenerate market quotes on expiry (ticket + review + agent)    |                                       | completed |

### 20 · Bitget Live Market Context (`20-bitget-market`) — P0 — completed

**Goal:** Add live Bitget Reality venue evidence to Oren's existing portfolio-aware research agent without changing Solana portfolio or Jupiter execution truth.  
**Depends on:** `1-portfolio`, `4-news`, `5-agent`, `12-agent-ui`, `18-agent-ta`  
**Contract:** Bitget is attributed research context. It never replaces wallet valuation, Oren's canonical stock model, or Jupiter execution quotes.

| ID              | Task                                                                 | Endpoint | Status    |
| --------------- | -------------------------------------------------------------------- | -------- | --------- |
| bg-service      | Official V3 Reality stock-info, ticker, candles/history, and states  |          | completed |
| bg-normalize    | Canonical ticker → rToken resolution and normalized quote/OHLC types |          | completed |
| bg-resilience   | Parallel calls, bounded timeout, in-flight dedupe, fresh/stale cache |          | completed |
| bg-agent        | `getBitgetMarketContext` tool, grounded prompt policy, history restore | POST /agent/message(/stream) | completed |
| bg-ui           | Tool trace label and compact Bitget Reality source artifact          |          | completed |
| bg-tests        | Mapper/service/tool tests, real Bitget NVDA smoke, API/app builds    |          | completed |

### 21 · Volume Analytics + Dune (`21-volume-analytics`) — P0 — in_progress

**Goal:** Publicly aggregate only verified stock volume routed through Oren, without putting analytics or Dune on the user transaction path.  
**Depends on:** `2-trading`, `7-basket`, `14-social-trading`, `19-limit-orders`  
**Contract:** Quotes, open orders, transfers, and vault activity are never volume. Only finalized stock/USDC wallet deltas count; public APIs never expose wallets.

| ID              | Task                                                                 | Endpoint | Status    |
| --------------- | -------------------------------------------------------------------- | -------- | --------- |
| vol-schema      | `trade_fills`, durable execution jobs, attribution, migration        |          | completed |
| vol-submit      | Exact execution IDs + submitted response; no RPC/Dune in confirm     | POST /execution/confirm | completed |
| vol-worker      | Finalized Alchemy receipt parser, retries, idempotency, health signal |          | completed |
| vol-limit       | Background Jupiter Trigger fill discovery; open/cancelled count zero |          | completed |
| vol-api         | Public overview, stock, feature, per-stock, and status APIs          | GET /analytics/volume… | completed |
| vol-ui          | Keep Oren volume details on Dune; omit volume displays from app       |          | completed |
| vol-dune        | Tracking account + public signature/mint uploads + saved dashboard   |          | in_progress |

---

### 22 · Panta Integration Foundation (`22-panta-foundation`) — P0 — in_progress

**Goal:** Verify Panta integration access before promising native creation or trading; implement on feat/panta.  
**Depends on:** 1-portfolio, 5-agent, 12-agent-ui  
**Branch:** `feat/panta`  
**Contract:** Research and draft autonomously; explicit user review gates creation and money moves. Proposed routes below are Oren routes, not verified Panta API paths. Solana/provider state is the ledger; Postgres stores drafts and observations only.

| ID | Task | Proposed endpoint | Status |
| --- | --- | --- | --- |
| pa-access | Verify official API/SDK, credentials, rate limits, market search/detail, creation, artwork upload, external-wallet signing, settlement and supported regions; record actual supported capabilities |  | in_progress |
| pa-contract | Document provider payloads, market phases, fees, payout math, resolution/dispute rules and unavailable capabilities; never assume a winning share pays $1 |  | completed |
| pa-provider | Add NestJS Panta provider and api/types contracts with server-side credentials, timeouts, caching, attribution and fresh/stale timestamps |  | completed |
| pa-model | Normalize provider IDs, canonical stock links, underlying versus tokenized prices, YES/NO terms, order depth, deadlines and resolution state |  | completed |
| pa-gate | Verify read-only provider smoke; native write phases depend on documented support, with unsupported actions shown explicitly rather than fake completion |  | in_progress |

### 23 · Panta Discover Agent (`23-panta-discover`) — P0 — pending

**Goal:** Connect existing prediction markets to stock theses and wallet holdings through the existing Oren sidecar.  
**Depends on:** 22-panta-foundation, 18-agent-ta, 20-bitget-market  
**Branch:** `feat/panta`  
**Contract:** Research and draft autonomously; explicit user review gates creation and money moves. Proposed routes below are Oren routes, not verified Panta API paths. Solana/provider state is the ledger; Postgres stores drafts and observations only.

| ID | Task | Proposed endpoint | Status |
| --- | --- | --- | --- |
| pd-search | Search/filter relevant company, stock-versus-stock and macro markets; rank by relevance, activity, freshness and executable depth | GET /predictions/markets | pending |
| pd-detail | Return full rules, sources, dates/timezone, phase, fees, payouts and liquidity; distinguish spot price from probability | GET /predictions/markets/:marketId | pending |
| pd-research | Research official disclosures and news with dated citations, counterarguments and uncertainty; keep event signals separate from deterministic Oren Score |  | pending |
| pd-agent | Add searchPredictionMarkets, getPredictionMarket and researchPredictionMarket tools with portfolio context and grounded tool traces |  | pending |
| pd-ui | Render Discover thesis cards and stock event cards with evidence, portfolio relevance, liquidity, deadlines and Panta attribution |  | pending |
| pd-checks | Verify relevance mapping, weak/stale evidence, missing markets, provider outages and restored agent artifacts |  | pending |

### 24 · Panta Create Agent + Proposal Sheet (`24-panta-create`) — P0 — pending

**Goal:** Turn natural-language ideas into researched market drafts, editable review sheets and exact approved Panta submissions.  
**Depends on:** 22-panta-foundation, 23-panta-discover, 13-trading-ui  
**Branch:** `feat/panta`  
**Contract:** Research and draft autonomously; explicit user review gates creation and money moves. Proposed routes below are Oren routes, not verified Panta API paths. Solana/provider state is the ledger; Postgres stores drafts and observations only.

| ID | Task | Proposed endpoint | Status |
| --- | --- | --- | --- |
| pc-intent | Parse market intent and research feasibility; ask only material questions, suggest defaults and detect duplicate or near-duplicate existing markets |  | pending |
| pc-rules | Draft objective YES/NO criteria, event start/end/timezone, primary resolution source, fallback and tie/missing-data/corporate-action handling |  | pending |
| pc-versus | Support stock-versus-stock templates using percentage returns over exact dates and sessions; specify underlying price source and tie outcome |  | pending |
| pc-artwork | Reuse canonical stock logos; compose single-stock and paired versus artwork with preview, upload validation and neutral fallback |  | pending |
| pc-draft | Persist versioned drafts and cited research as app memory; validate provider fields and separate thesis explanation from binding resolution rules | POST /predictions/creation/propose | pending |
| pc-sheet | Reuse proposal-sheet interaction with editable title, description, rules, source, dates, artwork, fees/funding and complete final API payload preview |  | pending |
| pc-integrity | Bind approval to a validated draft version/payload; any changed rules, fees or artwork invalidate approval; reject expired or unsupported drafts |  | pending |
| pc-prepare | Prepare provider-supported creation from explicit sheet approval; user reviews required wallet actions and signs, agent never signs or broadcasts | POST /predictions/creation/prepare | pending |
| pc-confirm | Confirm provider/onchain result with idempotency, rejected-signature and retry recovery; return actual market ID/link and refresh created markets | POST /predictions/creation/confirm | pending |
| pc-checks | Verify idea-to-live flow, ambiguous rules, duplicate markets, source failure, invalid artwork, edited approval, fee changes and duplicate submission |  | pending |

### 25 · Prediction Positions + Thesis Watch (`25-panta-positions`) — P1 — pending

**Goal:** Support reviewed event positions and meaningful thesis updates while preserving user authority over money moves.  
**Depends on:** 23-panta-discover, 24-panta-create  
**Branch:** `feat/panta`  
**Contract:** Research and draft autonomously; explicit user review gates creation and money moves. Proposed routes below are Oren routes, not verified Panta API paths. Solana/provider state is the ledger; Postgres stores drafts and observations only.

| ID | Task | Proposed endpoint | Status |
| --- | --- | --- | --- |
| pp-propose | Prepare a requested YES/NO thesis proposal with evidence, countercase, cost, actual payout scenarios and maximum loss; no invented confidence | POST /predictions/trades/propose | pending |
| pp-execute | Implement provider-supported quote, prepare, wallet sign and confirmation; refresh stale quotes and terms before signing | POST /predictions/trades/prepare; POST /predictions/trades/confirm | pending |
| pp-holdings | Index authoritative positions and created markets; separate event exposure from equity allocation and show mark value, claimable payout and settlement state | GET /predictions/positions/:wallet; GET /predictions/created/:wallet | pending |
| pp-lifecycle | Implement supported sell/cancel/claim actions with review and wallet signature; handle acquisition-phase exit restrictions and disputes |  | pending |
| pp-watch | Add explicit opt-in thesis watches for new evidence, deadlines and meaningful market changes; dedupe alerts, cite changes and provide stop controls |  | pending |
| pp-checks | Verify signing rejection, insufficient funds/depth, expired quotes, partial fills, delayed resolution, claim recovery and quiet unchanged watches |  | pending |

### 26 · Panta Validation + Launch Motion Film (`26-panta-launch`) — P1 — pending

**Goal:** Validate the shipped Discover/Create story, then make a dedicated Oren + Panta launch film using the main-product film as the creative reference.  
**Depends on:** 23-panta-discover, 24-panta-create; include 25-panta-positions only when verified  
**Branch:** `feat/panta`  
**Contract:** Research and draft autonomously; explicit user review gates creation and money moves. Proposed routes below are Oren routes, not verified Panta API paths. Solana/provider state is the ledger; Postgres stores drafts and observations only.

| ID | Task | Proposed endpoint | Status |
| --- | --- | --- | --- |
| pl-smoke | Run real connected Discover and reviewed creation smoke on feat/panta, verifying approved payload matches provider submission and final market |  | pending |
| pl-quality | Run relevant API/app checks; verify responsive proposal sheets, accessible edit/review flow, recoverable errors and credential-safe logs |  | pending |
| pl-assets | Obtain official Panta logo/brand assets; assemble Oren mascot, stock logos, versus cards and screenshots from shipped flows |  | pending |
| pl-story | Write motion storyboard: ask Oren, discover relevant events, describe a market, research/rules/artwork, review proposal, user signs, live Panta market |  | pending |
| pl-film | After feature validation, create editable motion source and final MP4 with Oren/Panta branding and music, matching the main launch film creative quality |  | pending |
| pl-review | Verify timing, legibility, branding, audio and export; human creative review before publication; do not depict unsupported API actions as shipped |  | pending |

---

## Endpoints checklist

Mark `shipped` when the route is implemented and type-aligned.

| Endpoint                        | Shipped |
| ------------------------------- | ------- |
| GET /portfolio/:wallet          | yes     |
| GET /portfolio/:wallet/history  | yes     |
| GET /portfolio/:wallet/activity | yes     |
| GET /stocks                     | yes     |
| GET /stocks/search              | yes     |
| GET /stocks/:assetId            | yes     |
| GET /stocks/:assetId/chart      | yes     |
| GET /markets/trending           | yes     |
| POST /execution/quote           | yes     |
| POST /execution/prepare         | yes     |
| POST /execution/confirm         | yes     |
| POST /execution/basket          | yes     |
| POST /execution/basket/prepare  | yes     |
| POST /execution/limit-order     | yes     |
| POST /execution/limit-order/prepare | yes |
| POST /execution/limit-order/confirm | yes |
| GET /execution/limit-orders/:wallet | yes |
| POST /execution/limit-order/prepare-cancel | yes |
| POST /execution/limit-order/confirm-cancel | yes |
| GET /stocks/:assetId/analysis   | yes     |
| GET /markets/opportunities      | yes     |
| GET /signals/:assetId           | yes     |
| GET /stocks/:assetId/news       | yes     |
| POST /agent/message             | yes     |
| POST /agent/message/stream      | yes     |
| GET /agent/threads/:threadId/messages | yes |
| GET /vaults/:wallet             | yes     |
| POST /vaults/prepare-lock       | yes     |
| POST /vaults/prepare-unlock     | yes     |
| POST /vaults/confirm-lock       | yes     |
| POST /vaults/confirm-unlock     | yes     |
| GET /social/leaderboard         | yes     |
| GET /social/traders/:slug       | yes     |
| POST /social/copy-portfolio/prepare | yes |
| GET /portfolio/:wallet/calendar | yes     |
| GET /portfolio/:wallet/calendar/:date | yes |
| GET /analytics/volume           | yes     |
| GET /analytics/volume/stocks    | yes     |
| GET /analytics/volume/features  | yes     |
| GET /stocks/:assetId/volume     | yes     |
| GET /execution/:executionId/status | yes  |

---

### Proposed Panta endpoints (not shipped)

Oren route names are provisional until Phase 22 validates provider capabilities.

| Endpoint | Shipped |
| --- | --- |
| GET /predictions/markets | no |
| GET /predictions/markets/:marketId | no |
| POST /predictions/creation/propose | no |
| POST /predictions/creation/prepare | no |
| POST /predictions/creation/confirm | no |
| POST /predictions/trades/propose | no |
| POST /predictions/trades/prepare | no |
| POST /predictions/trades/confirm | no |
| GET /predictions/positions/:wallet | no |
| GET /predictions/created/:wallet | no |

---

## How agents should update this file

1. Flip task `Status` cells when work starts/finishes.
2. Update **Active phase**, progress summary counts, and **Status / Notes**.
3. Flip endpoint rows to `yes` when routes land.
4. Sync the same changes into [`api-build-board.html`](api-build-board.html).
