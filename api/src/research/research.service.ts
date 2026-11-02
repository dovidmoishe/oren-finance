import { BadRequestException, Injectable } from '@nestjs/common';
import type { ResearchSource, StockResearch } from '../../types/research';
import { DripService } from '../drip/drip.service';
import { DRIP_OPINION_RESEARCH_LIMIT } from '../drip/drip.types';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from '../market/market.service';
import { NewsService } from '../news/news.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { opinionOverlay } from './opinion-overlay';
import { changesSince, snapshotOf } from './research-changes';
import { ResearchRepository } from './research.repository';
import type { SavedThesis } from '../../types/research';

@Injectable()
export class ResearchService {
  constructor(
    private readonly market: MarketService,
    private readonly intelligence: IntelligenceService,
    private readonly news: NewsService,
    private readonly portfolio: PortfolioService,
    private readonly drip: DripService,
    private readonly repository: ResearchRepository,
  ) {}

  async getStock(
    assetId: string,
    caller: { userId: string; walletAddress: string; email?: string },
  ): Promise<StockResearch> {
    let stock = await this.market.getStock(assetId).catch(() => null);
    if (!stock) {
      const match = (await this.market.searchStocks(assetId)).find(
        (item) => item.ticker.toUpperCase() === assetId.toUpperCase(),
      );
      if (!match) throw new BadRequestException('Unsupported stock');
      stock = await this.market.getStock(match.id);
    }
    const id = stock.id;
    const [analysis, news, portfolio, opinions] = await Promise.all([
      settle(
        () => this.intelligence.getAnalysis(id),
        (value) => value.analyzedAt.toISOString(),
      ),
      settle(
        () =>
          this.news.getEquityNews(id, { limit: 5 }).then((feed) => feed.items),
        (items) => items[0]?.publishedAt?.toISOString(),
      ),
      settle(() =>
        this.portfolio.getPortfolio(caller.walletAddress).then((value) => {
          const position = value.positions.find((item) => item.assetId === id);
          return position
            ? {
                quantity: position.quantity,
                valueUsd: position.valueUsd,
                allocationPercent: position.allocationPercent,
                availableAmount: position.availableAmount,
                lockedAmount: position.lockedAmount,
              }
            : null;
        }),
      ),
      this.drip.enabledFor(caller)
        ? settle(
            async () => {
              const result = await this.drip.getOpinions(
                stock.ticker,
                DRIP_OPINION_RESEARCH_LIMIT,
                caller,
              );
              if (!result.available) throw new Error(result.reason);
              return opinionOverlay(result)!;
            },
            (value) => value.asOf,
          )
        : Promise.resolve({ available: false, reason: 'not_enabled' }),
    ]);
    const report: StockResearch = {
      assetId: id,
      ticker: stock.ticker,
      name: stock.name,
      generatedAt: new Date().toISOString(),
      analysis,
      news,
      portfolio,
      opinions,
    };
    const saved = await this.repository.get(caller.userId, id);
    if (saved) {
      report.saved = saved;
      report.changes = changesSince(saved.snapshot, report);
    }
    await this.repository
      .recordEvent(caller.userId, id, saved ? 'revisit' : 'open')
      .catch(() => undefined);
    return report;
  }

  listSaved(userId: string): Promise<SavedThesis[]> {
    return this.repository.list(userId);
  }

  async save(
    report: StockResearch,
    userId: string,
    note: string,
  ): Promise<SavedThesis> {
    const saved = await this.repository.save(
      userId,
      report.assetId,
      note,
      snapshotOf(report),
    );
    await this.repository
      .recordEvent(userId, report.assetId, 'save')
      .catch(() => undefined);
    return saved;
  }

  async updateNote(
    userId: string,
    assetId: string,
    note: string,
  ): Promise<SavedThesis | undefined> {
    return this.repository.updateNote(userId, assetId, note);
  }

  remove(userId: string, assetId: string): Promise<void> {
    return this.repository.remove(userId, assetId);
  }

  recordSourceOpen(userId: string, assetId: string): Promise<void> {
    return this.repository.recordEvent(userId, assetId, 'source_open');
  }
}

async function settle<T>(
  load: () => Promise<T>,
  observedAt?: (data: T) => string | undefined,
): Promise<ResearchSource<T>> {
  try {
    const data = await load();
    return {
      available: true,
      data,
      observedAt: observedAt?.(data) ?? new Date().toISOString(),
    };
  } catch {
    return { available: false, reason: 'unavailable' };
  }
}
