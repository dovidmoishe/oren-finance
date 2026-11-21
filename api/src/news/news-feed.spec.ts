import {
  NewsFeedService,
  cleanStories,
  matchesStock,
} from './news-feed.service';
import { NewsFeedController } from './news-feed.controller';
import { NewsCurator } from './news-curator.service';
import type { MarketNewsItem } from '../../types/news';

jest.mock('../auth/privy-wallet-auth', () => ({ PrivyWalletAuth: jest.fn() }));

const now = Date.UTC(2026, 10, 19, 12);
const nvda = { assetId: 'nvda', ticker: 'NVDA', name: 'NVIDIA' };
const apple = { assetId: 'aapl', ticker: 'AAPL', name: 'Apple' };
const story = (
  headline = 'NVIDIA reports results',
  url = 'https://example.com/article',
): MarketNewsItem => ({
  headline,
  url,
  publishedAt: new Date(now - 3_600_000),
});

describe('news feed', () => {
  let service: NewsFeedService;
  const news = { getEquityNews: jest.fn(), getMarketNews: jest.fn() };
  const portfolio = { getPortfolio: jest.fn() };
  const tokens = { getTrendingStocks: jest.fn() };
  const curator = { select: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    news.getEquityNews.mockResolvedValue({ items: [story()] });
    news.getMarketNews.mockResolvedValue({ items: [story()] });
    tokens.getTrendingStocks.mockResolvedValue([
      { id: 'nvda', ticker: 'NVDA', name: 'NVIDIA' },
    ]);
    portfolio.getPortfolio.mockResolvedValue({
      positions: [
        { ...nvda, quantity: 2, valueUsd: 50 },
        { ...apple, quantity: 1, valueUsd: 100 },
      ],
    });
    curator.select.mockResolvedValue(null);
    service = new NewsFeedService(
      news as never,
      portfolio as never,
      tokens as never,
      curator as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('curates supplied articles for live holdings and merges duplicate stories across issuers', async () => {
    news.getEquityNews.mockResolvedValue({
      items: [story('Apple and NVIDIA announce earnings')],
    });
    curator.select.mockImplementation(
      (_user: string, _wallet: string, items: { id: string }[]) => [
        items[0].id,
      ],
    );
    const result = await service.getForYou('owner', 'linked-wallet');
    expect(portfolio.getPortfolio).toHaveBeenCalledWith('linked-wallet');
    expect(result.selection).toBe('agent');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].stocks).toEqual([apple, nvda]);
    expect(result.stocks[0]).toEqual(apple);
    expect(result.items[0].url).toBe('https://example.com/article');
  });
  it('skips curation and provider calls for zero or no stock holdings', async () => {
    portfolio.getPortfolio.mockResolvedValue({
      positions: [{ ...nvda, quantity: 0 }],
    });
    expect((await service.getForYou('owner', 'wallet')).state).toBe(
      'no_holdings',
    );
    expect(curator.select).not.toHaveBeenCalled();
    expect(news.getEquityNews).not.toHaveBeenCalled();
  });
  it('keeps partial results and distinguishes no news from unavailable providers', async () => {
    news.getEquityNews
      .mockRejectedValueOnce(new Error('provider'))
      .mockResolvedValueOnce({ items: [story()] });
    const result = await service.getForYou('owner', 'wallet');
    expect(result.partial).toBe(true);
    expect(result.state).toBe('ready');
    expect(result.selection).toBe('latest');
    news.getEquityNews.mockResolvedValue({ items: [] });
    expect((await service.getForYou('owner', 'wallet')).state).toBe('no_news');
    news.getEquityNews.mockRejectedValue(new Error('provider'));
    await expect(service.getForYou('owner', 'wallet')).rejects.toThrow(
      'temporarily unavailable',
    );
  });
  it('caps fanout at twelve largest holdings and discloses limited coverage', async () => {
    portfolio.getPortfolio.mockResolvedValue({
      positions: Array.from({ length: 20 }, (_, i) => ({
        assetId: `stock-${i}`,
        ticker: `S${i}`,
        name: `Company ${i}`,
        quantity: 1,
        valueUsd: i,
      })),
    });
    news.getEquityNews.mockResolvedValue({ items: [] });
    const result = await service.getForYou('owner', 'wallet');
    expect(news.getEquityNews).toHaveBeenCalledTimes(12);
    expect(result.totalHoldings).toBe(20);
    expect(result.partial).toBe(true);
    expect(result.stocks[0].assetId).toBe('stock-19');
  });
  it('shares public trending requests without reading a wallet or calling the curator', async () => {
    const [a, b] = await Promise.all([
      service.getTrending(),
      service.getTrending(),
    ]);
    expect(a).toEqual(b);
    await service.getTrending();
    expect(tokens.getTrendingStocks).toHaveBeenCalledTimes(1);
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
    expect(curator.select).not.toHaveBeenCalled();
  });
  it('does not reuse holdings when the wallet changes', async () => {
    await service.getForYou('owner', 'wallet-one');
    portfolio.getPortfolio.mockResolvedValue({
      positions: [{ ...apple, quantity: 1, valueUsd: 1 }],
    });
    const result = await service.getForYou('other', 'wallet-two');
    expect(result.stocks).toEqual([apple]);
    expect(result.items).toEqual([]);
  });
});

describe('news integrity', () => {
  it('rejects unsafe links and old or invalid dates, strips tracking and merges syndicated matches', () => {
    const entries = [
      {
        item: story(
          'NVIDIA news',
          'https://example.com/article?utm_source=feed#read',
        ),
        stocks: [nvda],
      },
      {
        item: story('NVIDIA news', 'https://example.com/syndicated'),
        stocks: [apple],
      },
      {
        item: story('Different title', 'https://example.com/syndicated'),
        stocks: [apple],
      },
      { item: story('Unsafe', 'javascript:alert(1)'), stocks: [] },
      {
        item: story('Credentials', 'https://user:secret@example.com'),
        stocks: [],
      },
      ...[now - 8 * 86_400_000, now + 86_400_000, NaN].map((time) => ({
        item: { ...story('Invalid date'), publishedAt: new Date(time) },
        stocks: [],
      })),
    ];
    const result = cleanStories(entries, now);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/article');
    expect(result[0].stocks).toEqual([nvda, apple]);
    expect(result[0].source).toBe('example.com');
  });
  it('matches an issuer rather than generic company-name fragments', () => {
    const stock = {
      assetId: 'ttwo',
      ticker: 'TTWO',
      name: 'Take-Two Interactive',
    };
    expect(matchesStock(story('Two companies announce earnings'), stock)).toBe(
      false,
    );
    expect(
      matchesStock(story('Take-Two Interactive announces results'), stock),
    ).toBe(true);
  });
});

describe('news authorization', () => {
  const feed = { getForYou: jest.fn(), getTrending: jest.fn() };
  const auth = { requireResearchIdentity: jest.fn() };
  const controller = new NewsFeedController(feed as never, auth as never);
  beforeEach(() => jest.resetAllMocks());
  it('checks ownership before reading holdings or invoking the curator', async () => {
    auth.requireResearchIdentity.mockRejectedValue(
      new Error('Wallet is not linked'),
    );
    await expect(
      controller.forYou('foreign-wallet', 'Bearer session'),
    ).rejects.toThrow('not linked');
    expect(feed.getForYou).not.toHaveBeenCalled();
  });
  it('uses verified identity and rejects missing or non-string wallet input', async () => {
    auth.requireResearchIdentity.mockResolvedValue({
      userId: 'owner',
      walletAddress: 'linked-wallet',
    });
    await controller.forYou(' linked-wallet ', 'Bearer session');
    expect(feed.getForYou).toHaveBeenCalledWith('owner', 'linked-wallet');
    await expect(controller.forYou(undefined as never)).rejects.toThrow(
      'walletAddress',
    );
    await expect(controller.forYou(['a', 'b'] as never)).rejects.toThrow(
      'walletAddress',
    );
  });
  it('marks personalized responses private and keeps trending anonymous', async () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect the decorated function without invoking it.
      Reflect.getMetadata('__headers__', controller.forYou),
    ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    await controller.trending();
    expect(auth.requireResearchIdentity).not.toHaveBeenCalled();
    expect(feed.getTrending).toHaveBeenCalledTimes(1);
  });
});

describe('bounded news curator', () => {
  const create = jest.fn();
  const stories = [
    {
      id: 'one',
      headline: 'NVIDIA results',
      source: 'Publisher',
      url: 'https://example.com/one',
      publishedAt: '2026-11-19T10:00:00Z',
      stocks: [nvda],
    },
  ];
  let curator: NewsCurator;
  beforeEach(() => {
    jest.resetAllMocks();
    create.mockResolvedValue({
      status: 'completed',
      output_text: '{"storyIds":["one"]}',
    });
    curator = new NewsCurator(
      { responses: { create } } as never,
      { OPENAI_MODEL: 'configured-model' } as never,
    );
  });
  it('only selects supplied IDs and excludes private identity from model input', async () => {
    expect(
      await curator.select('private-user', 'private-wallet', stories),
    ).toEqual(['one']);
    const calls = create.mock.calls as unknown[][];
    const request = calls[0][0] as {
      model: string;
      store: boolean;
      text: {
        format: {
          schema: { properties: { storyIds: { items: { enum: string[] } } } };
        };
      };
    };
    expect(request.model).toBe('configured-model');
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toMatch(/private-user|private-wallet/);
    expect(request.text.format.schema.properties.storyIds.items.enum).toEqual([
      'one',
    ]);
  });
  it.each([
    { status: 'completed', output_text: '{"storyIds":["invented"]}' },
    { status: 'completed', output_text: '{"storyIds":[]}' },
    { status: 'incomplete', output_text: '{"storyIds":["one"]}' },
    { status: 'completed', output_text: 'refused' },
  ])('falls back for invalid or incomplete output %j', async (response) => {
    create.mockResolvedValue(response);
    expect(await curator.select('owner', 'wallet', stories)).toBeNull();
  });
  it('coalesces concurrent requests and caches only the same account, wallet and evidence', async () => {
    await Promise.all([
      curator.select('owner', 'wallet', stories),
      curator.select('owner', 'wallet', stories),
    ]);
    await curator.select('owner', 'wallet', stories);
    expect(create).toHaveBeenCalledTimes(1);
    await curator.select('owner', 'other-wallet', stories);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('bounds paid work per authenticated account even when headlines change', async () => {
    for (let i = 0; i < 25; i++)
      await curator.select('owner', 'wallet', [
        { ...stories[0], headline: `Story ${i}` },
      ]);
    expect(create).toHaveBeenCalledTimes(24);
  });
  it('works without a model and tolerates timeouts', async () => {
    expect(
      await new NewsCurator(null, {} as never).select(
        'owner',
        'wallet',
        stories,
      ),
    ).toBeNull();
    create.mockRejectedValue(new Error('timeout'));
    expect(await curator.select('owner', 'wallet', stories)).toBeNull();
  });
});
