# Panta foundation — Phase 22

Branch: `feat/panta`. Contract reviewed on 2026-10-07. Backend only; no public prediction routes, agent tools, database changes, signing or writes.

## Verified documentation and capability matrix

Primary sources: [official API source](https://github.com/Kaito-HQ/panta-api-pub), [reference playground](https://github.com/Kaito-HQ/panta-api-playground), [authentication](https://docs.panta.market/guides/authentication), [errors](https://docs.panta.market/guides/errors), [terms](https://docs.panta.market/guides/terms-of-use).

Production base URL: `https://live-api.panta.market/api/v1`. Playground also names `https://staging-api.panta.market/api/v1`. Use explicit backend configuration; never infer the Solana cluster from `pk_test_`/`pk_live_`. Both prefixes are accepted by the public API. Confirm program IDs, USDC mint and RPC cluster with Panta before any write smoke.

| Capability | Documented contract | Foundation implementation | Live verification |
| --- | --- | --- | --- |
| Catalog/filtering | `GET /markets/`; category, status, createdBy=me, opaque cursor, limit default 20/max 50 | Implemented in PantaService | Passed 2026-10-07 |
| Spot detail | `GET /markets/{marketId}/`; base58 event address | Implemented; validates returned identity | Passed 2026-10-07 |
| Categories | `GET /categories/`; categories string array | Implemented | Passed 2026-10-07 |
| Text search | No text-query parameter in documented list contract | Not implemented; Phase 23 must use documented filters and local relevance matching | Not verified |
| Image upload | `POST /markets/create/image-upload/`; signed Cloudinary fields, then external upload | Documented only; no uploads | Not exercised |
| Create quote | `POST /markets/create/quote/`; short-lived createId, fee and expectedEventPda | Documented only; no quote sessions created | Not exercised |
| Create build | `POST /markets/create/build/`; createId and optional matching wallet → unsigned base64 VersionedTransaction | Documented only | Not exercised |
| Register | `POST /markets/register/`; createId + broadcast signature, verified fees/accounts/program | Documented only; identical createId/signature is idempotent | Not exercised |
| External wallet | Client signs and broadcasts on its RPC; API holds no private keys | No signing or broadcast code added | Cluster/program checks pending |
| Primary buy | `/primaryorderquote/`, `/primaryorderbuild/`, `/primaryordersubmit/`, `/primaryorderverify/` | Documented only | Not exercised |
| Secondary trading/depth | Public product describes secondary trading; inspected API reference does not document orderbook/sell/cancel routes | Unavailable; do not promise native secondary execution | Provider clarification needed |
| Positions | `GET /positions/?wallet=`; side-specific share quantities, claim flags, indexer lag and typical 200-row cap | Documented only | Not exercised |
| Claims | `/claim/build/` and `/claim/creator-fees/build/`; unsigned instructions | Documented only; win claims may be reported to /trades/, creator-fee claims must not be | Not exercised |

## Authentication, read shapes and missing data

All implemented calls use server-side `X-Api-Key`; docs also accept Bearer access JWT. Keys in query strings are rejected. No account signup, login or key issuance is performed by this integration.

List responses are `{ items, nextCursor? }`; detail is a direct catalog item, not an envelope; categories are `{ categories }`. List prices are deliberately null. Detail prices may be null when RPC is unavailable. Catalog fields include marketId/title/category/description/images, phase/status/type/region, Unix-second timestamps and human-readable volume/price strings.

The documented catalog read shape does not expose the contractual question, resolutionRule, sourcesOfTruth, winning payout, depth or liquidity. They remain null in normalized results. Title is preserved as a display title, never silently promoted to contractual rules. Numeric monetary values are unavailable rather than accepted with potentially lost precision. Decimal strings are retained without arithmetic; volume base-unit alternatives are not confused with human USDC.

The mapper returns no stock associations by default. `linkPantaStocks` accepts a caller-supplied canonical directory and exact uppercase ticker tokens, accepting only one distinct canonical asset per ticker. It never guesses from company names. No explicit stock metadata is currently documented; price reference remains unknown.

**Settlement documentation conflict:** the [public how-it-works page](https://www.panta.market/how-it-works) describes parimutuel winning payouts and a one-hour dispute window; the [API positions guide](https://docs.panta.market/api-reference/positions) describes an approximate $1/share winning settlement. Do not hardcode either model, a payout, or a probability conversion. Confirm the deployed program/market behavior and payout source with Panta before Phase 25 valuation/claims. Resolution-rule retrieval, dispute state and oracle verification are also not available in the inspected catalog contract.

## Create handoff for Phase 24

Quote input: wallet, question (max 512), resolutionRule (max 2048), nonempty sourcesOfTruth (max 20), allowed category, Unix-second startTime/endTime/resolutionTime, and one public HTTP(S) imageUrl (max 2048). Optional marketType=standard/breaking, title, description, region, oracle, eventInProgress (breaking only).

Times must satisfy `startTime < endTime <= resolutionTime`. API guidance uses the onchain minimumStartDelay, typically 3600 seconds; eventInProgress may relax the start delay for breaking markets, but endTime must remain future. The public product page's 72-hour classification is not a substitute for API/onchain validation.

Creation quote/build `paymentUsdc`, liquidityInjectionUsdc and platformRevenueUsdc are integer base-unit strings (6 decimals). Primary buy requests use human-readable decimal USDC strings. Keep these units separate. Never infer fees from the public pricing page; use the approved quote. Quote returns createId/expectedEventPda/paymentUsdc/marketType/expiresAt; session TTL is typically five minutes. Build returns transaction/recentBlockhash/lastValidBlockHeight/buildFingerprint and derived addresses. User signs; app broadcasts; register verifies and records catalog metadata. A changed proposal must be re-quoted and re-approved.

Upload helper uses signed Cloudinary fields. Reference client allows PNG/JPEG/WebP/GIF up to 5 MB and recommends 1024-square artwork; the API quote itself soft-checks the public image URL. These are separate validation layers. No artwork request was sent in Phase 22.

## Runtime behavior and verification

Configuration: `PANTA_ENABLED=false` by default. When enabled, explicitly supply PANTA_API_BASE_URL and PANTA_API_KEY; PANTA_REQUEST_TIMEOUT_MS defaults to 8000. Existing Oren startup remains unchanged when disabled. PantaModule exports the read provider without a controller.

Reads use a 30-second fresh cache and transient-error fallback only while the original response is less than five minutes old, with explicit stale flags on the page and all items. Responses are cloned to prevent caller mutation. Cache holds at most 200 entries, with expired cleanup and oldest-entry eviction. Concurrent reads of the same path share one request. No write or quote caching exists.

Provider errors use sanitized Oren codes: disabled/not-configured, bad-request, unauthorized, forbidden, not-found, rate-limited, invalid-response, timeout and unavailable. Upstream bodies/messages and fetch causes are never exposed or logged. Authentication, malformed payload and not-found failures do not fall back to cached results. Redirects are rejected to avoid forwarding the API key to another target.

Documented default read limit is 120 requests/account/60s (deployments can override). Other families: positions 60, quote 30, build 20, register 40 and upload 10 per 60s. Response headers expose limit/remaining/reset and Retry-After. The provider honors Retry-After with a local cooldown and no automatic retries; higher-level retry scheduling belongs to later consumers. This is not a distributed rate limiter.

Run from `api/`:

```text
npm test -- --runInBand panta
npm run build
npx eslint src/panta/*.ts src/config/panta-env.spec.ts src/config/env.schema.ts src/app.module.ts types/panta.ts
npm run test:panta:live
```

The smoke loads `.env` through dotenv, uses the compiled provider, and makes GET calls only: categories, one-item market list and its detail. It skips clearly if the URL/key pair is absent and fails if no market can be inspected. It does not print secrets, wallet holdings, provider response bodies or stack traces. Latest local result: 30 tests pass; API build and targeted ESLint pass; authenticated live smoke passed on 2026-10-07 with eight categories and matching list/detail identity. The selected secondary market had no spot prices; missing values remained unavailable.

## Remaining gates

- Authenticated read-only verification is complete; Phase 22 and pa-gate are completed. Write capabilities remain documentation-only until later-phase verification.
- Confirm settlement model and contractual resolution metadata access with Panta before payout/risk claims.
- Confirm write cluster/program/mint, actual create permission and secondary execution support before corresponding features.
- Confirm geographic/age/KYC/market eligibility requirements before native writes; the `region` metadata value is not an eligibility decision. Terms leave integration responsibilities to the developer and do not provide a complete jurisdiction allowlist.
- Panta-powered UI visibly displays **Powered by Panta** across the Predictions page, stock events and agent artifacts.

## Phase 23 discovery and research

`GET /api/predictions/markets` accepts `q`, `category` (finance/crypto/world), `phase`, comma-separated canonical `assetIds`, `page` and `limit`. Text search is local: at most two 50-row pages per eligible category. World markets require an explicit economic event in their title. Pagination covers only these scanned results, not the whole Panta catalog. Coverage reports scanned row count, truncation, stale reads, malformed-record omissions and partial category failures; complete provider failure is not an empty result.

`GET /api/predictions/markets/:marketId` preserves Panta fields and exact/unambiguous canonical stock links. Prices remain decimal USDC/share strings, not probabilities or winning payouts. Macro relevance is possible economic context, without a quantified price effect. Rules, payout, fees and liquidity/depth remain unavailable when the API does not supply them.

The agent exposes `searchPredictionMarkets`, `getPredictionMarket` and `researchPredictionMarket`. Browse/detail make no web-research calls. Research requires the active server chat wallet; only relevant identities and allocation percentages enter the final portfolio section. Wallet addresses and balances never enter web queries or shared evidence caches. The shared installed OpenAI Responses provider uses `OPENAI_MODEL`, at most three live web calls and a 45-second research deadline. Citation URLs come from provider annotations; unknown publication dates remain unknown. Missing/failed citations return insufficient evidence. Five-minute bounded evidence caching and concurrent deduplication compose wallet context separately.

The Predictions page has investing/lifecycle filters, pagination, holdings filtering and a URL-selected drawer. Stock event loading is independent. Research buttons only prefill the sidecar; users explicitly send. Conversation restoration retains original citation URLs, timestamps and warnings. No creation/trading controls or database migration were introduced.

Verification: 70 targeted API tests and eight frontend tests pass; both builds pass. Live discovery/detail and paid research passed on 2026-10-07 with five citation URLs, two supporting entries and one counterargument. The observed catalog had 26 rows, including 19 blank titles; unusable rows are omitted explicitly. Catalog and detail phases were inconsistent across responses, so Oren preserves each observed value rather than inventing lifecycle transitions. Active investing coverage can be empty.

Run from `api/` after `npm run build`: `npm run test:predictions:live` and, intentionally incurring research usage, `npm run test:predictions:research-live`. Smoke output contains only sanitized counts, coverage and verification flags. If active coverage is empty, a real titled investing detail can verify research; no fixture market is presented as live data.
