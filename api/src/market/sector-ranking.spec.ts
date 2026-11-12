import { resolveStockSector } from '../tokens/stock-sectors';
import { rankSectorMatches, type SectorCandidate } from './sector-ranking';

describe('For You sectors', () => {
  it('normalizes provider labels and uses only verified asset IDs as fallbacks', () => {
    expect(resolveStockSector('unknown', 'Information Technology')).toBe(
      'informationTechnology',
    );
    expect(resolveStockSector('unknown', 'Consumer Defensive')).toBe(
      'consumerStaples',
    );
    expect(resolveStockSector('nextera-energy')).toBe('utilities');
    expect(resolveStockSector('nvidia', 'unrecognized')).toBe(
      'informationTechnology',
    );
    expect(resolveStockSector('unknown', 'Other')).toBeNull();
  });

  it('fills six slots in sector rounds, breaks ties by asset ID and skips duplicates', () => {
    const candidates: SectorCandidate[] = [
      { id: 'tech-3', sortRank: 40, sectorId: 'informationTechnology' },
      { id: 'energy-2', sortRank: 42, sectorId: 'energy' },
      { id: 'tech-2', sortRank: 9, sectorId: 'informationTechnology' },
      { id: 'tech-1', sortRank: 2, sectorId: 'informationTechnology' },
      { id: 'energy-1', sortRank: 2, sectorId: 'energy' },
      { id: 'utility-1', sortRank: 90, sectorId: 'utilities' },
      { id: 'energy-1', sortRank: 12, sectorId: 'energy' },
      { id: 'tech-4', sortRank: 95, sectorId: 'informationTechnology' },
    ];
    expect(rankSectorMatches(candidates).map(({ id }) => id)).toEqual([
      'energy-1',
      'tech-1',
      'utility-1',
      'energy-2',
      'tech-2',
      'tech-3',
    ]);
    expect(rankSectorMatches(candidates.slice(0, 1))).toEqual(
      candidates.slice(0, 1),
    );
  });
});
