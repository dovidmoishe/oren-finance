import type { MarketCandle } from '../../types/market';
import type { PaperBar, PaperResearch } from '../../types/paper';
import type {
  MarketBook,
  MarketObservation,
  MarketRound,
  ScreenRow,
} from '../../types/paper-market';
import { USDC_MINT } from '../config/constants';
import { benchmarkAssetIds, MarketBenchmark } from './market-benchmark';
import {
  isNyseTradingDay,
  isStockSessionHour,
  STOCK_FEED_SOURCE,
} from './market-data';
import { DAY, HOUR, history, settle } from './strategy';
import { analyze, SWING_POLICY } from './swing';

const MINT = 'NVDAxMint';
const candle = (ms: number, close: number): MarketCandle => ({
  timestamp: new Date(ms),
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1000,
});
const price = (ms: number) => 100 + ((ms / HOUR) % 7) / 10;
const span = (now: number, length: number, step: number) => {
  const end = Math.floor(now / step) * step;
  return Array.from(
    { length: Math.floor(length / step) + 1 },
    (_, i) => end - length + i * step,
  );
};
/** Stock-market candles as Tokens serves them: NYSE sessions only, in-progress bucket included. */
const stockHourly = (now: number) =>
  span(now, 10 * DAY, HOUR)
    .filter(isStockSessionHour)
    .map((t) => candle(t, price(t)));
const stockDaily = (now: number) =>
  span(now, 65 * DAY, DAY)
    .filter(isNyseTradingDay)
    .map((t) => candle(t, 100));
/** Round-the-clock candles, like on-chain or provider series. */
const allHours = (now: number) =>
  span(now, 10 * DAY, HOUR).map((t) => candle(t, price(t)));
const allDays = (now: number) =>
  span(now, 65 * DAY, DAY).map((t) => candle(t, 100));

const approve: PaperResearch = {
  version: 'setup-review-v1',
  model: 'test',
  rationale: 'Close above the prior 20 daily highs.',
  selected: 'breakout-v1',
};

function setup(
  options: {
    feed?: string;
    canonical?: (interval: string) => MarketCandle[] | Promise<never>;
    saleRate?: bigint;
    review?: PaperResearch;
    scan?: ScreenRow[];
  } = {},
) {
  const now = Date.now();
  const tokens = {
    getStock: jest.fn((id: string) =>
      Promise.resolve({
        id,
        canonicalMarketSource: options.feed ?? STOCK_FEED_SOURCE,
        variants: [{ mint: MINT, tradable: true, liquidity: 10 }],
      }),
    ),
    getCanonicalCandles: jest.fn(
      (_asset: string, window: { interval: string }) =>
        options.canonical
          ? Promise.resolve(options.canonical(window.interval))
          : Promise.resolve(
              window.interval === '1H' ? stockHourly(now) : stockDaily(now),
            ),
    ),
    getOHLCV: jest.fn((_asset: string, params: { timeframe: string }) =>
      Promise.resolve(params.timeframe === '1H' ? allHours(now) : allDays(now)),
    ),
  };
  const saleRate = options.saleRate ?? 1000n;
  const paper = {
    route: jest.fn((mint: string, side: 'buy' | 'sell', amount: bigint) => {
      const out = side === 'buy' ? amount : (amount * saleRate) / 1000n;
      return Promise.resolve({
        inputMint: side === 'buy' ? USDC_MINT : mint,
        outputMint: side === 'buy' ? mint : USDC_MINT,
        input: amount.toString(),
        quotedOutput: out.toString(),
        minimumOutput: ((out * 995n) / 1000n).toString(),
        slot: null,
        requestedAt: Date.now(),
        receivedAt: Date.now(),
      });
    }),
  };
  const agent = {
    review: jest.fn(() => Promise.resolve(options.review ?? approve)),
  };
  const bench = new MarketBenchmark(
    {} as never,
    {} as never,
    tokens as never,
    paper as never,
    agent as never,
    {} as never,
  );
  const scan = jest
    .spyOn(bench as unknown as { scan: () => Promise<ScreenRow[]> }, 'scan')
    .mockResolvedValue(options.scan ?? []);
  const evaluate = (account: unknown, epoch: number) =>
    (
      bench as unknown as {
        evaluate(account: unknown, epoch: number): Promise<MarketRound>;
      }
    ).evaluate(account, epoch);
  return { tokens, paper, agent, scan, evaluate };
}

const account = (
  book: MarketBook,
  accountId = 'v2-trader-1',
  rounds: MarketRound[] = [],
) => ({ accountId, state: book, rounds });
const heldBook = (decidedBar?: number): MarketBook => ({
  cash: '9000000000',
  positions: {
    nvidia: {
      mint: MINT,
      quantity: '1000000000',
      entryRule: 'breakout-v1',
      guard: {
        stopUsdcRaw: '950000000',
        source: 'stock',
        referencePrice: 100,
        referenceValueUsdcRaw: '1000000000',
        setAt: '2026-11-24T20:30:00.000Z',
      },
      ...(decidedBar === undefined ? {} : { decidedBar }),
    },
  },
});
const cashBook = (): MarketBook => ({ cash: '10000000000', positions: {} });

/** A scanned daily breakout: the latest daily close clears the prior 20 highs. */
function setupRow(id: string, momentumPct: number): ScreenRow {
  const day0 = Date.parse('2026-10-26T00:00:00Z');
  const rows: PaperBar[] = Array.from({ length: 21 }, (_, i) => ({
    time: day0 + i * DAY,
    high: i === 20 ? 102.5 : 100.5,
    low: 99.5,
    close: i === 20 ? 102 : 100,
  }));
  const hourlyRows: PaperBar[] = Array.from({ length: 21 }, (_, i) => ({
    time: Date.parse('2026-11-25T00:00:00Z') + i * HOUR,
    high: 102.5,
    low: 101.5,
    close: 102,
  }));
  const analysis = { ...analyze(rows, rows), momentumPct };
  expect(analysis.entryRules).toEqual(['breakout-v1']);
  return {
    id,
    ticker: id.toUpperCase(),
    price: 102,
    change: null,
    volume: null,
    liquidity: 1_000_000,
    setup: {
      mint: id + 'Mint',
      source: 'stock',
      price: 102.4,
      analysis,
      rows,
      hourlyRows,
    },
  };
}
const quietRow: ScreenRow = {
  id: 'quiet',
  ticker: 'QT',
  price: 1,
  change: null,
  volume: null,
  liquidity: 1_000_000,
  skipped: 'no_signal',
};
const only = (round: MarketRound): MarketObservation => {
  expect(round.observations).toHaveLength(1);
  return round.observations[0];
};

describe('market benchmark report assets', () => {
  it('lists every held, scanned and reviewed asset once', () => {
    const round = (candidates: string[], reviewed: string[]) =>
      ({
        epoch: 1,
        at: '2026-11-26T10:00:00.000Z',
        universeSize: 3,
        candidates,
        observations: reviewed.map((asset) => ({ asset })),
        equityRaw: null,
        cashRaw: '0',
      }) as MarketRound;
    // Rounds migrated from the daily study may lack candidate and observation arrays.
    const legacy = { epoch: 0 } as MarketRound;
    expect(
      benchmarkAssetIds([
        {
          state: heldBook(),
          rounds: [legacy, round(['amd', 'nvidia'], ['nvidia', 'micron'])],
        },
        { state: { cash: '0', positions: {} }, rounds: [round(['amd'], [])] },
      ]),
    ).toEqual(['amd', 'micron', 'nvidia']);
  });
});

describe('market benchmark holdings', () => {
  beforeEach(() =>
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
      ],
    }),
  );
  afterEach(() => jest.useRealTimers());

  it('reviews a holding on a new daily candle without a model call and re-anchors its guard', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z')); // Wednesday 10:30 ET
    const { tokens, agent, scan, evaluate } = setup();
    const acct = account(heldBook());
    const round = await evaluate(acct, 5);
    const obs = only(round);
    expect(round.method).toBe(SWING_POLICY.version);
    expect(obs).toMatchObject({
      source: 'stock',
      session: 'regular',
      repeatedBar: false,
      signal: 'hold',
      filled: false,
      analysis: { riskExit: false },
    });
    expect(agent.review).not.toHaveBeenCalled();
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(1);
    const latestDaily = history(stockDaily(Date.now()), Date.now()).at(-1)!;
    const position = acct.state.positions.nvidia;
    expect(position.decidedBar).toBe(latestDaily.time);
    expect(position.guard).toMatchObject({
      source: 'stock',
      referencePrice: stockHourly(Date.now()).at(-1)!.close,
      referenceValueUsdcRaw: obs.terms!.quotedOutput,
      setAt: new Date().toISOString(),
    });
    // 9,000 cash plus the 1,000 USDC sale quote less the 1 bp allowance and the 0.01 USDC fee.
    expect(round.equityRaw).toBe('9999890000');
  });

  it('checks the live quote against the guard once the daily candle was decided', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { evaluate } = setup({ saleRate: 900n });
    const acct = account(heldBook(Number.MAX_SAFE_INTEGER));
    const obs = only(await evaluate(acct, 5));
    expect(obs).toMatchObject({
      repeatedBar: true,
      guardExit: 'stop',
      signal: 'sell',
      filled: true,
    });
    expect(acct.state.positions.nvidia).toBeUndefined();
    expect(acct.state.cash).toBe(
      settle({ cash: '9000000000', position: '1000000000' }, 'sell', obs.terms!)
        .book.cash,
    );
  });

  it('waits through Thanksgiving: guard checks only, no market scan', async () => {
    jest.setSystemTime(new Date('2026-11-26T15:30:00Z'));
    const { scan, agent, evaluate } = setup({ saleRate: 990n });
    const acct = account(heldBook());
    const obs = only(await evaluate(acct, 5));
    expect(obs).toMatchObject({
      session: 'closed',
      marketClosed: true,
      signal: 'hold',
      filled: false,
    });
    expect(obs.guardExit).toBeUndefined();
    expect(obs.error).toBeUndefined();
    expect(scan).not.toHaveBeenCalled();
    expect(agent.review).not.toHaveBeenCalled();
    expect(acct.state.positions.nvidia).toEqual(heldBook().positions.nvidia);
  });

  it('uses the traded mint candles at any hour for a holding without a stock-market feed', async () => {
    jest.setSystemTime(new Date('2026-11-28T15:30:00Z'));
    const { tokens, scan, evaluate } = setup({ feed: 'coingecko' });
    const obs = only(await evaluate(account(heldBook()), 5));
    expect(obs.source).toBe('token');
    expect(obs.marketClosed).toBeUndefined();
    expect(tokens.getCanonicalCandles).not.toHaveBeenCalled();
    expect(tokens.getOHLCV).toHaveBeenCalledTimes(2);
    expect(scan).not.toHaveBeenCalled(); // Saturday: no entries.
  });

  it('records a stock-feed failure without switching to token candles and still guards the holding', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { tokens, evaluate } = setup({
      canonical: () => Promise.reject(new Error('upstream')),
      saleRate: 900n,
    });
    const obs = only(
      await evaluate(account(heldBook()), 5).then((r) => ({
        ...r,
        observations: r.observations.filter((o) => o.asset === 'nvidia'),
      })),
    );
    expect(obs.error).toBe('market_data_unavailable');
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
    expect(obs).toMatchObject({ guardExit: 'stop', filled: true });
  });

  it('takes only terminal marks at the deadline', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { tokens, scan, evaluate } = setup();
    const round = await evaluate(account(heldBook()), 240);
    expect(only(round)).toMatchObject({ signal: 'hold', filled: false });
    expect(tokens.getCanonicalCandles).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(round.equityRaw).toBe('9999890000');
  });
});

describe('market benchmark entries', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
      ],
    });
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  const scan = () => [setupRow('alpha', 5), quietRow, setupRow('beta', 3)];

  it('enters AI-approved setups in momentum order with a tenth of marked equity', async () => {
    const market = {
      index: { aboveTrend: true, change20dPct: 2, change5dPct: 1 },
      breadthPct: 60,
      setups: 2,
    };
    const rows = scan().map((r) =>
      r.setup ? { ...r, setup: { ...r.setup, market } } : r,
    );
    const { agent, evaluate } = setup({ scan: rows });
    const acct = account(cashBook());
    const round = await evaluate(acct, 5);
    expect(round.candidates).toEqual(['alpha', 'beta']);
    expect(round.universeSize).toBe(3);
    expect(round.observations.map((o) => o.asset)).toEqual(['alpha', 'beta']);
    expect(agent.review).toHaveBeenCalledTimes(2);
    const [evidence] = agent.review.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(JSON.stringify(evidence)).not.toContain('alpha');
    // The scan's market backdrop reaches the reviewer with the setup measures.
    expect(evidence).toMatchObject({
      market,
      features: { extensionPct: 1.49, relativeMomentumPct: 3 },
    });
    for (const obs of round.observations)
      expect(obs).toMatchObject({
        signal: 'buy',
        filled: true,
        roundTripBps: 1, // the 1 bp allowance on the buy leg
        research: { selected: 'breakout-v1' },
      });
    // Two entries of 1,000 USDC sized from the same 10,000 USDC equity, plus 0.01 USDC each.
    expect(acct.state.cash).toBe('7999980000');
    expect(acct.state.positions.alpha).toMatchObject({
      mint: 'alphaMint',
      entryRule: 'breakout-v1',
      decidedBar: scan()[0].setup!.rows.at(-1)!.time,
      guard: { referencePrice: 102.4, source: 'stock' },
    });
    expect(round.equityRaw).not.toBeNull();
  });

  it('skips an entry whose quote round trip exceeds the cap', async () => {
    const { evaluate } = setup({ scan: scan(), saleRate: 980n });
    const acct = account(cashBook());
    const round = await evaluate(acct, 5);
    expect(round.observations.every((o) => o.error === 'spread_too_wide')).toBe(
      true,
    );
    expect(round.observations[0].roundTripBps).toBe(200.98);
    expect(acct.state).toEqual(cashBook());
  });

  it('records an AI skip without trading', async () => {
    const { evaluate } = setup({
      scan: scan(),
      review: { ...approve, selected: 'cash', rationale: 'Extended.' },
    });
    const acct = account(cashBook());
    const round = await evaluate(acct, 5);
    expect(
      round.observations.every((o) => o.signal === 'hold' && !o.filled),
    ).toBe(true);
    expect(acct.state).toEqual(cashBook());
  });

  it('lets the rules baseline take every setup without a model call', async () => {
    const { agent, evaluate } = setup({ scan: scan() });
    const acct = account(cashBook(), 'v2-rules');
    const round = await evaluate(acct, 5);
    expect(agent.review).not.toHaveBeenCalled();
    expect(
      round.observations.every(
        (o) => o.filled && o.research?.model === 'rules',
      ),
    ).toBe(true);
    expect(Object.keys(acct.state.positions)).toEqual(['alpha', 'beta']);
  });

  it('reuses an earlier review of the same setup candle instead of asking again', async () => {
    const rows = scan();
    const earlier: MarketRound = {
      epoch: 4,
      at: '2026-11-25T14:30:00.000Z',
      universeSize: 3,
      candidates: ['alpha'],
      observations: [
        {
          asset: 'alpha',
          rows: rows[0].setup!.rows,
          hourlyRows: rows[0].setup!.hourlyRows,
          research: { ...approve, selected: 'cash', rationale: 'Wait.' },
        },
      ],
      equityRaw: '10000000000',
      cashRaw: '10000000000',
    };
    const { agent, evaluate } = setup({ scan: rows });
    const round = await evaluate(
      account(cashBook(), 'v2-trader-2', [earlier]),
      5,
    );
    expect(agent.review).toHaveBeenCalledTimes(1); // beta only
    expect(round.observations[0]).toMatchObject({
      asset: 'alpha',
      repeatedBar: true,
      signal: 'hold',
      research: { rationale: 'Wait.' },
    });
  });

  it('makes no entries and no model calls while the market switch is off', async () => {
    const off = scan().map((r) =>
      r.setup ? { ...r, setup: { ...r.setup, switchOn: false } } : r,
    );
    const { agent, evaluate } = setup({ scan: off });
    const acct = account(cashBook());
    const round = await evaluate(acct, 5);
    expect(round.marketSwitch).toBe('off');
    expect(round.candidates).toEqual(['alpha', 'beta']);
    expect(round.observations).toEqual([]);
    expect(agent.review).not.toHaveBeenCalled();
    expect(acct.state).toEqual(cashBook());
    const on = scan().map((r) =>
      r.setup ? { ...r, setup: { ...r.setup, switchOn: true } } : r,
    );
    const open = setup({ scan: on });
    const entered = await open.evaluate(account(cashBook()), 5);
    expect(entered.marketSwitch).toBe('on');
    expect(entered.observations.every((o) => o.filled)).toBe(true);
  });

  it('does not scan once the book holds the maximum number of positions', async () => {
    const book = heldBook(Number.MAX_SAFE_INTEGER);
    for (let i = 1; i < SWING_POLICY.maxPositions; i++)
      book.positions['held-' + i] = { ...book.positions.nvidia };
    const { scan: scanned, evaluate } = setup({ scan: scan() });
    await evaluate(account(book), 5);
    expect(scanned).not.toHaveBeenCalled();
  });
});
