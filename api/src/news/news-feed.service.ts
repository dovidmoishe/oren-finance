import { createHash } from 'node:crypto';
import type { Equity } from '../../types/equity';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  CuratedNewsFeed,
  CuratedNewsStory,
  MarketNewsItem,
  NewsFeedStock,
} from '../../types/news';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import { NewsCurator } from './news-curator.service';
import { NewsService } from './news.service';
import { matchesStock } from './news-relevance';
export { matchesStock } from './news-relevance';

const WEEK = 7 * 86_400_000;

@Injectable()
export class NewsFeedService {
  private trending?: { expires: number; feed: CuratedNewsFeed };
  private pendingTrending?: Promise<CuratedNewsFeed>;

  constructor(
    private readonly news: NewsService,
    private readonly portfolio: PortfolioService,
    private readonly tokens: TokensService,
    private readonly curator: NewsCurator,
  ) {}

  getTrending(): Promise<CuratedNewsFeed> {
    if (this.trending && this.trending.expires > Date.now())
      return Promise.resolve(this.trending.feed);
    if (this.pendingTrending) return this.pendingTrending;
    this.pendingTrending = this.buildTrending()
      .then((feed) => {
        this.trending = { feed, expires: Date.now() + 60_000 };
        return feed;
      })
      .finally(() => {
        this.pendingTrending = undefined;
      });
    return this.pendingTrending;
  }

  private async buildTrending(): Promise<CuratedNewsFeed> {
    let partial = false;
    const trending: Equity[] = await this.tokens
      .getTrendingStocks()
      .catch((): Equity[] => {
        partial = true;
        return [];
      });
    const stocks = uniqueStocks(
      trending.map((stock: Equity) => ({
        assetId: stock.id,
        ticker: stock.ticker,
        name: stock.name,
      })),
    ).slice(0, 6);
    const [scoped, market] = await Promise.all([
      this.collect(stocks),
      this.news.getMarketNews({ limit: 25 }).catch(() => {
        partial = true;
        return null;
      }),
    ]);
    if (!market && scoped.successes === 0)
      throw new ServiceUnavailableException('News is temporarily unavailable');
    const items = cleanStories([
      ...scoped.items,
      ...(market?.items ?? []).map((item) => ({
        item,
        stocks: stocks.filter((stock) => matchesStock(item, stock)),
      })),
    ]).slice(0, 20);
    return this.feed(items, stocks, partial || scoped.partial, 0);
  }

  async getForYou(userId: string, wallet: string): Promise<CuratedNewsFeed> {
    const portfolio = await this.portfolio.getPortfolio(wallet);
    const holdings = uniqueStocks(
      [...portfolio.positions]
        .filter(
          (position) =>
            position.quantity > 0 && Number.isFinite(position.quantity),
        )
        .sort((a, b) => b.valueUsd - a.valueUsd)
        .map((position) => ({
          assetId: position.assetId,
          ticker: position.ticker,
          name: position.name,
        })),
    );
    const stocks = holdings.slice(0, 12);
    if (!stocks.length)
      return { ...this.feed([], [], false, 0), state: 'no_holdings' };
    const collected = await this.collect(stocks);
    if (!collected.successes)
      throw new ServiceUnavailableException(
        'Portfolio news is temporarily unavailable',
      );
    const items = cleanStories(collected.items).slice(0, 24);
    const ids = await this.curator.select(userId, wallet, items);
    const selected = ids
      ? ids.flatMap((id) => items.filter((item) => item.id === id))
      : items;
    return {
      ...this.feed(
        selected,
        stocks,
        collected.partial || holdings.length > stocks.length,
        holdings.length,
      ),
      selection: ids ? 'agent' : 'latest',
    };
  }

  private async collect(stocks: NewsFeedStock[]) {
    // Four provider requests at a time; one unavailable issuer never drops
    // the rest of a user's feed.
    const items: Array<{ item: MarketNewsItem; stocks: NewsFeedStock[] }> = [];
    let successes = 0;
    let failures = 0;
    for (let start = 0; start < stocks.length; start += 4) {
      const group = stocks.slice(start, start + 4);
      const results = await Promise.allSettled(
        group.map((stock) =>
          this.news.getEquityNews(stock.assetId, { limit: 3 }),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failures++;
          return;
        }
        successes++;
        items.push(
          ...result.value.items
            .filter((item) => matchesStock(item, group[index]))
            .map((item) => ({ item, stocks: [group[index]] })),
        );
      });
    }
    return { items, successes, partial: failures > 0 };
  }

  private feed(
    items: CuratedNewsStory[],
    stocks: NewsFeedStock[],
    partial: boolean,
    totalHoldings: number,
  ): CuratedNewsFeed {
    return {
      items,
      stocks,
      totalHoldings,
      partial,
      selection: 'latest',
      state: items.length ? 'ready' : 'no_news',
      generatedAt: new Date().toISOString(),
    };
  }
}

function uniqueStocks(stocks: NewsFeedStock[]) {
  return [...new Map(stocks.map((stock) => [stock.assetId, stock])).values()];
}

export function cleanStories(
  entries: Array<{ item: MarketNewsItem; stocks: NewsFeedStock[] }>,
  now = Date.now(),
): CuratedNewsStory[] {
  const byUrl = new Map<string, CuratedNewsStory>();
  const byHeadline = new Map<string, CuratedNewsStory>();
  for (const { item, stocks } of [...entries].sort(
    (a, b) => b.item.publishedAt.getTime() - a.item.publishedAt.getTime(),
  )) {
    const timestamp = item.publishedAt.getTime();
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now + 300_000 ||
      timestamp < now - WEEK
    )
      continue;
    const headline = item.headline.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!headline) continue;
    let url: URL;
    try {
      url = new URL(item.url ?? '');
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    if (url.href.length > 2048) continue;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    const headlineKey = headline
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const existing = byUrl.get(url.href) ?? byHeadline.get(headlineKey);
    if (existing) {
      existing.stocks = uniqueStocks([...existing.stocks, ...stocks]);
      byUrl.set(url.href, existing);
      byHeadline.set(headlineKey, existing);
      continue;
    }
    const story: CuratedNewsStory = {
      id: createHash('sha256').update(url.href).digest('hex').slice(0, 20),
      headline,
      summary:
        item.summary?.replace(/\s+/g, ' ').trim().slice(0, 600) || undefined,
      source:
        item.source?.trim().slice(0, 80) || url.hostname.replace(/^www\./, ''),
      url: url.href,
      publishedAt: item.publishedAt.toISOString(),
      stocks: uniqueStocks(stocks),
    };
    byUrl.set(story.url, story);
    byHeadline.set(headlineKey, story);
  }
  return [...new Set(byUrl.values())];
}
