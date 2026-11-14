export const sectorIds = [
  'communicationServices',
  'consumerDiscretionary',
  'consumerStaples',
  'energy',
  'financials',
  'healthCare',
  'industrials',
  'materials',
  'realEstate',
  'informationTechnology',
  'utilities',
] as const;

export type SectorId = (typeof sectorIds)[number];

const validSectorIds = new Set<string>(sectorIds);

export function isSectorId(value: unknown): value is SectorId {
  return typeof value === 'string' && validSectorIds.has(value);
}
