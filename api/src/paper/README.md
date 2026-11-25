# Paper trading

One strategy version runs in two environments. Researchers replay an ordered price history through the CLI. A signed-in user starts a private forward trial through the API. Each trial has its own 10,000 virtual USDC, stock, strategy version and journal.

## How a trial works

1. The API verifies the bearer token with Oren's account authentication and resolves the stock to a tradable token. The run pins the mint at creation. Repeating the same request returns the same run. Each user can have 12 active trials. Pausing frees a slot and preserves the trial's history.
2. The worker reads daily OHLC bars for that mint and evaluates the latest completed window. The same pure function evaluates the historical replay. The first two strategies require 21 observations and hold at most one long position.
3. An entry uses 10% of available virtual cash. The worker requests a Jupiter ExactIn quote in the background rate lane, then quotes the exit for the quantity it would acquire. It accepts the observation if both quotes fit within 30 seconds. Each modeled fill uses the quote's minimum output, subtracts a further 20 basis points from proceeds, and charges 0.01 virtual USDC. The requested slippage is 50 basis points. These are versioned simulation assumptions.
4. Each new daily observation records the input window, strategy and cost model versions, signal, quote amounts and times, previous book, result and any fill failure. Cash and token quantities are integer strings in the mint's smallest units. The performance field reports the return and net P&L against starting capital using an exit quote for an open position. A missing exit valuation produces a null mark. Check the valuation timestamp when inspecting a paused run.
5. The worker polls for due runs every 15 seconds. It normally checks each run hourly and retries unavailable market history after 15 minutes. Concurrent workers claim runs with a database revision. Pause or a replacement claim changes that revision, fencing out outstanding work. Cash, holdings and the daily journal entry commit in one transaction. After downtime the worker evaluates the most recent complete window at current quotes. It never synthesizes fills for missed days.

The paper module uses the shared market-data and Jupiter transport services. Its broker interface exposes a quote operation. All balances and fills belong to the simulation in PostgreSQL.

## Initial strategies

- **`breakout-v1`** enters when the last completed close exceeds the highs of the preceding 20 bars. It exits when the close falls below the lows of the preceding five bars.
- **`pullback-v1`** enters after two successive lower closes while the latest close is still above the mean of the preceding 20 closes. It exits on a recovery to the preceding five-close mean or a break below the longer mean.

Both strategies use observations available at decision time. A new rule or cost assumption should receive a new version before comparing it with existing trials. Relative-strength rotation would additionally require a synchronized, point-in-time universe of eligible stocks. Earnings strategies would require timestamped release and expectation data.

## PR 142 forward benchmark

The preview funds five wallet-free accounts once with 10,000 virtual USDC each. The experiment starts with 50,000 virtual USDC in total. Each account owns one cash balance and a map of positions. An entry spends 10% of its remaining cash plus the modeled fee. Holdings retain their original token mint. The earlier NVDA trial is paused and its journal appears under `archivedNvda`. Its virtual balances are excluded from the new experiment.

All five independent instances of the autonomous AI trader use the same versioned skills, tools and deterministic risk controls. Each calls the model with the complete market snapshot and its own portfolio, shortlists up to three new assets and reviews existing holdings first. Each eligible investigation has its own model tool calls and journal. Matching choices are possible. An empty shortlist keeps available cash idle. Market coverage, candidate IDs, missing data, route failures and fills appear separately.

The `five-ai-v1` experiment starts a fresh 48-hour clock and takes fresh market snapshots. Its accounts have stable IDs from `trader-1` through `trader-5`. The earlier mixed-strategy balances and journals are preserved under `archivedMixed` and excluded from funding and results.

The five traders and Oren chat share three reviewed adaptations of [HFT research prompts](https://hft.md/prompts/). They cover factor research, data validation and risk journaling. Chat obtains a skill and its relevant chat tools through `getTradingSkill`. The paper agent receives the versioned guidance and can call `inspectSignals`, `inspectBars` and `inspectRisk`. It selects breakout, pullback or cash after reading the tool results. Deterministic rules govern eligible entries, mandatory exits, sizing and quote-based fills. Model or data failures are recorded. Each successful guided investigation records the model, skill version, invoked tools, rule selection and rationale.

The preview worker checks PostgreSQL for due accounts every minute. Each trader refreshes its shortlist from the full market every four hours and reviews all holdings and shortlisted candidates every hour, measured from funding time. A failed screen retains the previous watchlist and retries on the next review. Missed slots expire. At hour 48 the worker values remaining positions at current exit quotes. A restart resumes the same accounts and deadline.

Hourly reviews (`hourly-swing-v2`) use 21 completed hourly candles for timing and 21 completed daily candles for trend. When Tokens.xyz maps a stock to its stock-market feed (`canonicalMarket.source` is `clickhouse_stock`), the candles come from `/price-chart` and are kept to NYSE sessions. Hourly candles must start between 04:00 and 20:00 New York time on a trading day, and daily candles must be dated on a trading day. Stray off-session prints, such as a closing print stamped on a Saturday, are dropped and counted in `droppedBars`. Tokens does not say which source served a chart, so a series with more than a few off-session candles is treated as some other source. That asset, and every asset without the feed, uses the traded mint's on-chain candles at any hour, as before. Each observation records its candle `source`.

A stock-sourced asset is reviewed for entries only during the regular session. Outside it, the observation records `marketClosed` and the NYSE `session` state instead of a data error, and no entry is made. A failed stock-feed request is recorded as missing data. It is never replaced with token candles, so an outage cannot open a position while US markets are closed.

Entries require the last daily close to be at or above the prior 20-day average. A close below the prior five lows on either timeframe triggers an exit. Positions opened on a pullback also follow that strategy's hourly exit. The AI may choose cash. Each fresh decision on a holding stores its exit prices as a guard, stated as the position's own quoted sale value, so no token decimals are needed. When a review has no fresh decision, the worker compares the live Jupiter sale quote with that guard. This applies when the market is closed, when candles are stale or missing, and on a repeated candle. The worker sells when the quote crosses the stop or a pullback's profit target and records `guardExit`. A repeated candle never re-anchors the guard. The worker still seeks a liquidation mark for every holding. The password-protected `/api/paper/benchmark` reports the next check, market coverage, decisions, fills, returns and observed drawdowns. The journal labels the initial daily rounds and subsequent hourly rounds separately. A missing exit quote makes the account valuation unknown.

## Run a historical experiment

From `api/`, supply a JSON array of 22 to 20,000 chronological, completed daily OHLC bars. Each element uses the form `{"timestamp":"2025-01-02T00:00:00Z","open":100,"high":105,"low":98,"close":103}`. Timestamps identify the start of a daily bar. Keep the price source, adjustment convention and instrument consistent across the file.

```sh
npm run paper:backtest -- breakout-v1 bars.json
npm run paper:backtest -- pullback-v1 bars.json
```

The replay observes a close, acts at the following open and marks that day's equity at its close with modeled exit costs. It reports fills, skipped windows, net return, drawdown and a buy-and-hold comparison. The benchmark buys the same stock with the same entry budget at the first eligible open and keeps the remaining cash. Long gaps defer new decisions until a complete window is available. A short or sparse sample may produce zero trades. Historical bar fills measure signal behavior under the stated cost model. Forward trial fills record the actual token quotes available to Oren at observation time.

## Try a forward trial through the API

Configure the development API with its normal database, Tokens, Jupiter and Privy settings. Run `npm run db:migrate` for that database and enable `PAPER_TRADING_ENABLED=true` in the API process. The default is disabled. The routes use `Authorization: Bearer <Privy access token>`.

- `GET /api/me/paper-runs` returns the strategy IDs, cost model and the user's runs.
- `POST /api/me/paper-runs` with `{"assetId":"nvidia","strategy":"breakout-v1"}` starts a trial. Starting the other strategy creates a separate virtual account.
- `GET /api/me/paper-runs/:id` returns the book, performance and latest 100 journal entries. Pass `?before=<barTime>` with the oldest returned bar timestamp in milliseconds for the preceding page.
- `PUT /api/me/paper-runs/:id/active` with `{"active":false}` pauses observation. Send `{"active":true}` to resume with the saved position and cash.

## Verify changes

Run `npm run test:paper` from `api/`. Set `PAPER_TEST_DATABASE_URL` to a disposable local PostgreSQL database to include the HTTP integration suite. The suite applies the paper migration inside its own temporary schema, injects two test identities and uses controlled market data and quotes. It checks account isolation, concurrent jobs, fill accounting, replay, pausing during a quote and missing exit liquidity. Independent read-only provider checks establish market coverage and quote availability for a specific mint at the time of the check.

For research, the HFT directory's *Quantitative Factor Research Engineer* entry suggests turning an idea into a testable factor. *Test Python Algorithmic Trading Project* calls out data, signals, orders and failure cases. Its risk and journal category informed the evidence retained for each decision. Published prompts can supply hypotheses. The executable rules and their performance can then be inspected independently. [HFT trading prompt directory](https://hft.md/prompts/)
