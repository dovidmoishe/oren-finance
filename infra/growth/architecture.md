# Growth reporting

This is the admin reporting module for visits, the agent funnel, and campaign comparisons. It is not a second dashboard and it does not grant trade authority.

Base commit for this work: `9d925f803875489a7b39b47906e5064a9647acfb`.

## What is implemented

- Nest module `api/src/admin` with collection, report, and import controllers.
- Report reads accept one bearer: the marketing bot's `marketing.bot.read` credential. Humans, Privy sessions, owners, future admins, and other machine principals do not get these routes. The bot cannot import, write, administer, or trade.
- Historical import is an offline operator command. There is no import HTTP route.
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

Reports accept exactly two kinds of caller. Ordinary Oren and Privy logins are denied.

1. **Marketing bot.** A bearer secret the bot possesses. The database stores only its SHA-256 hash. The principal is `marketing_bot` and the permission is `marketing.bot.read`. It cannot invite admins, import history, or trade. A browser `Origin` on that bearer is denied.
2. **Separate admin accounts.** Email and password in `admin_accounts`, not Privy. A master admin invites others and assigns only `reports.read` or `dashboard.access`. The invitation creates a single-use temporary password, shown once in the API response to the master, and it expires in 24 hours. The first successful login consumes it. Until that person chooses a new password, the session cannot read reports or manage accounts. There is no email delivery.

Sessions are HttpOnly cookies scoped to `/api/admin`, with a CSRF header required for changes. Login failures are throttled. Unknown emails get the same error as a bad password. Password change and revocation invalidate sessions. Bootstrap and master recovery are offline commands with no default password. This change does not create an account or a token.

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
2. Keep historical import offline. The marketing bot is not given a write credential.
3. Do not add a browser origin for reports. The marketing bot calls the API from its server.
4. Whether to import the recovery file into production later. This branch does not.
5. The log start is reported as 01:23, 01:25, and 01:27 WAT on 29 Oct 2026. The report keeps that unresolved.
