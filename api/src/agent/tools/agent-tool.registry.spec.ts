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
    );
  });

  it('dispatches valid read tools to backing services', async () => {
    portfolio.getPortfolio.mockResolvedValue({ walletAddress: 'wallet-1' });

    await expect(
      registry.dispatch('getPortfolio', { wallet: 'wallet-1' }),
    ).resolves.toEqual({
      output: { walletAddress: 'wallet-1' },
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

  it('fails unknown tools cleanly', async () => {
    await expect(registry.dispatch('notReal', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
