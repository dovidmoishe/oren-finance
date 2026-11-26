import type { MarketCandle } from '../../types/market';
import type {
  MarketBook,
  MarketObservation,
  MarketRound,
} from '../../types/paper-market';
import { USDC_MINT } from '../config/constants';
import { benchmarkAssetIds, MarketBenchmark } from './market-benchmark';
import {
  isNyseTradingDay,
  isStockSessionHour,
  STOCK_FEED_SOURCE,
} from './market-data';
import { DAY, HOUR, settle } from './strategy';

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

function setup(options: {
  feed?: string;
  canonical?: (interval: string) => MarketCandle[] | Promise<never>;
  signal?: 'buy' | 'hold' | 'sell';
  saleRate?: bigint;
}) {
  const now = Date.now();
  const tokens = {
    getStock: jest.fn((id: string) =>
      Promise.resolve({
        id,
        ...(options.feed ? { canonicalMarketSource: options.feed } : {}),
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
    investigate: jest.fn(() =>
      Promise.resolve({
        signal: options.signal ?? 'hold',
        research: {
          version: 'test',
          model: 'test',
          tools: [],
          rationale: '',
          selected: 'breakout-v1' as const,
        },
      }),
    ),
  };
  const bench = new MarketBenchmark(
    {} as never,
    {} as never,
    tokens as never,
    paper as never,
    agent as never,
    {} as never,
  ) as unknown as {
    evaluate(account: unknown, epoch: number): Promise<MarketRound>;
  };
  return { tokens, paper, agent, bench };
}

// Epoch 5 reuses the epoch-4 screen, so no database read is needed.
const account = (book: MarketBook, candidates: string[]) => ({
  accountId: 'trader-1',
  state: book,
  rounds: [
    {
      epoch: 4,
      at: '2026-11-25T10:00:00.000Z',
      method: 'hourly-swing-v2',
      screenEpoch: 4,
      universeSize: candidates.length,
      candidates,
      observations: [],
      equityRaw: null,
      cashRaw: book.cash,
    },
  ],
});
const heldBook = (): MarketBook => ({
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
        setAt: '2026-11-25T20:30:00.000Z',
      },
    },
  },
});
const only = (round: MarketRound): MarketObservation => {
  expect(round.observations).toHaveLength(1);
  return round.observations[0];
};

describe('market benchmark report assets', () => {
  it('lists every held, shortlisted and reviewed asset once', () => {
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

describe('market benchmark candle sources and exits', () => {
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

  it('reads stock-market candles in the regular session and anchors a guard on entry', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z')); // Wednesday 10:30 ET
    const { tokens, agent, bench } = setup({
      feed: STOCK_FEED_SOURCE,
      signal: 'buy',
    });
    const acct = account({ cash: '10000000000', positions: {} }, ['nvidia']);
    const round = await bench.evaluate(acct, 5);
    const obs = only(round);
    expect(round.method).toBe('hourly-swing-v2');
    expect(obs).toMatchObject({
      source: 'stock',
      session: 'regular',
      filled: true,
    });
    expect(obs.error).toBeUndefined();
    expect(
      tokens.getCanonicalCandles.mock.calls.map((c) => c[1].interval),
    ).toEqual(['1H', '1D']);
    for (const interval of ['1H', '1D'])
      expect(tokens.getCanonicalCandles).toHaveBeenCalledWith(
        'nvidia',
        expect.objectContaining({ interval }),
        MINT,
      );
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
    expect(agent.investigate.mock.calls[0]).toHaveLength(7);
    expect((agent.investigate.mock.calls[0] as unknown[])[6]).toBe('stock');
    const guard = acct.state.positions.nvidia.guard!;
    const latest = stockHourly(Date.now()).at(-1)!;
    expect(guard).toMatchObject({
      source: 'stock',
      referencePrice: latest.close,
      referenceValueUsdcRaw: obs.exit!.quotedOutput,
      setAt: new Date().toISOString(),
    });
    expect(BigInt(guard.stopUsdcRaw)).toBeLessThan(
      BigInt(guard.referenceValueUsdcRaw),
    );
  });

  it('waits for the open on Thanksgiving instead of recording a data error', async () => {
    jest.setSystemTime(new Date('2026-11-26T15:30:00Z'));
    const { tokens, paper, agent, bench } = setup({ feed: STOCK_FEED_SOURCE });
    const obs = only(
      await bench.evaluate(
        account({ cash: '10000000000', positions: {} }, ['nvidia']),
        5,
      ),
    );
    expect(obs).toMatchObject({
      source: 'stock',
      session: 'closed',
      marketClosed: true,
      signal: 'hold',
    });
    expect(obs.error).toBeUndefined();
    expect(tokens.getCanonicalCandles).toHaveBeenCalledTimes(1);
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
    expect(agent.investigate).not.toHaveBeenCalled();
    expect(paper.route).not.toHaveBeenCalled();
  });

  it('sells a holding on a Saturday when the live token quote breaks its guard', async () => {
    jest.setSystemTime(new Date('2026-11-28T15:30:00Z'));
    const { agent, bench } = setup({ feed: STOCK_FEED_SOURCE, saleRate: 900n });
    const acct = account(heldBook(), []);
    const obs = only(await bench.evaluate(acct, 5));
    expect(obs).toMatchObject({
      marketClosed: true,
      guardExit: 'stop',
      signal: 'sell',
      filled: true,
    });
    expect(agent.investigate).not.toHaveBeenCalled();
    expect(acct.state.positions.nvidia).toBeUndefined();
    expect(acct.state.cash).toBe(
      settle({ cash: '9000000000', position: '1000000000' }, 'sell', obs.terms!)
        .book.cash,
    );
  });

  it('keeps the holding and its guard while the live quote stays above the stop', async () => {
    jest.setSystemTime(new Date('2026-11-28T15:30:00Z'));
    const { bench } = setup({ feed: STOCK_FEED_SOURCE, saleRate: 990n });
    const acct = account(heldBook(), []);
    const round = await bench.evaluate(acct, 5);
    const obs = only(round);
    expect(obs).toMatchObject({
      marketClosed: true,
      signal: 'hold',
      filled: false,
    });
    expect(obs.guardExit).toBeUndefined();
    expect(acct.state.positions.nvidia).toEqual(heldBook().positions.nvidia);
    expect(round.equityRaw).not.toBeNull();
  });

  it('re-anchors a holding guard after a fresh in-session decision', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { bench } = setup({ feed: STOCK_FEED_SOURCE });
    const acct = account(heldBook(), []);
    const obs = only(await bench.evaluate(acct, 5));
    expect(obs.guardExit).toBeUndefined();
    expect(acct.state.positions.nvidia.guard).toMatchObject({
      source: 'stock',
      referencePrice: stockHourly(Date.now()).at(-1)!.close,
      referenceValueUsdcRaw: obs.terms!.quotedOutput,
      setAt: new Date().toISOString(),
    });
  });

  it('uses the traded mint candles at any hour for assets without a stock-market feed', async () => {
    jest.setSystemTime(new Date('2026-11-28T15:30:00Z'));
    const { tokens, agent, bench } = setup({ feed: 'coingecko' });
    const obs = only(
      await bench.evaluate(
        account({ cash: '10000000000', positions: {} }, ['soxs']),
        5,
      ),
    );
    expect(obs.source).toBe('token');
    expect(obs.session).toBeUndefined();
    expect(obs.marketClosed).toBeUndefined();
    expect(tokens.getCanonicalCandles).not.toHaveBeenCalled();
    expect(tokens.getOHLCV.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ mint: MINT, timeframe: '1D' }),
      expect.objectContaining({ mint: MINT, timeframe: '1H' }),
    ]);
    expect((agent.investigate.mock.calls[0] as unknown[])[6]).toBe('token');
  });

  it('falls back to token candles when a mapped stock chart is round-the-clock', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { tokens, bench } = setup({
      feed: STOCK_FEED_SOURCE,
      canonical: () => allHours(Date.now()),
    });
    const obs = only(
      await bench.evaluate(
        account({ cash: '10000000000', positions: {} }, ['sk-hynix']),
        5,
      ),
    );
    expect(obs.source).toBe('token');
    expect(tokens.getCanonicalCandles).toHaveBeenCalledTimes(1);
    expect(tokens.getOHLCV).toHaveBeenCalledTimes(2);
  });

  it('records a stock-feed failure without switching to token candles', async () => {
    jest.setSystemTime(new Date('2026-11-25T15:30:00Z'));
    const { tokens, paper, bench } = setup({
      feed: STOCK_FEED_SOURCE,
      canonical: () => Promise.reject(new Error('upstream')),
    });
    const obs = only(
      await bench.evaluate(
        account({ cash: '10000000000', positions: {} }, ['nvidia']),
        5,
      ),
    );
    expect(obs.error).toBe('market_data_unavailable');
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
    expect(paper.route).not.toHaveBeenCalled();
  });
});
