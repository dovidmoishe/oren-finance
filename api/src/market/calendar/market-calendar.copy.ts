import type {
  OfficialAgencyId,
  OfficialAttribution,
  OfficialSource,
} from '../../../types/market-calendar';

/** States the product fact every hours answer must carry. */
export const US_CASH_SESSION_NOTE =
  'US cash-session calendar for US-listed stocks (NYSE schedule). Tokenized stocks can still trade on-chain when this session is closed, but prices can drift from the stock, on-chain liquidity is often thinner, and issuers may pause minting and redemptions. It does not say whether a token can be swapped right now.';

export const OFFICIAL_EVENTS_NOTE =
  'Official US release dates, times, and published results only. Forecasts and consensus estimates are not included.';

/**
 * BLS Public Data API terms (https://www.bls.gov/developers/termsOfService.htm):
 * users "must clearly state" this sentence.
 */
export const BLS_NOTICE =
  'BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.';

/**
 * BEA API terms (https://apps.bea.gov/API/_pdf/bea_api_tos.pdf): display this
 * notice prominently within the application.
 */
export const BEA_NOTICE =
  'This product uses the Bureau of Economic Analysis (BEA) Data API but is not endorsed or certified by BEA.';

/**
 * Census Data API terms
 * (https://www.census.gov/data/developers/about/terms-of-service.html):
 * display this notice prominently within the application.
 */
export const CENSUS_NOTICE =
  'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.';

interface AgencyCopy extends OfficialSource {
  notice: string | null;
}

/**
 * Credit line and required notice per source. The Labor Department
 * (dol.gov/general/aboutdol/copyright) and the Fed Board
 * (federalreserve.gov/disclaimer.htm) publish public-domain material and ask
 * only for credit. None of the five may be shown as endorsing Oren, and none
 * of their logos or seals may be used.
 */
export const OFFICIAL_AGENCIES: Readonly<Record<OfficialAgencyId, AgencyCopy>> =
  {
    bls: {
      id: 'bls',
      name: 'U.S. Bureau of Labor Statistics',
      url: 'https://www.bls.gov/',
      notice: BLS_NOTICE,
    },
    bea: {
      id: 'bea',
      name: 'U.S. Bureau of Economic Analysis',
      url: 'https://www.bea.gov/',
      notice: BEA_NOTICE,
    },
    census: {
      id: 'census',
      name: 'U.S. Census Bureau',
      url: 'https://www.census.gov/',
      notice: CENSUS_NOTICE,
    },
    dol: {
      id: 'dol',
      name: 'U.S. Department of Labor',
      url: 'https://www.dol.gov/',
      notice: null,
    },
    frb: {
      id: 'frb',
      name: 'Federal Reserve Board',
      url: 'https://www.federalreserve.gov/',
      notice: null,
    },
  };

const AGENCY_ORDER: readonly OfficialAgencyId[] = [
  'frb',
  'bls',
  'bea',
  'census',
  'dol',
];

export function isOfficialAgencyId(value: unknown): value is OfficialAgencyId {
  return (
    typeof value === 'string' &&
    (AGENCY_ORDER as readonly string[]).includes(value)
  );
}

/** Credits and notices for the agencies behind a set of events, in a fixed order. */
export function officialAttribution(
  agencies: Iterable<OfficialAgencyId>,
): OfficialAttribution {
  const present = new Set(agencies);
  const copy = AGENCY_ORDER.filter((id) => present.has(id)).map(
    (id) => OFFICIAL_AGENCIES[id],
  );
  return {
    sources: copy.map(({ id, name, url }) => ({ id, name, url })),
    notices: copy.flatMap(({ notice }) => (notice ? [notice] : [])),
  };
}
