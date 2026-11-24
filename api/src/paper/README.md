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

All five accounts use a common, persisted snapshot of every page in Oren's stock market. Each considers up to three new candidates per round and reviews every open position first. Breakout investigates the largest daily gains. Pullback investigates the largest daily declines. Momentum investigates the highest volume and buys when the latest completed close exceeds the first close in the 21-bar window. Buy-and-hold selects the most liquid names at the first screen and holds its purchases. The guided account reads the full snapshot, chooses up to three valid catalog IDs and uses its evidence tools on those stocks and existing positions. Market coverage, candidate IDs, missing data, route failures and fills are reported separately.

The guided account and Oren chat share three reviewed adaptations of [HFT research prompts](https://hft.md/prompts/). They cover factor research, data validation and risk journaling. Chat obtains a skill and its relevant chat tools through `getTradingSkill`. The paper agent receives the versioned guidance and can call `inspectSignals`, `inspectBars` and `inspectRisk`. It selects breakout, pullback or cash after reading the tool results. Deterministic rules govern eligible entries, mandatory exits, sizing and quote-based fills. Model or data failures are recorded. Each successful guided investigation records the model, skill version, invoked tools, rule selection and rationale.

The preview runs decision rounds at startup and after 24 hours, then values remaining positions at current exit quotes after 48 hours. A restart resumes the persisted schedule. Expired decision rounds are skipped. Open the password-protected `/api/paper/benchmark` report for account books, covered asset counts, journal entries, returns and observed drawdowns. A missing liquidation quote produces an unknown account valuation. Compare the five accounts over matching observation times. Two decision rounds give limited evidence about strategy returns.

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
