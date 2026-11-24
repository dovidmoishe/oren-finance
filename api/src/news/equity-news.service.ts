import { Injectable } from '@nestjs/common';
import type { MarketNewsItem } from '../../types/news';
import { MarketReadCache } from '../market/market-read-cache';

@Injectable()
export class EquityNewsService {
  private readonly cache = new MarketReadCache<MarketNewsItem[]>(
    5 * 60_000,
    100,
    4,
    32,
  );

  async getNews(ticker: string): Promise<MarketNewsItem[]> {
    if (!/^[A-Z0-9.^=-]{1,20}$/i.test(ticker)) return [];
    const cached = await this.cache.get(ticker.toUpperCase(), async () => {
      const url = new URL('https://feeds.finance.yahoo.com/rss/2.0/headline');
      url.searchParams.set('s', ticker);
      url.searchParams.set('region', 'US');
      url.searchParams.set('lang', 'en-US');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error(`Equity news returned ${response.status}`);
      const xml = await response.text();
      if (xml.length > 2_000_000) throw new Error('Equity feed is too large');
      return parseEquityRss(xml, ticker);
    });
    return cached;
  }
}

/** RSS is treated only as text; never resolve XML entities or render feed HTML. */
export function parseEquityRss(
  xml: string,
  ticker: string,
  now = Date.now(),
): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const field = (name: string) =>
      decodeXml(
        new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(
          block,
        )?.[1] ?? '',
      ).trim();
    const headline = field('title');
    const link = field('link');
    const publishedAt = new Date(field('pubDate'));
    if (
      !headline ||
      headline.length > 1000 ||
      !Number.isFinite(publishedAt.getTime()) ||
      publishedAt.getTime() > now + 3600_000 ||
      publishedAt.getTime() < now - 14 * 86400_000
    )
      continue;
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    items.push({
      id: `${ticker}:${link}`,
      headline,
      url: link,
      source: field('source') || 'Yahoo Finance',
      publishedAt,
    });
    if (items.length >= 25) break;
  }
  return items;
}

function decodeXml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
      (match, entity: string) => {
        if (!entity.startsWith('#'))
          return entities[entity.toLowerCase()] ?? match;
        const n =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : '';
      },
    );
}
