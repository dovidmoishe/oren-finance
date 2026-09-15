import type { SetupClass, TrendRegime } from '../../../types/analysis';
import type { BollingerResult } from '../indicators/bollinger';

export function setupClass(input: {
  regime: TrendRegime;
  rsi14: number;
  price: number;
  sma20: number;
  bollinger: BollingerResult;
  volumeTrend: number;
  limitedHistory: boolean;
}): SetupClass {
  if (input.limitedHistory) return 'insufficient';

  const { regime, rsi14, price, sma20, bollinger, volumeTrend } = input;
  const nearUpper =
    bollinger.upper > 0 &&
    price >= bollinger.upper * 0.985 &&
    volumeTrend >= 1.15;
  const nearLower =
    bollinger.lower > 0 &&
    price <= bollinger.lower * 1.015 &&
    volumeTrend >= 1.15;

  if (nearUpper || nearLower) return 'breakout';

  if (regime === 'range' && (rsi14 >= 70 || rsi14 <= 30)) {
    return 'mean_reversion';
  }

  if (
    (regime === 'uptrend' || regime === 'downtrend') &&
    rsi14 >= 35 &&
    rsi14 <= 70 &&
    sma20 > 0 &&
    Math.abs((price - sma20) / sma20) <= 0.04
  ) {
    return 'continuation';
  }

  if (regime === 'range') return 'mean_reversion';
  return 'continuation';
}
