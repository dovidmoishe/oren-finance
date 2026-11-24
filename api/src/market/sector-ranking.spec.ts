import { resolveStockSector } from '../tokens/stock-sectors';
import { rankSectorMatches, type SectorCandidate } from './sector-ranking';
import { isInterestId, isSectorId } from '../../types/sectors';

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

  it('keeps themes distinct from standard sectors', () => {
    expect(isInterestId('artificialIntelligence')).toBe(true);
    expect(isSectorId('artificialIntelligence')).toBe(false);
    expect(resolveStockSector('unknown', 'Artificial Intelligence')).toBeNull();
    expect(isInterestId('trending')).toBe(false);
  });

  it('balances overlapping themes without duplicating or losing stocks', () => {
    const candidates: SectorCandidate[] = [
      {
        id: 'nvidia',
        sortRank: 0,
        sectorId: 'informationTechnology',
        interestId: 'artificialIntelligence',
      },
      {
        id: 'nvidia',
        sortRank: 0,
        sectorId: 'informationTechnology',
        interestId: 'semiconductors',
      },
      {
        id: 'microsoft',
        sortRank: 1,
        sectorId: 'informationTechnology',
        interestId: 'artificialIntelligence',
      },
      { id: 'amd', sortRank: 2, sectorId: null, interestId: 'semiconductors' },
      {
        id: 'alphabet',
        sortRank: 3,
        sectorId: 'communicationServices',
        interestId: 'artificialIntelligence',
      },
      { id: 'tsmc', sortRank: 4, sectorId: null, interestId: 'semiconductors' },
    ];
    expect(rankSectorMatches(candidates).map(({ id }) => id)).toEqual([
      'nvidia',
      'amd',
      'microsoft',
      'tsmc',
      'alphabet',
    ]);
    expect(rankSectorMatches(candidates, 2)).toHaveLength(2);
    expect(rankSectorMatches([])).toEqual([]);
    expect(candidates).toHaveLength(6);
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
