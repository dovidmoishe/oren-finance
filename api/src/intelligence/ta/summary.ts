import type {
  SetupClass,
  StockAnalysis,
  TechnicalBrief,
  TrendRegime,
} from '../../../types/analysis';

const REGIME_LABEL: Record<TrendRegime, string> = {
  uptrend: 'uptrend',
  downtrend: 'downtrend',
  range: 'range-bound',
};

const SETUP_LABEL: Record<SetupClass, string> = {
  continuation: 'trend continuation',
  mean_reversion: 'mean reversion',
  breakout: 'breakout',
  insufficient: 'insufficient history',
};

export function buildTechnicalSummary(input: {
  ticker: string;
  opportunityScore: number;
  riskLabel?: StockAnalysis['riskLabel'];
  technicalBrief: TechnicalBrief;
}): string {
  const { ticker, opportunityScore, riskLabel, technicalBrief } = input;
  const daily = technicalBrief.primaryTimeframe;
  const parts: string[] = [];

  if (technicalBrief.setup === 'insufficient') {
    parts.push(
      `${ticker} lacks enough OHLCV history for a reliable daily TA read.`,
    );
  } else if (technicalBrief.limitedHistory) {
    parts.push(
      `${ticker} is ${REGIME_LABEL[technicalBrief.regime]} with a ${SETUP_LABEL[technicalBrief.setup]} setup; daily history is thin, so hourly indicators supplement the read.`,
    );
  } else {
    parts.push(
      `${ticker} is ${REGIME_LABEL[technicalBrief.regime]} with a ${SETUP_LABEL[technicalBrief.setup]} setup.`,
    );
  }

  if (daily.sma20 > 0) {
    parts.push(
      `Daily RSI is ${formatNumber(daily.rsi14)} with MACD histogram ${formatSigned(daily.macd.histogram)}.`,
    );
  } else if (technicalBrief.hourlyTimeframe) {
    const hourly = technicalBrief.hourlyTimeframe;
    parts.push(
      `Hourly RSI is ${formatNumber(hourly.rsi14)} with MACD histogram ${formatSigned(hourly.macd.histogram)}.`,
    );
  }

  const support = technicalBrief.levels.find((level) => level.label === 'support');
  const resistance = technicalBrief.levels.find(
    (level) => level.label === 'resistance',
  );
  if (support && resistance) {
    parts.push(
      `Nearest support is ${formatNumber(support.price)} (${formatSigned(support.distancePct)}%) and resistance is ${formatNumber(resistance.price)} (+${formatNumber(Math.abs(resistance.distancePct))}%).`,
    );
  } else if (support) {
    parts.push(
      `Nearest support is ${formatNumber(support.price)} (${formatSigned(support.distancePct)}%).`,
    );
  } else if (resistance) {
    parts.push(
      `Nearest resistance is ${formatNumber(resistance.price)} (+${formatNumber(Math.abs(resistance.distancePct))}%).`,
    );
  }

  const buyZone = technicalBrief.limitZones?.find((zone) => zone.side === 'buy');
  const sellZone = technicalBrief.limitZones?.find((zone) => zone.side === 'sell');
  if (buyZone || sellZone) {
    const zoneParts: string[] = [];
    if (buyZone) {
      zoneParts.push(
        `buy-limit zone near ${formatNumber(buyZone.preferredUsd)} (${buyZone.basis.replaceAll('_', ' ')})`,
      );
    }
    if (sellZone) {
      zoneParts.push(
        `sell-limit zone near ${formatNumber(sellZone.preferredUsd)} (${sellZone.basis.replaceAll('_', ' ')})`,
      );
    }
    parts.push(`Suggested limit ranges: ${zoneParts.join('; ')}.`);
  }

  parts.push(
    `Oren Score is ${Math.round(opportunityScore)} with ${riskLabel ?? 'unclassified'} risk.`,
  );

  const conflicting = technicalBrief.newsOverlay?.filter(
    (item) => item.alignment === 'against_regime',
  );
  if (conflicting?.length) {
    parts.push(
      `Recent headlines include a potential counter-trend catalyst: "${conflicting[0].headline}".`,
    );
  }

  return parts.join(' ');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toFixed(2);
}

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}
