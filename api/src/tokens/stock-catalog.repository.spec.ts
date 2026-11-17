import type { CachedStockRow } from './stock-catalog.repository';
import {
  rowToStockSummary,
  StockCatalogRepository,
} from './stock-catalog.repository';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { Database } from '../database/database.provider';

describe('stock catalog repository mapping', () => {
  it('maps persisted numeric values into a stock summary', () => {
    const row = {
      assetId: 'nvidia',
      ticker: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      sectorId: 'informationTechnology',
      alertVariants: [],
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: '182.14',
      priceChange24h: '2.35',
      volume24h: '12000000',
      liquidity: '4500000',
      sortRank: 0,
      cachedAt: new Date('2026-09-13T06:00:00Z'),
      expiresAt: new Date('2026-09-13T06:01:00Z'),
    } satisfies CachedStockRow;

    expect(rowToStockSummary(row)).toEqual({
      id: 'nvidia',
      ticker: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: 182.14,
      priceChange24h: 2.35,
      volume24h: 12_000_000,
      liquidity: 4_500_000,
    });
  });

  it('matches themes by canonical identity across sectors and retains the real sector', async () => {
    const expires = '2026-11-16T12:00:00Z';
    const query = jest.fn((sql: string) =>
      Promise.resolve({
        rows: sql.startsWith('select "expires_at"')
          ? [[expires]]
          : [
              [
                'informationTechnology',
                '[]',
                'nvidia',
                'NVDA',
                'NVIDIA',
                'equity',
                null,
                null,
                null,
                null,
                null,
                0,
                expires,
                expires,
              ],
              [
                'communicationServices',
                '[]',
                'alphabet',
                'GOOGL',
                'Alphabet',
                'equity',
                null,
                null,
                null,
                null,
                null,
                1,
                expires,
                expires,
              ],
              [
                null,
                '[]',
                'amd',
                'AMD',
                'AMD',
                'equity',
                null,
                null,
                null,
                null,
                null,
                2,
                expires,
                expires,
              ],
              [
                'informationTechnology',
                '[]',
                'apple',
                'AAPL',
                'Apple',
                'equity',
                null,
                null,
                null,
                null,
                null,
                3,
                expires,
                expires,
              ],
            ],
      }),
    );
    const catalog = new StockCatalogRepository(
      drizzle(query) as unknown as Database,
    );
    const result = await catalog.findSectorCandidates(
      ['artificialIntelligence', 'semiconductors'],
      new Date('2026-11-16T11:00:00Z'),
    );
    expect(result?.isFresh).toBe(true);
    expect(result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'alphabet',
          sectorId: 'communicationServices',
          interestId: 'artificialIntelligence',
        }),
        expect.objectContaining({
          id: 'amd',
          sectorId: null,
          interestId: 'semiconductors',
        }),
      ]),
    );
    expect(result?.items.some(({ id }) => id === 'apple')).toBe(false);
    expect(query.mock.calls[1][0]).toContain('"category" =');
  });
});
