import { sectorIds, type SectorId } from '../../types/sectors';

// Canonical asset IDs matched to constituent tickers in the Select Sector SPDR
// holdings guide. Nucor is confirmed in State Street's XLB holdings.
// https://www.sectorspdrs.com/api/documents/by-fullname/General%20Documents/20%20Years%20of%20SP%20500%20in%20Sectors
// https://www.ssga.com/us/en/individual/etfs/state-street-materials-select-sector-spdr-etf-xlb
const fallbackGroups: Record<SectorId, readonly string[]> = {
  communicationServices: [
    'meta',
    'alphabet',
    'netflix',
    'atandt',
    'verizon',
    'comcast',
    't-mobile',
  ],
  consumerDiscretionary: [
    'amazon',
    'tesla',
    'home-depot',
    'mcdonald-s',
    'booking',
    'lowe-s',
    'starbucks',
    'nike',
  ],
  consumerStaples: [
    'costco',
    'procter-and-gamble',
    'walmart',
    'coca-cola',
    'philip-morris',
    'pepsico',
    'target',
  ],
  energy: [
    'exxon-mobil',
    'chevron',
    'conocophillips',
    'stock-i7zs13sf',
    'stock-bvjmewqb',
  ],
  financials: [
    'berkshire-hathaway',
    'jpmorgan-chase',
    'visa',
    'mastercard',
    'bank-of-america',
    'wells-fargo',
    'goldman-sachs',
    'sandp-global',
    'american-express',
  ],
  healthCare: [
    'eli-lilly',
    'unitedhealth',
    'johnson-and-johnson',
    'abbvie',
    'abbott',
    'merck',
    'thermo-fisher',
    'intuitive-surgical',
    'amgen',
  ],
  industrials: [
    'general-electric',
    'rtx',
    'caterpillar',
    'uber',
    'honeywell',
    'boeing',
    'deere',
  ],
  materials: ['linde', 'stock-mvaupvwk'],
  realEstate: ['equinix'],
  informationTechnology: [
    'apple',
    'microsoft',
    'nvidia',
    'broadcom',
    'salesforce',
    'cisco',
  ],
  utilities: ['nextera-energy', 'southern', 'constellation-energy'],
};

const fallback = new Map(
  sectorIds.flatMap((sector) =>
    fallbackGroups[sector].map((id) => [id, sector] as const),
  ),
);

const aliases = new Map<string, SectorId>([
  ...sectorIds.map((id) => [id.toLowerCase(), id] as const),
  ['communications', 'communicationServices'],
  ['communication', 'communicationServices'],
  ['consumercyclical', 'consumerDiscretionary'],
  ['consumernoncyclical', 'consumerStaples'],
  ['consumerdefensive', 'consumerStaples'],
  ['financialservices', 'financials'],
  ['finance', 'financials'],
  ['industrial', 'industrials'],
  ['basicmaterials', 'materials'],
  ['technology', 'informationTechnology'],
]);

export function resolveStockSector(
  assetId: string,
  label?: string,
): SectorId | null {
  const key =
    typeof label === 'string'
      ? label.toLowerCase().replace(/[^a-z0-9]/g, '')
      : '';
  return aliases.get(key) ?? fallback.get(assetId) ?? null;
}
