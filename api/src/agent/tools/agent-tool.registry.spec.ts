import { PriceMovedError } from '../../common/errors/provider.errors';
import { BadRequestException } from '@nestjs/common';
import { AgentToolRegistry } from './agent-tool.registry';

describe('AgentToolRegistry', () => {
  const bitget = {
    getMarketContext: jest.fn(),
  };
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
      bitget as never,
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
        'getBitgetMarketContext',
      ]),
    );
    expect(registry.getSchemas().map((schema) => schema.name)).not.toEqual(
      expect.arrayContaining(['getDripOpinions', 'getDripPicks']),
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

  it('combines canonical stock resolution with live Bitget context', async () => {
    market.getStock.mockResolvedValue({
      id: 'nvda',
      ticker: 'NVDA',
      price: 190,
    });
    bitget.getMarketContext.mockResolvedValue({
      available: true,
      assetId: 'nvda',
      ticker: 'NVDA',
      symbol: 'RNVDAUSDT',
      candles: [],
    });

    await expect(
      registry.dispatch('getBitgetMarketContext', {
        assetIdOrTicker: 'NVDA',
        range: '1D',
      }),
    ).resolves.toEqual({
      output: {
        available: true,
        assetId: 'nvda',
        ticker: 'NVDA',
        symbol: 'RNVDAUSDT',
        candles: [],
        totalCandleCount: 0,
      },
      artifact: {
        type: 'bitget_market',
        data: {
          available: true,
          assetId: 'nvda',
          ticker: 'NVDA',
          symbol: 'RNVDAUSDT',
          candles: [],
          totalCandleCount: 0,
        },
      },
    });
    expect(bitget.getMarketContext).toHaveBeenCalledWith({
      assetId: 'nvda',
      ticker: 'NVDA',
      referencePriceUsd: 190,
      range: '1D',
    });
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

  it('quotes swaps for the conversation wallet without leaking route payloads to the model', async () => {
    const quote = { id: 'q-1', provider: 'jupiter', routePayload: { big: 1 } };
    execution.getQuote.mockResolvedValue(quote);

    const result = await registry.dispatch(
      'getSwapQuote',
      { side: 'buy', ticker: 'NVDA', amountUsd: 25 },
      { walletAddress: 'wallet-1' },
    );

    expect(execution.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'buy',
        ticker: 'NVDA',
        amountUsd: 25,
        wallet: 'wallet-1',
      }),
    );
    const { routePayload: _omit, ...publicQuote } = quote;
    void _omit;
    expect(result.output).toEqual(publicQuote);
    // Artifacts are persisted with the conversation: no route payload there.
    expect(result.artifact).toEqual({ type: 'quote', data: publicQuote });
    expect(result.output).not.toHaveProperty('routePayload');
  });

  it('turns PRICE_MOVED on prepareSwap into a reviewable alternative quote, never executing it', async () => {
    const alternative = { id: 'jup-alt', provider: 'jupiter' };
    const details = { quoteId: 'q-1', alternative };
    execution.prepare.mockRejectedValueOnce(
      new PriceMovedError(undefined, undefined, details as never, {
        id: 'jup-alt',
        routePayload: { big: 1 },
      }),
    );
    const result = await registry.dispatch(
      'prepareSwap',
      { quoteId: 'q-1', wallet: 'wallet-1' },
      { walletAddress: 'wallet-1' },
    );
    expect(result.output).toMatchObject({
      status: 'price_moved',
      priceMoved: details,
    });
    expect(result.artifact).toEqual({ type: 'quote', data: alternative });
    expect(execution.prepare).toHaveBeenCalledTimes(1);
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

  it('hides Drip tools from callers who are not allowlisted', async () => {
    await expect(
      registry.dispatch(
        'getDripOpinions',
        { assetIdOrTicker: 'NVDA', limit: null },
        { walletAddress: 'wallet-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgentToolRegistry Drip gating', () => {
  const drip = {
    enabledFor: jest.fn(),
    getOpinions: jest.fn(),
    getPicks: jest.fn(),
  };
  const registry = new AgentToolRegistry(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    drip as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('omits the tools until the caller is allowlisted', () => {
    drip.enabledFor.mockReturnValue(false);
    expect(
      registry
        .getSchemas({ walletAddress: 'other' })
        .map((schema) => schema.name),
    ).not.toContain('getDripOpinions');

    drip.enabledFor.mockReturnValue(true);
    const names = registry
      .getSchemas({ userId: 'did:privy:owner' })
      .map((schema) => schema.name);
    expect(names).toEqual(
      expect.arrayContaining(['getDripOpinions', 'getDripPicks']),
    );
    const opinions = registry
      .getSchemas()
      .find((schema) => schema.name === 'getDripOpinions');
    expect(opinions?.description).toContain('not facts or financial advice');
    expect(opinions?.description).toContain('TSLAx');
  });

  it('clamps the opinion count and returns the Drip payload', async () => {
    drip.enabledFor.mockReturnValue(true);
    drip.getOpinions.mockResolvedValue({ available: true, opinions: [] });
    drip.getPicks.mockResolvedValue({ available: false, reason: 'DRIP_UNSET' });

    await registry.dispatch(
      'getDripOpinions',
      { assetIdOrTicker: 'TSLAx', limit: 100 },
      { walletAddress: 'wallet-owner' },
    );
    expect(drip.getOpinions).toHaveBeenCalledWith('TSLAx', 12);

    await expect(
      registry.dispatch(
        'getDripPicks',
        { limit: null },
        { email: 'owner@example.com' },
      ),
    ).resolves.toEqual({
      output: { available: false, reason: 'DRIP_UNSET' },
    });
    expect(drip.getPicks).toHaveBeenCalledWith(8);
  });
});
