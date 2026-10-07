import { mapPantaMarket } from '../panta/panta.mapper';
import {
  PredictionsService,
  investingMarket,
  matchStocks,
} from './predictions.service';

const stock = {
  id: 'nvda',
  ticker: 'NVDA',
  name: 'Nvidia',
  category: 'equity' as const,
};
const row = (
  id: string,
  title: string,
  category = 'finance',
  phase = 'primary',
  volume = '0',
) =>
  mapPantaMarket({ marketId: id, title, category, phase, volumeUsdc: volume });
describe('Prediction discovery', () => {
  const panta = { listMarkets: jest.fn(), getMarket: jest.fn() };
  const market = { listStocks: jest.fn() };
  let service: PredictionsService;
  beforeEach(() => {
    jest.resetAllMocks();
    market.listStocks.mockResolvedValue({
      items: [stock],
      pagination: { hasMore: false },
    });
    service = new PredictionsService(panta as never, market as never);
  });
  it('includes investing categories and macro world events only', () => {
    expect(investingMarket(row('1', 'NVDA earnings'))).toBe(true);
    expect(investingMarket(row('1', 'Bitcoin price', 'crypto'))).toBe(true);
    expect(
      investingMarket(row('1', 'Will CPI inflation decline?', 'world')),
    ).toBe(true);
    expect(investingMarket(row('1', 'Who wins the election?', 'world'))).toBe(
      false,
    );
    expect(investingMarket(row('1', 'A football result', 'sports'))).toBe(
      false,
    );
  });
  it('rejects ambiguous names/tickers and ticker substrings', () => {
    expect(matchStocks('XNVDA and nvidia', [stock])).toEqual([
      { assetId: 'nvda', ticker: 'NVDA' },
    ]);
    expect(matchStocks('XNVDA', [stock])).toEqual([]);
    expect(matchStocks('NVDA', [stock, { ...stock, id: 'duplicate' }])).toEqual(
      [],
    );
    expect(
      matchStocks('Nvidia', [
        stock,
        { ...stock, id: 'duplicate', ticker: 'OTHER' },
      ]),
    ).toEqual([]);
  });
  it('deduplicates, ranks direct matches before macro and paginates deterministically', async () => {
    const direct = row('z', 'NVDA earnings'),
      macro = row('a', 'Inflation CPI', 'world');
    panta.listMarkets.mockResolvedValue({
      items: [macro, direct, direct, row('r', 'Old', 'finance', 'resolved')],
      nextCursor: null,
      source: { stale: false },
    });
    const first = await service.search({ assetIds: ['nvda'], limit: 1 });
    expect(first.items.map((m) => m.marketId)).toEqual(['z']);
    expect(first.hasMore).toBe(true);
    expect(
      (await service.search({ assetIds: ['nvda'], limit: 1, page: 2 })).items[0]
        .marketId,
    ).toBe('a');
  });
  it('caps scans at two pages per category and reports truncation', async () => {
    panta.listMarkets.mockResolvedValue({
      items: [row('1', 'Question')],
      nextCursor: 'cursor',
      source: { stale: false },
    });
    const result = await service.search();
    expect(panta.listMarkets).toHaveBeenCalledTimes(6);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.warnings).toHaveLength(3);
  });
  it('preserves successful categories on partial failures', async () => {
    panta.listMarkets.mockImplementation(
      ({ category }: { category: string }) =>
        category === 'crypto'
          ? Promise.reject(new Error('upstream secret'))
          : Promise.resolve({
              items: [row(category, 'Question')],
              source: { stale: false },
            }),
    );
    const result = await service.search();
    expect(result.items).toHaveLength(2);
    expect(result.coverage.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('upstream secret');
  });
  it('distinguishes successful empty catalogs from unavailable providers', async () => {
    panta.listMarkets.mockResolvedValue({
      items: [],
      source: { stale: false },
    });
    expect((await service.search()).items).toEqual([]);
    panta.listMarkets.mockRejectedValue(new Error());
    await expect(service.search()).rejects.toMatchObject({
      code: 'PREDICTIONS_UNAVAILABLE',
    });
  });
  it('orders precise large volumes without converting to numbers', async () => {
    panta.listMarkets.mockResolvedValue({
      items: [
        row('a', 'One', 'finance', 'primary', '9007199254740993.1'),
        row('b', 'Two', 'finance', 'primary', '9007199254740993.2'),
      ],
      source: { stale: false },
    });
    expect(
      (await service.search({ category: 'finance' })).items.map(
        (m) => m.marketId,
      ),
    ).toEqual(['b', 'a']);
  });
  it('does not invent stock associations when the canonical directory fails', async () => {
    market.listStocks.mockRejectedValue(new Error());
    panta.listMarkets.mockResolvedValue({
      items: [row('a', 'NVDA')],
      source: { stale: true },
    });
    const result = await service.search({ category: 'finance' });
    expect(result.items[0].stockLinks).toEqual([]);
    expect(result.coverage.warnings.length).toBeGreaterThan(0);
  });
  it('rejects non-investing details and invalid filters', async () => {
    panta.getMarket.mockResolvedValue(row('a', 'Match', 'sports'));
    await expect(service.detail('a')).rejects.toMatchObject({
      code: 'PREDICTION_NOT_FOUND',
    });
    await expect(service.search({ page: 0 })).rejects.toThrow(
      'Invalid prediction search',
    );
  });
});
