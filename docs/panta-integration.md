# Panta foundation — Phase 22

Branch: `feat/panta`. Contract reviewed on 2026-10-07. Backend only; no public prediction routes, agent tools, database changes, signing or writes.

## Verified documentation and capability matrix

Primary sources: [official API source](https://github.com/Kaito-HQ/panta-api-pub), [reference playground](https://github.com/Kaito-HQ/panta-api-playground), [authentication](https://docs.panta.market/guides/authentication), [errors](https://docs.panta.market/guides/errors), [terms](https://docs.panta.market/guides/terms-of-use).

Production base URL: `https://live-api.panta.market/api/v1`. Playground also names `https://staging-api.panta.market/api/v1`. Use explicit backend configuration; never infer the Solana cluster from `pk_test_`/`pk_live_`. Both prefixes are accepted by the public API. Confirm program IDs, USDC mint and RPC cluster with Panta before any write smoke.

| Capability | Documented contract | Foundation implementation | Live verification |
| --- | --- | --- | --- |
| Catalog/filtering | `GET /markets/`; category, status, createdBy=me, opaque cursor, limit default 20/max 50 | Implemented in PantaService | Pending credentials |
| Spot detail | `GET /markets/{marketId}/`; base58 event address | Implemented; validates returned identity | Pending credentials |
| Categories | `GET /categories/`; categories string array | Implemented | Pending credentials |
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

The smoke loads `.env` through dotenv, uses the compiled provider, and makes GET calls only: categories, one-item market list and its detail. It skips clearly if the URL/key pair is absent and fails if no market can be inspected. It does not print secrets, wallet holdings, provider response bodies or stack traces. Latest local result: 30 tests pass; API build and targeted ESLint pass; live smoke skipped because the required URL/key pair is incomplete. Live access remains unverified.

## Remaining gates

- Configure the authenticated production URL/key pair and rerun the read-only smoke; do not mark pa-gate or Phase 22 completed before success.
- Confirm settlement model and contractual resolution metadata access with Panta before payout/risk claims.
- Confirm write cluster/program/mint, actual create permission and secondary execution support before corresponding features.
- Confirm geographic/age/KYC/market eligibility requirements before native writes; the `region` metadata value is not an eligibility decision. Terms leave integration responsibilities to the developer and do not provide a complete jurisdiction allowlist.
- Future Panta-powered UI must visibly display **Powered by Panta**. Normalized source metadata carries this attribution; no frontend surface is shipped in this phase.
