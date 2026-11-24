# Growth reporting

The standalone admin dashboard and marketing bot use the reporting API to read traffic, agent activation and campaign metrics.

## What is implemented

- Nest module `api/src/admin` with collection, report, dashboard and authentication controllers.
- Aggregate reports accept the marketing bot bearer or an admin session with reports.read.
- Historical import is an offline operator command. There is no import HTTP route.
- Durable pageviews in Postgres, daily rollups inside the existing API process, and configurable raw-data retention.
- Funnel events for setup, OAuth outcomes, in-app `getStockResearch`, and successful MCP `get_stock` as `mcp_stock_context`.
- Successful MCP get_stock_research calls count toward research activation. The funnel reports stock detail calls separately.
- Trade counts read from the existing intent, approval, and execution tables. Signing and transaction behavior are unchanged.
- A provenance-aware import format. The November 2026 recovery file is a fixture and a manual import source. It is not loaded by deploy and it is not a baseline.

## What is not implemented

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
| Research activation | In-app `getStockResearch` and MCP `get_stock_research`. Prompts are not stored. |
| MCP stock context | A successful `get_stock` call. Canonical stock detail, not a research report. |
| Prepared trade | One intent, or one browser execution that is not already tied to an intent. |
| Confirmed trade | A confirmed intent, once. The linked execution is not counted again. Browser and delegated lanes stay separate. |

Dates accept `UTC` and `Africa/Lagos` (WAT, UTC+1, no daylight saving). A missing day is `unavailable`, not zero.

## Historical coverage

The operator can import the recovery file offline. The start time on 29 October 2026 varies between sources and remains unresolved.
