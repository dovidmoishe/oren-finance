import type { LimitZone, PriceLevel } from '../../../types/analysis';
import type { BollingerSnapshot } from '../../../types/analysis';

const ATR_BUFFER_FRACTION = 0.25;

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function distancePct(price: number, level: number): number {
  if (!price || !level) return 0;
  return ((level - price) / price) * 100;
}

/**
 * Deterministic limit-order zones from swing S/R, with Bollinger fallback.
 * ATR is used only as a small buffer around the preferred level.
 * LLM explains these — never invents them.
 */
export function buildLimitZones(input: {
  price: number;
  levels: PriceLevel[];
  bollinger?: BollingerSnapshot;
  atr14?: number;
}): LimitZone[] {
  const { price, levels, bollinger, atr14 = 0 } = input;
  if (!Number.isFinite(price) || price <= 0) return [];

  const buffer = atr14 > 0 ? atr14 * ATR_BUFFER_FRACTION : 0;
  const support = levels.find((level) => level.label === 'support');
  const resistance = levels.find((level) => level.label === 'resistance');
  const zones: LimitZone[] = [];

  const buyPreferred =
    support && support.price < price
      ? support.price
      : bollinger && bollinger.lower > 0 && bollinger.lower < price
        ? bollinger.lower
        : undefined;

  if (buyPreferred !== undefined) {
    const basis = support && support.price < price ? 'swing_support' : 'bollinger_lower';
    const conservative = round(Math.max(0, buyPreferred - buffer));
    const aggressive = round(
      Math.min(price * 0.999, buyPreferred + buffer),
    );
    zones.push({
      side: 'buy',
      preferredUsd: round(buyPreferred),
      conservativeUsd:
        conservative > 0 && conservative < buyPreferred
          ? conservative
          : undefined,
      aggressiveUsd:
        aggressive > buyPreferred && aggressive < price
          ? aggressive
          : undefined,
      basis,
      distancePct: round(distancePct(price, buyPreferred)),
    });
  }

  const sellPreferred =
    resistance && resistance.price > price
      ? resistance.price
      : bollinger && bollinger.upper > 0 && bollinger.upper > price
        ? bollinger.upper
        : undefined;

  if (sellPreferred !== undefined) {
    const basis =
      resistance && resistance.price > price
        ? 'swing_resistance'
        : 'bollinger_upper';
    const conservative = round(sellPreferred + buffer);
    const aggressive = round(
      Math.max(price * 1.001, sellPreferred - buffer),
    );
    zones.push({
      side: 'sell',
      preferredUsd: round(sellPreferred),
      conservativeUsd:
        conservative > sellPreferred ? conservative : undefined,
      aggressiveUsd:
        aggressive < sellPreferred && aggressive > price
          ? aggressive
          : undefined,
      basis,
      distancePct: round(distancePct(price, sellPreferred)),
    });
  }

  return zones;
}
