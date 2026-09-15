import { BadRequestException } from '@nestjs/common';
import { AgentToolRegistry } from './agent-tool.registry';

describe('AgentToolRegistry', () => {
  const portfolio = {
    getPortfolio: jest.fn(),
    getActivity: jest.fn(),
  };
  const market = {
    getStock: jest.fn(),
    getChart: jest.fn(),
    searchStocks: jest.fn(),
  };
  const news = {
    getEquityNews: jest.fn(),
  };
  const intelligence = {
    getAnalysis: jest.fn(),
    getOpportunities: jest.fn(),
    getSignals: jest.fn(),
  };
  const execution = {
    getQuote: jest.fn(),
    prepare: jest.fn(),
    createBasket: jest.fn(),
    prepareBasketPurchase: jest.fn(),
  };
  const vault = {
    listVaults: jest.fn(),
    prepareLock: jest.fn(),
    prepareUnlock: jest.fn(),
  };
  const social = {
    getLeaderboard: jest.fn(),
    getTraderDetail: jest.fn(),
    prepareCopyPortfolio: jest.fn(),
  };
  const calendar = {
    getCalendar: jest.fn(),
    getDay: jest.fn(),
  };

  let registry: AgentToolRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new AgentToolRegistry(
      portfolio as never,
      market as never,
      news as never,
      intelligence as never,
      execution as never,
      vault as never,
      social as never,
      calendar as never,
    );
  });

  it('publishes OpenAI-compatible strict function schemas', () => {
    for (const schema of registry.getSchemas()) {
      const parameters = schema.parameters as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };

      expect(parameters.additionalProperties).toBe(false);
      expect(parameters.required).toEqual(Object.keys(parameters.properties));
    }

    const chart = registry
      .getSchemas()
      .find((schema) => schema.name === 'getStockChart');
    const chartProperties = chart?.parameters.properties as Record<
      string,
      { type: string[] }
    >;
    expect(chartProperties.range.type).toContain('null');

    const basket = registry
      .getSchemas()
      .find((schema) => schema.name === 'createBasket');
    const basketProperties = basket?.parameters.properties as Record<
      string,
      Record<string, unknown>
    >;
    const candidates = basketProperties.candidates as {
      items: {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
    };
    expect(candidates.items.additionalProperties).toBe(false);
    expect(candidates.items.required).toEqual(
      Object.keys(candidates.items.properties),
    );

    expect(registry.getSchemas().map((schema) => schema.name)).toEqual(
      expect.arrayContaining([
        'getLeaderboard',
        'getTraderProfile',
        'prepareCopyPortfolio',
        'getTradingCalendar',
        'getTradingCalendarDay',
        'proposeLimitOrder',
        'getLimitOrders',
      ]),
    );

    expect(registry.getSchemas().map((schema) => schema.name)).not.toEqual(
      expect.arrayContaining([
        'prepareSwap',
        'prepareBasketPurchase',
        'prepareLock',
        'prepareUnlock',
      ]),
    );
  });

  it('dispatches valid read tools to backing services', async () => {
    portfolio.getPortfolio.mockResolvedValue({ walletAddress: 'wallet-1' });

    await expect(
      registry.dispatch('getPortfolio', { wallet: 'wallet-1' }),
    ).resolves.toEqual({
      output: { walletAddress: 'wallet-1' },
      artifact: {
        type: 'portfolio',
        data: { walletAddress: 'wallet-1' },
      },
    });

    expect(portfolio.getPortfolio).toHaveBeenCalledWith('wallet-1');
  });

  it('resolves tickers before running stock analysis and extracts artifacts', async () => {
    market.getStock
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ id: 'nvda', ticker: 'NVDA' });
    market.searchStocks.mockResolvedValue([{ id: 'nvda', ticker: 'NVDA' }]);
    intelligence.getAnalysis.mockResolvedValue({
      assetId: 'nvda',
      ticker: 'NVDA',
      opportunityScore: 90,
    });

    await expect(
      registry.dispatch('analyzeStock', { assetIdOrTicker: 'NVDA' }),
    ).resolves.toEqual({
      output: {
        assetId: 'nvda',
        ticker: 'NVDA',
        opportunityScore: 90,
      },
      artifact: {
        type: 'analysis',
        data: {
          assetId: 'nvda',
          ticker: 'NVDA',
          opportunityScore: 90,
        },
      },
    });
  });

  it('dispatches vault tools and extracts artifacts', async () => {
    vault.prepareLock.mockResolvedValue({
      wallet: 'wallet-1',
      transaction: 'base64',
    });

    await expect(
      registry.dispatch('prepareLock', {
        wallet: 'wallet-1',
        asset: 'NVDA',
        amount: 1,
        unlockAt: '2027-01-01T00:00:00Z',
      }),
    ).resolves.toEqual({
      output: {
        wallet: 'wallet-1',
        transaction: 'base64',
      },
      artifact: {
        type: 'prepared_lock',
        data: {
          wallet: 'wallet-1',
          transaction: 'base64',
        },
      },
    });
  });

  it('dispatches basket tools and extracts artifacts', async () => {
    execution.createBasket.mockResolvedValue({
      id: 'basket-1',
      totalAmountUsd: 100,
    });
    execution.prepareBasketPurchase.mockResolvedValue({
      basketId: 'basket-1',
      wallet: 'wallet-1',
      transactions: [],
    });

    await expect(
      registry.dispatch('createBasket', {
        amountUsd: 100,
        prompt: 'Build a basket',
      }),
    ).resolves.toEqual({
      output: {
        id: 'basket-1',
        totalAmountUsd: 100,
      },
      artifact: {
        type: 'basket',
        data: {
          id: 'basket-1',
          totalAmountUsd: 100,
        },
      },
    });

    await expect(
      registry.dispatch('prepareBasketPurchase', {
        basketId: 'basket-1',
        wallet: 'wallet-1',
      }),
    ).resolves.toEqual({
      output: {
        basketId: 'basket-1',
        wallet: 'wallet-1',
        transactions: [],
      },
      artifact: {
        type: 'prepared_basket',
        data: {
          basketId: 'basket-1',
          wallet: 'wallet-1',
          transactions: [],
        },
      },
    });
  });

  it('dispatches social tools and returns copy proposals only', async () => {
    social.getLeaderboard.mockResolvedValue({ rows: [] });
    social.getTraderDetail.mockResolvedValue({ profile: { slug: 'alpha' } });
    social.prepareCopyPortfolio.mockResolvedValue({
      source: { slug: 'alpha', displayName: 'Alpha' },
      basket: { id: 'basket-1', totalAmountUsd: 100 },
    });

    await expect(
      registry.dispatch('getLeaderboard', {
        timeframe: '30D',
        limit: 10,
      }),
    ).resolves.toEqual({ output: { rows: [] } });

    await expect(
      registry.dispatch('getTraderProfile', { slug: 'alpha' }),
    ).resolves.toEqual({ output: { profile: { slug: 'alpha' } } });

    await expect(
      registry.dispatch('prepareCopyPortfolio', {
        sourceSlug: 'alpha',
        wallet: 'wallet-1',
        amountUsd: 100,
      }),
    ).resolves.toEqual({
      output: {
        source: { slug: 'alpha', displayName: 'Alpha' },
        basket: { id: 'basket-1', totalAmountUsd: 100 },
      },
      artifact: {
        type: 'copy_portfolio_proposal',
        data: {
          source: { slug: 'alpha', displayName: 'Alpha' },
          basket: { id: 'basket-1', totalAmountUsd: 100 },
        },
      },
    });
  });

  it('dispatches trading calendar tools and returns artifacts', async () => {
    calendar.getCalendar.mockResolvedValue({
      walletAddress: 'wallet-1',
      days: [],
    });
    calendar.getDay.mockResolvedValue({
      walletAddress: 'wallet-1',
      date: '2026-09-15',
      contributors: [],
    });

    await expect(
      registry.dispatch('getTradingCalendar', {
        wallet: 'wallet-1',
        month: '2026-09',
        start: null,
        end: null,
        timeZone: 'UTC',
      }),
    ).resolves.toEqual({
      output: {
        walletAddress: 'wallet-1',
        days: [],
      },
      artifact: {
        type: 'trading_calendar',
        data: {
          walletAddress: 'wallet-1',
          days: [],
        },
      },
    });

    await expect(
      registry.dispatch('getTradingCalendarDay', {
        wallet: 'wallet-1',
        date: '2026-09-15',
        timeZone: 'UTC',
      }),
    ).resolves.toEqual({
      output: {
        walletAddress: 'wallet-1',
        date: '2026-09-15',
        contributors: [],
      },
      artifact: {
        type: 'trading_calendar_day',
        data: {
          walletAddress: 'wallet-1',
          date: '2026-09-15',
          contributors: [],
        },
      },
    });
  });

  it('fails unknown tools cleanly', async () => {
    await expect(registry.dispatch('notReal', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
