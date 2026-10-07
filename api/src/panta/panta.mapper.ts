import type {
  PantaMarket,
  PantaSource,
  PantaStockIdentity,
} from '../../types/panta';
import { ProviderError } from '../common/errors/provider.errors';

export function invalidPantaPayload(): ProviderError {
  return new ProviderError('Invalid Panta response', 'PANTA_INVALID_RESPONSE');
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidPantaPayload();
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function decimal(value: unknown): string | null {
  // The documented read API uses decimal strings. Numeric amounts could have
  // already lost precision at JSON parse time, so do not silently accept them.
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function pantaSource(
  observedAt = new Date().toISOString(),
): PantaSource {
  return {
    provider: 'Panta',
    attribution: 'Powered by Panta',
    observedAt,
    stale: false,
  };
}

/** Caller supplies the canonical directory; no company-name/LLM inference. */
export function linkPantaStocks(
  title: string,
  directory: readonly PantaStockIdentity[],
): PantaStockIdentity[] {
  const tokens = new Set(title.match(/\b[A-Z][A-Z0-9.]{0,9}\b/g) ?? []);
  const links: PantaStockIdentity[] = [];
  for (const ticker of tokens) {
    const candidates = directory.filter((stock) => stock.ticker === ticker);
    const ids = new Set(candidates.map((stock) => stock.assetId));
    if (ids.size === 1) links.push({ ...candidates[0] });
  }
  return links;
}

export function mapPantaMarket(
  value: unknown,
  source = pantaSource(),
): PantaMarket {
  const raw = record(value);
  const marketId = text(raw.marketId);
  const title = text(raw.title);
  if (!marketId || !title) throw invalidPantaPayload();
  const providerPhase = text(raw.phase);
  const phase = ['primary', 'secondary', 'resolved', 'cancelled'].includes(
    providerPhase ?? '',
  )
    ? (providerPhase as PantaMarket['phase'])
    : 'unknown';
  return {
    marketId,
    title,
    // Catalog title/description are not contractual question/rules fields.
    question: null,
    description: text(raw.description),
    images: Array.isArray(raw.images)
      ? raw.images.filter((image): image is string => typeof image === 'string')
      : [],
    category: text(raw.category),
    phase,
    providerPhase,
    marketType: text(raw.marketType),
    status: text(raw.status),
    region: text(raw.region),
    resolved: typeof raw.resolved === 'boolean' ? raw.resolved : null,
    startTime: timestamp(raw.startTime),
    endTime: timestamp(raw.endTime),
    resolutionTime: timestamp(raw.resolutionTime),
    resolutionRule: null,
    sourcesOfTruth: null,
    outcomes: (['YES', 'NO'] as const).map((side) => ({
      side,
      priceUsdc: decimal(raw[side === 'YES' ? 'yesPrice' : 'noPrice']),
      primaryPriceUsdc: decimal(
        raw[side === 'YES' ? 'primaryYesPrice' : 'primaryNoPrice'],
      ),
      secondaryPriceUsdc: decimal(
        raw[side === 'YES' ? 'secondaryYesPrice' : 'secondaryNoPrice'],
      ),
      probability: null,
      winningPayoutUsdc: null,
    })),
    volumeUsdc: decimal(raw.volumeUsdc),
    totalVolumeUsdc: decimal(raw.totalVolumeUsdc),
    liquidityUsdc: null,
    orderDepth: null,
    stockLinks: [],
    priceReference: 'unknown',
    source,
  };
}
