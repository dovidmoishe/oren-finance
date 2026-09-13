import { Injectable, Logger } from '@nestjs/common';
import type { StockAnalysis, StockOpportunity } from '../../types/analysis';
import type { Equity } from '../../types/equity';
import type { ScoreDimensions, StockSignals } from '../../types/signals';
import {
  DEFAULT_MIN_OPPORTUNITY_SCORE,
  DEFAULT_OPPORTUNITIES_LIMIT,
  OPPORTUNITY_REFRESH_CONCURRENCY,
  SIGNAL_TTL_MS,
} from '../config/constants';
import { TokensService } from '../tokens/tokens.service';
import { buildHighlights, riskLabelFromVolatility } from './highlights';
import { momentum } from './indicators/momentum';
import { rsi } from './indicators/rsi';
import { sma } from './indicators/sma';
import { volatility } from './indicators/volatility';
import { volumeTrend } from './indicators/volume-trend';
import { computeOpportunityScore } from './scoring/opportunity-score';
import { SignalsRepository } from './signals.repository';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly repository: SignalsRepository,
  ) {}

  async getSignals(
    assetId: string,
    options?: { force?: boolean },
  ): Promise<StockSignals> {
    if (!options?.force) {
      const cached = await this.repository.getByAssetId(assetId);
      if (cached && Date.now() - cached.calculatedAt.getTime() < SIGNAL_TTL_MS) {
        return cached;
      }
    }
    return this.computeAndPersist(assetId);
  }

  async getAnalysis(assetId: string): Promise<StockAnalysis> {
    const equity = await this.tokens.getStock(assetId);
    const { signals, dimensions, limitedHistory } =
      await this.computeSignalsDetailed(equity);

    await this.repository.upsert(signals);

    const price = equity.price ?? signals.sma20;
    const highlights = buildHighlights(signals, dimensions, {
      limitedHistory,
      price,
    });

    let tokensRisk: string | undefined;
    try {
      const risk = await this.tokens.getRisk(assetId);
      tokensRisk = risk.label ?? undefined;
    } catch {
      // risk optional
    }

    return {
      assetId: equity.id,
      ticker: equity.ticker,
      name: equity.name,
      opportunityScore: signals.opportunityScore,
      signals,
      highlights,
      riskLabel: riskLabelFromVolatility(signals.volatility30d, tokensRisk),
      analyzedAt: new Date(),
    };
  }

  async getOpportunities(options?: {
    limit?: number;
    minScore?: number;
  }): Promise<StockOpportunity[]> {
    const limit = clampInt(
      options?.limit ?? DEFAULT_OPPORTUNITIES_LIMIT,
      1,
      50,
    );
    const minScore =
      options?.minScore ?? DEFAULT_MIN_OPPORTUNITY_SCORE;

    const stocks = await this.tokens.getStocks();
    await mapPool(
      stocks,
      OPPORTUNITY_REFRESH_CONCURRENCY,
      async (equity) => {
        try {
          await this.getSignals(equity.id);
        } catch (err) {
          this.logger.warn(
            `signals refresh failed for ${equity.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    );

    const ranked = await this.repository.listByMinScore(minScore, limit);
    const byId = new Map(stocks.map((s) => [s.id, s]));

    return ranked.map((signals) => {
      const equity = byId.get(signals.assetId);
      const scored = computeOpportunityScore({
        momentum7d: signals.momentum7d,
        momentum30d: signals.momentum30d,
        price: equity?.price ?? signals.sma20,
        sma20: signals.sma20,
        sma50: signals.sma50,
        volumeTrend: signals.volumeTrend,
        volatility30d: signals.volatility30d,
        liquidityScore: signals.liquidityScore,
        activityScore: signals.activityScore,
      });

      return {
        assetId: signals.assetId,
        ticker: signals.ticker,
        name: equity?.name ?? signals.ticker,
        logo: equity?.logo,
        opportunityScore: signals.opportunityScore,
        price: equity?.price ?? signals.sma20,
        priceChange24h: equity?.priceChange24h ?? 0,
        highlights: buildHighlights(signals, scored.dimensions, {
          price: equity?.price ?? signals.sma20,
        }),
        signals: {
          momentum7d: signals.momentum7d,
          momentum30d: signals.momentum30d,
          volatility30d: signals.volatility30d,
          rsi14: signals.rsi14,
          volumeTrend: signals.volumeTrend,
          liquidityScore: signals.liquidityScore,
          activityScore: signals.activityScore,
        },
      } satisfies StockOpportunity;
    });
  }

  private async computeAndPersist(assetId: string): Promise<StockSignals> {
    const equity = await this.tokens.getStock(assetId);
    const { signals } = await this.computeSignalsDetailed(equity);
    return this.repository.upsert(signals);
  }

  private async computeSignalsDetailed(equity: Equity): Promise<{
    signals: StockSignals;
    dimensions: ScoreDimensions;
    limitedHistory: boolean;
  }> {
    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    let bars: Awaited<ReturnType<TokensService['getOHLCV']>> = [];
    try {
      bars = await this.tokens.getOHLCV(equity.id, {
        start,
        timeframe: '1D',
      });
    } catch (err) {
      this.logger.warn(
        `OHLCV failed for ${equity.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    bars = [...bars].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c));
    const volumes = bars
      .map((b) => b.volume ?? 0)
      .filter((v) => Number.isFinite(v));

    const limitedHistory = closes.length < 30;
    const price = equity.price ?? closes[closes.length - 1] ?? 0;

    const momentum7d = momentum(closes, 7);
    const momentum30d = momentum(closes, 30);
    const rsi14 = rsi(closes, 14);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const volatility30d = volatility(closes, 30);
    const volTrend = volumeTrend(volumes, 7);

    const liquidityScore = normalizeLiquidity(equity);
    const activityScore = normalizeActivity(equity, price);

    const { score, dimensions } = computeOpportunityScore({
      momentum7d,
      momentum30d,
      price,
      sma20,
      sma50,
      volumeTrend: volTrend,
      volatility30d,
      liquidityScore,
      activityScore,
      limitedHistory,
    });

    const signals: StockSignals = {
      assetId: equity.id,
      ticker: equity.ticker,
      momentum7d: round(momentum7d),
      momentum30d: round(momentum30d),
      volatility30d: round(volatility30d),
      volumeTrend: round(volTrend),
      rsi14: round(rsi14),
      sma20: round(sma20),
      sma50: round(sma50),
      liquidityScore: round(liquidityScore),
      activityScore: round(activityScore),
      opportunityScore: score,
      calculatedAt: new Date(),
    };

    return { signals, dimensions, limitedHistory };
  }
}

function normalizeLiquidity(equity: Equity): number {
  const fromEquity = equity.liquidity;
  if (typeof fromEquity === 'number' && fromEquity > 0) {
    // Assume raw USD liquidity — log scale into 0–100
    return clamp(Math.log10(fromEquity + 1) * 15, 0, 100);
  }
  const variantLiq = equity.variants
    .map((v) => v.liquidity ?? 0)
    .filter((n) => n > 0);
  if (variantLiq.length > 0) {
    const max = Math.max(...variantLiq);
    return clamp(Math.log10(max + 1) * 15, 0, 100);
  }
  return 50;
}

function normalizeActivity(equity: Equity, price: number): number {
  const vol = equity.volume24h;
  if (typeof vol === 'number' && vol > 0) {
    return clamp(Math.log10(vol + 1) * 12, 0, 100);
  }
  if (typeof equity.priceChange24h === 'number') {
    return clamp(50 + Math.abs(equity.priceChange24h) * 2, 0, 100);
  }
  void price;
  return 50;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  }
  const n = Math.min(concurrency, items.length);
  if (n === 0) return;
  await Promise.all(Array.from({ length: n }, () => worker()));
}
