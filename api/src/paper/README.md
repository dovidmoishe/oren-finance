# Paper trading

One strategy version runs in two environments. Researchers replay an ordered price history through the CLI. A signed-in user starts a private forward trial through the API. Each trial has its own 10,000 virtual USDC, stock, strategy version and journal.

## How a trial works

1. The API verifies the bearer token with Oren's account authentication and resolves the stock to a tradable token. The run pins the mint at creation. Repeating the same request returns the same run. Each user can have 12 active trials. Pausing frees a slot and preserves the trial's history.
2. The worker reads daily OHLC bars for that mint and evaluates the latest completed window. The same pure function evaluates the historical replay. The first two strategies require 21 observations and hold at most one long position.
3. An entry uses 10% of available virtual cash. The worker requests a Jupiter ExactIn quote in the background rate lane, then quotes the exit for the quantity it would acquire. It accepts the observation if both quotes fit within 30 seconds. Each modeled fill (`long-only-v2`) uses the quote's expected output, which already reflects the pool spread and price impact, subtracts a further 1 basis point and charges 0.01 virtual USDC. The requested slippage tolerance is 50 basis points. `long-only-v1` filled at the worst-case floor less 20 basis points, which cost about 1.4% per round trip before any price move. These are versioned simulation assumptions.
4. Each new daily observation records the input window, strategy and cost model versions, signal, quote amounts and times, previous book, result and any fill failure. Cash and token quantities are integer strings in the mint's smallest units. The performance field reports the return and net P&L against starting capital using an exit quote for an open position. A missing exit valuation produces a null mark. Check the valuation timestamp when inspecting a paused run.
5. The worker polls for due runs every 15 seconds. It normally checks each run hourly and retries unavailable market history after 15 minutes. Concurrent workers claim runs with a database revision. Pause or a replacement claim changes that revision, fencing out outstanding work. Cash, holdings and the daily journal entry commit in one transaction. After downtime the worker evaluates the most recent complete window at current quotes. It never synthesizes fills for missed days.

The paper module uses the shared market-data and Jupiter transport services. Its broker interface exposes a quote operation. All balances and fills belong to the simulation in PostgreSQL.

## Initial strategies

- **`breakout-v1`** enters when the last completed close exceeds the highs of the preceding 20 bars. It exits when the close falls below the lows of the preceding five bars.
- **`pullback-v1`** enters after two successive lower closes while the latest close is still above the mean of the preceding 20 closes. It exits on a recovery to the preceding five-close mean or a break below the longer mean.

Both strategies use observations available at decision time. A new rule or cost assumption should receive a new version before comparing it with existing trials. Relative-strength rotation would additionally require a synchronized, point-in-time universe of eligible stocks. Earnings strategies would require timestamped release and expectation data.

## The swing trader

`swing.ts` holds the trader's rules as pure functions shared by the live cohort and the backtest: signals, the daily trend filter, mandatory exits, momentum ranking, position limits, sizing and the evidence the AI reviewer sees. A policy names its candle timeframe and entry rules. The live cohort runs `daily-breakout-v1`:

- **Scan.** Each regular-session hour, one deterministic scan per clock hour, shared by every account, reads the 60 most liquid catalog stocks with a Tokens.xyz stock-market feed (`clickhouse_stock`) and at least 25,000 USD of token liquidity. Only an asset with complete session candles, a daily trend filter that allows entries and an allowed rule signalling a buy becomes a setup. The rest record why they were skipped (`no_stock_feed`, `no_signal`, `insufficient_recent_daily_bars`, …). Setups are ranked by 20-session daily momentum.
- **Entries.** An account reviews up to three top-ranked setups it does not hold, while it holds fewer than six positions. An entry spends 10% of marked equity, capped by cash. The worker quotes the buy and the exit for the acquired quantity and skips the entry (`spread_too_wide`) if that round trip loses more than 100 basis points.
- **Holdings.** Exits are deterministic and need no model call. On a new daily candle in the regular session, a daily close below the prior five daily lows sells; otherwise the exit levels are re-anchored as a guard on the holding's own quoted sale value. Every other hour, including weekends and holidays, the live Jupiter sale quote is checked against the guard and sells on a break (`guardExit`).
- **AI review.** `PaperResearchAgent.review` (`setup-review-v2`) makes one structured call per setup with `PAPER_AI_MODEL` (default `gpt-5.5`; chat keeps `OPENAI_MODEL`). It receives rebased prices (the latest close is 100), the computed signals, setup measures the rules do not use (breakout-day volume over its 20-session average, extension above the prior 20-session high against the typical daily range, and 20-session strength against QQQ) and the scan's market backdrop (QQQ's daily trend, the share of scanned stocks above their own 20-day mean, and how many setups appeared at once). It gets no ticker, mint, timestamp, raw volume or account figures, so it judges the setup rather than what it remembers about a company, and its answer can be cached in a backtest. Skipping is the default. It chooses a signalling rule or cash; a non-signalling rule or a failure is recorded as a skip. An account reuses its earlier review of the same setup candle instead of asking again. The catalog has no S&P 500 tracker with usable history, so QQQ (`invesco-qqq`) stands in for the market.

## PR 142 forward benchmark

The `five-ai-v2` cohort funds six wallet-free accounts once with 10,000 virtual USDC each: `v2-trader-1` to `v2-trader-5` take AI-reviewed entries, and `v2-rules` takes every top-ranked setup without a model call, as a baseline on the same scan. The run lasts 240 hours from funding. The preview worker checks PostgreSQL for due accounts every minute; each account reviews hourly from its funding time, missed slots expire, and at hour 240 the worker values remaining positions at current exit quotes. A restart resumes the same accounts and deadline.

The first cohort (`five-ai-v1`, `trader-1` to `trader-5`, `hourly-swing-v1`/`v2`) stays in `paper_ai_accounts` but is never reviewed again; the report summarizes it under `archivedFiveAiV1`. Earlier studies remain under `archivedMixed` and `archivedNvda`. v2 scans are stored in `paper_ai_screens` keyed by the absolute clock hour, so they never collide with v1's four-hour screen blocks (epochs 0 to 240), and only v2 scans count as coverage.

Stock-feed candles come from `/price-chart` and are kept to NYSE sessions: hourly candles must start between 04:00 and 20:00 New York time on a trading day, daily candles must be dated on a trading day, and stray off-session prints are dropped and counted in `droppedBars`. A series with more than a few off-session candles is treated as some other source. A failed stock-feed request is recorded as missing data and is never replaced with token candles, so an outage cannot open a position while US markets are closed. The password-protected `/api/paper/benchmark` reports the policy, cost model, scan coverage, decisions, fills, returns and observed drawdowns, and `/app/paper` on the preview shows them.

## Market backtest

```sh
ENV_FILE=../path/to/api/.env npm run paper:backtest:market -- --variants
ENV_FILE=../path/to/api/.env npm run paper:backtest:market -- --variant daily-breakout --ai --max-ai-calls 1500
```

The backtest replays the live trader over Tokens.xyz stock-market candles (hourly candles reach back to April 2026). The universe is today's 60 most liquid stock-feed assets; each is quoted on Jupiter for a 1,000 USDC buy and sell-back, and assets with no route or a round trip above 100 basis points are excluded. Each step is the end of an hourly candle: the trader sees only candles completed by then, decides with the same `swing.ts` functions, and fills at the open of the next candle through the same `settle` cost model, with half the measured round trip charged on each side. Stops and targets are checked on each completed hourly close in the 04:00–20:00 ET session. Entries happen only in the regular session.

- `--variants` compares a fixed set of policies (hourly or daily candles, both rules or breakout only) on an in-sample window (`--from`, default 2026-04-01, to `--split`, default 2026-08-01) and an out-of-sample window (`--split` to `--to`), against an equal-weight buy and hold of the same assets.
- `--ai` adds the AI arm for one `--variant`, using `--model` (default `PAPER_AI_MODEL`, then `gpt-5.5`). QQQ daily candles supply the same market backdrop the live scan gives the reviewer. A failed model call is not cached and stays pending for the next pass. Reviews are book-independent, so the run simulates, sends every unreviewed setup on its path to the model in parallel (`--concurrency`), caches the answers and simulates again until the path needs no new review or `--max-ai-calls` is reached. A rerun with the same model and evidence makes no model calls.
- `--variants` also runs the market switch on daily breakout (`breakout + switch`: entries only while QQQ is above its 50-day average and at least half the assets are above their own 20-day mean) and three portfolio benchmarks through `simulateWeights`: weekly momentum rotation into the top 5 by 60-session change, the same rotation behind the switch, and an equal-weight hold that goes to cash whenever QQQ is below its 50-day average. These settings were fixed before testing. `--sensitivity` prints neighbouring momentum settings (top 3 to 12, 20 to 90 sessions) to show how fragile a result is; it is never used to choose one.
- `--score-reviews` scores every setup a model reviewed (one decision per asset and trading day, the first review of that daily candle) by what a lone 1,000 USDC trade from it earned under the same exits (`setupOutcome`), then compares approved with skipped setups. Its 95% interval resamples whole trading days, because setups on one day move together. It reads cached reviews only and makes no model calls. Check any edge with outliers capped and without its best month before trusting it: over Apr to Nov 2026, gpt-5.5's +3.7-point edge fell to -0.1 without April.
- Candles, measured spreads and reviews are cached under `api/.cache/paper-backtest` (ignored by git); `--refresh` downloads again. The JSON report lists the universe and its spreads, exclusions, metrics per arm (return, drawdown, win rate, profit factor, exposure, friction, exits, monthly returns), daily equity and every trade with the AI rationale.

Caveats: the universe has survivorship bias, spreads are measured at run time and applied to the whole window, stock candles do not show how a 24/7 token traded outside sessions, and eight months is one market regime. A policy chosen on the in-sample window should be judged on the out-of-sample one.

## Replay one stock

From `api/`, supply a JSON array of 22 to 20,000 chronological, completed daily OHLC bars. Each element uses the form `{"timestamp":"2025-01-02T00:00:00Z","open":100,"high":105,"low":98,"close":103}`. Timestamps identify the start of a daily bar. Keep the price source, adjustment convention and instrument consistent across the file.

```sh
npm run paper:backtest -- breakout-v1 bars.json
npm run paper:backtest -- pullback-v1 bars.json
```

The replay observes a close, acts at the following open with a 30 basis point round trip (about the median measured for liquid stock tokens) and the paper cost model, and marks that day's equity at its close with modeled exit costs. It reports fills, skipped windows, net return, drawdown and a buy-and-hold comparison. The benchmark buys the same stock with the same entry budget at the first eligible open and keeps the remaining cash. Long gaps defer new decisions until a complete window is available. A short or sparse sample may produce zero trades. Historical bar fills measure signal behavior under the stated cost model. Forward trial fills record the actual token quotes available to Oren at observation time.

## Try a forward trial through the API

Configure the development API with its normal database, Tokens, Jupiter and Privy settings. Run `npm run db:migrate` for that database and enable `PAPER_TRADING_ENABLED=true` in the API process. The default is disabled. The routes use `Authorization: Bearer <Privy access token>`.

- `GET /api/me/paper-runs` returns the strategy IDs, cost model and the user's runs.
- `POST /api/me/paper-runs` with `{"assetId":"nvidia","strategy":"breakout-v1"}` starts a trial. Starting the other strategy creates a separate virtual account.
- `GET /api/me/paper-runs/:id` returns the book, performance and latest 100 journal entries. Pass `?before=<barTime>` with the oldest returned bar timestamp in milliseconds for the preceding page.
- `PUT /api/me/paper-runs/:id/active` with `{"active":false}` pauses observation. Send `{"active":true}` to resume with the saved position and cash.

## Verify changes

Run `npm run test:paper` from `api/`. Set `PAPER_TEST_DATABASE_URL` to a disposable local PostgreSQL database to include the HTTP integration suite. The suite applies the paper migrations inside its own temporary schema, injects two test identities and uses controlled market data and quotes. It checks account isolation, concurrent jobs, fill accounting, replay, pausing during a quote, missing exit liquidity, the shared hourly scan, the rules baseline, review reuse, the v1 archive and the 240-hour deadline. The backtest suite checks next-open fills, that changing later candles never changes earlier equity, and the cost model. Independent read-only provider checks establish market coverage and quote availability for a specific mint at the time of the check.

For research, the HFT directory's *Quantitative Factor Research Engineer* entry suggests turning an idea into a testable factor. *Test Python Algorithmic Trading Project* calls out data, signals, orders and failure cases. Its risk and journal category informed the evidence retained for each decision. Published prompts can supply hypotheses. The executable rules and their performance can then be inspected independently. [HFT trading prompt directory](https://hft.md/prompts/)
