/** Monetary values remain decimal strings; never round through JS arithmetic. */
export interface PantaSource {
  provider: 'Panta';
  attribution: 'Powered by Panta';
  observedAt: string;
  stale: boolean;
}

export interface PantaStockIdentity {
  assetId: string;
  ticker: string;
}

export interface PantaMarket {
  marketId: string;
  title: string;
  question: string | null;
  description: string | null;
  images: string[];
  category: string | null;
  phase: 'primary' | 'secondary' | 'resolved' | 'cancelled' | 'unknown';
  providerPhase: string | null;
  marketType: string | null;
  status: string | null;
  region: string | null;
  resolved: boolean | null;
  startTime: string | null;
  endTime: string | null;
  resolutionTime: string | null;
  resolutionRule: string | null;
  sourcesOfTruth: string[] | null;
  outcomes: Array<{
    side: 'YES' | 'NO';
    priceUsdc: string | null;
    primaryPriceUsdc: string | null;
    secondaryPriceUsdc: string | null;
    probability: null;
    winningPayoutUsdc: null;
  }>;
  volumeUsdc: string | null;
  totalVolumeUsdc: string | null;
  liquidityUsdc: null;
  orderDepth: null;
  stockLinks: PantaStockIdentity[];
  priceReference: 'unknown';
  source: PantaSource;
}

export interface PantaMarketQuery {
  category?: string;
  status?: 'primary' | 'secondary' | 'resolved' | 'cancelled';
  createdBy?: 'me';
  cursor?: string;
  limit?: number;
}

export interface PantaMarketPage {
  items: PantaMarket[];
  nextCursor: string | null;
  source: PantaSource;
}

export interface PantaCategories {
  categories: string[];
  source: PantaSource;
}
