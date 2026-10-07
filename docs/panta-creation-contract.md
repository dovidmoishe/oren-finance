# Panta creation: implementation and publication gate

Verified on 2026-10-07, branch `feat/panta`. Phase 24 remains **in progress**. Drafts, review sheets and recovery are implemented; production publication is disabled and the database migration is not yet applied.

## Current blockers

1. The configured Postgres pooler rejects the connection with `XX000: tenant/user not found`. Migration `0005_prediction_creation` failed before adding tables. Correct the ignored `api/.env` database connection, then run `npm run db:migrate` from `api/`.
2. Authenticated `GET /whoami/` succeeds and reports `canCreateMarkets: true`, but creation permission alone does not verify deployment or settlement. Obtain the actual genesis hash, upgradeable program/ProgramData account and deployment hash, USDC mint, fee destinations, instruction encoding/account ordering, event PDA seeds and resolution/oracle, dispute and eligibility contracts from Panta. No production values have been guessed.
3. Live upload/quote/build/simulation is still unverified. A human-reviewed, wallet-signed creation and verified registration are required before closing Phase 24. No live artwork upload, quote, build, signature, broadcast or registration was performed during this implementation.

## Provider contract rechecked

Sources: [official quote contract](https://docs.panta.market/api-reference/markets/quote), [build](https://docs.panta.market/api-reference/markets/build), [registration](https://docs.panta.market/api-reference/markets/register), [image upload](https://docs.panta.market/api-reference/markets/image-upload), [public documentation source](https://github.com/Kaito-HQ/panta-api-pub/tree/main/api-reference/markets), and [playground creation flow](https://github.com/Kaito-HQ/panta-api-playground/blob/main/src/components/CreateMarketFlow.tsx).

Creation requests use the server's `X-Api-Key`. The adapter uses native fetch, prohibits redirects and bounds provider requests to the existing eight-second timeout. Artwork upload has a separate 15-second timeout. Creation quotes never enter discovery/research caches.

| Step | Request | Validated result |
| --- | --- | --- |
| Image upload | `POST /markets/create/image-upload/`, `{}` | Cloudinary `uploadUrl`, scalar form fields and future expiry; direct multipart PNG upload returns a public `secure_url` |
| Quote | `POST /markets/create/quote/`, exact wallet/question/rule/sources/category/dates/image URL and optional title/description/region, `marketType: standard` | `createId`, expected event PDA, integer base-unit payment/liquidity/platform components, future `expiresAt`; components sum to payment |
| Build | `POST /markets/create/build/`, `{createId,wallet}` | Unsigned base64 versioned transaction, blockhash/last valid height, fingerprint, derived event and identical fee components/session/expiry |
| Wallet | User wallet adapter only | Same approved message and signer; local signature persistence, then server persistence, before broadcast |
| Register | `POST /markets/register/`, `{createId,signature}` | `status: registered`, matching create ID, signature and event/market ID; same attempt is retried idempotently |

Question is capped at 512 characters and the composed resolution rule at 2048; sources contain 1–20 public HTTPS URLs. Unix dates require `start < end <= resolution`. A one-hour minimum start delay is conservative until the audited deployment supplies its actual minimum. Only standard Global markets are accepted. Generated artwork is a deterministic 1024-square PNG, at most 5 MB. Canonical logos are fetched only over HTTPS with public pinned IPv4 DNS, size/type/time limits and raster decoding; unsafe/missing logos produce neutral artwork.

Fees are six-decimal USDC base-unit **strings**. The sheet renders them using integer/string arithmetic. Liquidity funding, provider revenue and estimated network fees are separate. Exact request content and artwork hash bind the quote; preparation additionally binds owner, version, quote ID and payment. A quote replacement, expiry or edit requires review again. Network fees become available after preparation and require a second explicit review before the wallet opens.

## Verified deployment manifest

`PANTA_CREATION_ENABLED=false` by default. The optional `PANTA_CREATION_RPC_URL` and server-only `PANTA_CREATION_MANIFEST_JSON` must describe an audited deployment before upload/quote/preparation can proceed. The existing equity RPC or API-key prefix is never used to infer the cluster. Draft research remains available while publication is blocked.

The manifest is the `CreationManifest` interface in `api/src/predictions/creation/creation-transaction.service.ts`:

- `genesisHash`, `programId`, `programDataAddress`, SHA-256 `programDataHash`, `usdcMint`, `minimumStartDelay`;
- audited `feeDestinations`, `fundingMode` (`cpi` or explicit checked transfers), event PDA seeds (literal/wallet/question hash);
- eight-byte discriminator and ordered Borsh string/string-array/u64/standard-u8 fields, including question, composed rule, source URLs, dates and all three fee components;
- exact ordered account addresses, writable flags and signer flags. Supported roles are `$wallet`, `$event`, `$usdcMint`, `$walletUsdcAta`; other accounts must be audited constants;
- exact provider-supported `missingDataPolicies`, and nonempty `resolutionContract`, `disputeContract`, `eligibilityContract`, `auditReference`.

Do not copy offline fixture values into configuration. This verifier intentionally supports a narrow instruction grammar. If the real audited ABI needs different PDA derivation, dynamic accounts, instructions or oracle fields, extend the adapter and fixtures before enabling creation.

Before preparation, RPC genesis, upgradeable-loader ownership/ProgramData state and deployment hash are checked; the USDC mint must be a six-decimal SPL mint. Address lookup tables are resolved before decoding. Only a single expected creation instruction, bounded compute-budget instructions, and audited checked USDC funding transfers are accepted. Unexpected programs, account order/privileges, signer, event, instruction data or payments fail closed. Unsigned simulation and network fee estimation run before returning the transaction. Errors omit RPC URLs, credentials and upstream text.

## Ownership, research and persistence

`POST /predictions/creation/session/challenge` issues a five-minute single-use nonce bound to a Solana wallet. `POST /predictions/creation/session` verifies its Ed25519 signed ownership message and returns a one-hour opaque token. This authorizes draft access only, never a transaction. Tokens stay in browser memory and clear on wallet change. Sessions/nonces are bounded in API memory; multiple API instances need sticky routing or a shared session implementation before scale-out.

Creation APIs accept `Authorization: Bearer <session>`; agent message/history requests use `x-oren-creation-session`. The token is runtime context, not a model argument, persisted chat message or research input. Existing chats containing private creation artifacts require proof before either history retrieval or another model turn. Ordinary discovery chats retain their existing access behavior.

Three tools propose, retrieve and revise drafts. They cannot upload, quote, approve, prepare, sign, broadcast or register. Explicit idea/revision requests authorize research. Each research task has at most three live web calls and a 45-second overall deadline, including stalled ancillary providers; independent cancellation is supported for deduplicated callers. Evidence caches last five minutes, have 100-entry bounds and exclude wallet context. Only provider-returned citation URLs/source IDs are usable; absent credentials or unusable citations produce insufficient-evidence drafts. Evidence describes observation feasibility, not provider settlement support.

Templates require exact underlying instruments, threshold currency/operator/value or percentage return sessions, official macro units and first-publication/revision policy. Stock-versus-stock uses underlying prices, split adjustments, excluded dividends and exact ties NO. Missing observations/suspensions require an exact manifest-supported policy. Browser IANA timezone reaches server tools; absolute dates and timezone are displayed before review. Unverified/default details remain explicit blockers or uncertainty. Duplicate scans use Phase 23's bounded eligible catalog search; limited coverage is retained, and exact matches require **create another** before preparation.

The additive migration creates current drafts, immutable draft versions and historical attempts. Repository owner filters and row locks serialize financial attempt transitions across API instances. These records are app memory; onchain/provider state determines payment and market outcomes.

## Recovery and API routes

All following routes are below Oren's `/api` prefix:

| Route | Behavior |
| --- | --- |
| `POST /predictions/creation/propose` | Research and persist version 1 |
| `GET /predictions/creation/:draftId` | Owned latest proposal and current attempt |
| `PATCH /predictions/creation/:draftId` | Compare version, validate edits, persist new version and invalidate quote/evidence unless research explicitly requested |
| `POST /predictions/creation/:draftId/quote` | Upload reviewed-preview artwork and quote an unblocked version |
| `POST /predictions/creation/prepare` | Explicit approved version/hash/create ID/payment, duplicate acknowledgement and audited unsigned build |
| `POST /predictions/creation/confirm` | Persist signature, verify chain message/event, register the same attempt |
| `POST /predictions/creation/:draftId/release-expired` | Release an unsigned preparation only after finalized block-height expiry and verified event absence |

A rejected wallet signature leaves the prepared attempt reusable while valid. Its finalized expiry must be verified before releasing it for a new quote. A known submitted signature is never released through that endpoint. Network uncertainty retains the signature and locks further payment. `chain_pending`, `registration_pending`, `failed` and `registered` are distinct; successful payment with registration failure retries registration without another submission. Recovery survives reload through server attempts and a wallet-scoped local pending-signature record. Registration success is returned only after matching chain message, program-owned event and provider registration; catalog lag is a separate warning. Discover can refresh without pretending indexing is immediate.

## Verification and remaining live checks

Verification passed: **98 targeted API tests, 16 frontend tests, 12 offline transaction checks, both builds and ESLint without automatic fixes**. Frontend lint retains five existing warnings in unrelated files.

API Jest covers ownership/replay/expiry, template constraints, URLs/artwork, missing evidence/citations, deadlines/cancellation/deduplication, fee precision, provider failures, approval conflicts, pending signatures/registration and private-history dispatch. Offline fixtures use real Solana versioned messages, including lookup tables, and exercise payment/signer/event/program/priority-fee/expiry rejection and unsigned simulation handling. Frontend tests cover fee display, volatile owned sessions, artifacts, wallet rejection, wrong network, changed message, persistence before broadcast and unknown-outcome duplicate prevention. The real review component was inspected with an explicitly labelled offline fixture at desktop and 360px mobile widths; no horizontal overflow occurred. No fabricated live markets were displayed.

Run from `api/`: targeted Jest, `npm run build`, ESLint **without `--fix`**, `node scripts/panta-creation-fixtures.mjs`, `npm run test:panta:creation-access`. Run from `app/`: `npm test`, `npm run build`, `npm run lint`.

After database access and the audited contract are available: verify owned draft persistence/restore against Postgres, obtain a reviewed live quote, verify/simulate its unsigned build, then let the human review and sign one publication. Verify the expected event, registration, reload recovery and catalog-indexing state before marking `pc-prepare`, `pc-confirm`, `pc-checks` completed. Keep Phase 21 follow-ups and Phase 25/26 pending.
