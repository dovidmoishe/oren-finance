import { EquityNewsService, parseEquityRss } from './equity-news.service';
import { NewsService } from './news.service';

describe('equity news fallback', () => {
  afterEach(() => jest.restoreAllMocks());
  it('parses headlines and dates while excluding stale items and unsafe links', () => {
    const item = (link: string, date: string) =>
      `<item><title><![CDATA[NVIDIA &amp; AI]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
    const now = Date.parse('2026-11-24T00:00:00Z');
    const result = parseEquityRss(
      `<rss>${item('https://example.com/a', 'Mon, 23 Nov 2026 15:00:00 GMT')}${item('javascript:alert(1)', 'Mon, 23 Nov 2026 15:00:00 GMT')}${item('https://example.com/old', 'Mon, 01 Jan 2024 15:00:00 GMT')}</rss>`,
      'NVDA',
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      headline: 'NVIDIA & AI',
      source: 'Yahoo Finance',
    });
    expect(result[0].publishedAt.toISOString()).toBe(
      '2026-11-23T15:00:00.000Z',
    );
  });
  it('coalesces empty feed reads instead of hammering the provider', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<rss />'),
    } as Response);
    const service = new EquityNewsService();
    await Promise.all([service.getNews('NVDA'), service.getNews('NVDA')]);
    await service.getNews('NVDA');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await service.getNews('../bad')).toEqual([]);
  });
  it('serves equity headlines when Tokens and Postgres both fail', async () => {
    const item = {
      ticker: 'NVDA',
      headline: 'NVIDIA reinstates CEO',
      publishedAt: new Date(),
    };
    const service = new NewsService(
      {
        getStock: () =>
          Promise.resolve({
            id: 'nvidia',
            ticker: 'NVDA',
            name: 'NVIDIA',
          }),
        getNews: () => Promise.reject(new Error('Tokens offline')),
      } as never,
      {} as never,
      {
        listFresh: () => Promise.reject(new Error('DB offline')),
        replaceScope: () => Promise.reject(new Error('DB offline')),
      } as never,
      {
        getNews: () =>
          Promise.resolve([
            item,
            { headline: 'Central Garden earnings', publishedAt: new Date() },
          ]),
      } as never,
    );
    expect((await service.getEquityNews('nvidia')).items).toEqual([item]);
  });
});
