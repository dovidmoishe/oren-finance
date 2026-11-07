# Growth reporting

This is the admin reporting module for visits, the agent funnel, and campaign comparisons. It is not a second dashboard and it does not grant trade authority.

Base commit for this work: `9d925f803875489a7b39b47906e5064a9647acfb`.

## What is implemented

- Nest module `api/src/admin` with collection, report, and import controllers.
- `marketing.read` for reports and `marketing.import` for aggregate imports. Neither permission is full admin, and neither can sign or broadcast a trade.
- Durable pageviews in Postgres, daily rollups inside the existing API process, and configurable raw-data retention.
- Funnel events for setup, OAuth outcomes, in-app `getStockResearch`, and successful MCP `get_stock` as `mcp_stock_context`.
- MCP research activation is reported `unavailable`. The read tools are `get_portfolio`, `search_stocks`, and `get_stock`. `get_stock` is canonical stock detail, not a research report. Search and portfolio reads are not counted. In-app research stays a separate channel.
- Trade counts read from the existing intent, approval, and execution tables. Signing and transaction behavior are unchanged.
- A provenance-aware import format. The November 2026 recovery file is a fixture and a manual import source. It is not loaded by deploy and it is not a baseline.

## What is not implemented

- No marketer UI. The website collects visits and carries attribution. Reports are API responses for a future page or for her own site.
- No X, BulkPublish, or revenue sync, and no invented charges. Those series stay `unavailable` until a manual import.
- No experiment assignment engine and no significance claim.
- No production role grant and no production history import were run.
- No live trade was verified.

## Auth

Reports require `Authorization: Bearer`.

- A Privy session is accepted only when that user has an unexpired, unrevoked `marketing.read` grant.
- A machine token starts with `oren_rpt_`. Only its hash is stored. Revoking the row or letting it expire denies the next call.
- `marketing.read` cannot import. `marketing.import` cannot read reports. A future full-admin permission is not created here and does not pass these checks.
- There is no public report route. The collect route accepts anonymous page and setup events only. It rejects email, IP, wallet, and prompt fields.

A future frontend should use the marketer's own Oren login. The API checks her grant. Do not put a machine token in browser JavaScript. A machine token belongs in a server she controls. CORS is unchanged: this change does not add `*` or any new origin. If her site is on a new origin, set `CORS_ORIGIN` to that exact origin. Do not share the owner login.

## Definitions

| Term | Meaning |
| --- | --- |
| Pageview | An accepted document navigation after bot, prefetch, asset, API, and internal-host filters. |
| Session | A browser session id rotated after 30 idle minutes. A session that crosses midnight counts once per civil day. Summing those days is not the all-time session count. |
| Daily uniques | Distinct durable visitor ids that day. |
| Lifetime uniques | Distinct durable visitor ids still inside identity retention. Unavailable once those keys are purged. Never the sum of daily uniques. |
| People | Unavailable. Oren has accounts, not a person id. |
| Connection | A row in `mcp_connections`. A setup click, a refused prompt, a failed prompt, and an expired or revoked grant are not connections. |
| Research activation | In-app `getStockResearch` only. MCP research activation is unavailable. Prompts are not stored. |
| MCP stock context | A successful `get_stock` call. Canonical stock detail, not a research report. |
| Prepared trade | One intent, or one browser execution that is not already tied to an intent. |
| Confirmed trade | A confirmed intent, once. The linked execution is not counted again. Browser and delegated lanes stay separate. |

Dates accept `UTC` and `Africa/Lagos` (WAT, UTC+1, no daylight saving). A missing day is `unavailable`, not zero.

## Decisions that need Dave

1. Add an MCP research tool later if the marketer needs that activation. `get_stock` stays stock context.
2. Whether `marketing.import` should stay a separate grant. The read role cannot import.
3. Replace `CORS_ORIGIN=*` with the real site origins before a browser on another domain calls the report API.
4. Whether to import the recovery file into production later. This branch does not.
5. The log start is reported as 01:23, 01:25, and 01:27 WAT on 29 Oct 2026. The report keeps that unresolved.
