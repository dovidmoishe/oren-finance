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

// Themes overlap sectors; a company keeps its original sector classification.
export const themeIds = [
  'artificialIntelligence',
  'semiconductors',
  'cybersecurity',
  'cloudComputing',
  'robotics',
  'cleanEnergy',
  'fintech',
  'spaceAndDefense',
] as const;

export type ThemeId = (typeof themeIds)[number];
export const interestIds = [...sectorIds, ...themeIds] as const;
export type InterestId = (typeof interestIds)[number];

const validSectorIds = new Set<string>(sectorIds);

export function isSectorId(value: unknown): value is SectorId {
  return typeof value === 'string' && validSectorIds.has(value);
}

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' && (themeIds as readonly string[]).includes(value)
  );
}

export function isInterestId(value: unknown): value is InterestId {
  return isSectorId(value) || isThemeId(value);
}
