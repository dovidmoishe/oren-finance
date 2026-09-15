import { BadRequestException } from '@nestjs/common';
import type { Quote } from '../../types/quote';
import { BasketCache } from './basket-cache';
import { ExecutionService } from './execution.service';

const wallet = '11111111111111111111111111111111';

function makeQuote(ticker: string, amountUsd: number): Quote {
  const now = new Date();
  return {
    id: `quote-${ticker}`,
    side: 'buy',
    assetId: ticker.toLowerCase(),
    ticker,
    variant: {
      mint: `mint-${ticker}`,
      symbol: `x${ticker}`,
      name: ticker,
      tradable: true,
    },
    inputMint: 'usdc',
    outputMint: `mint-${ticker}`,
    inputSymbol: 'USDC',
    outputSymbol: `x${ticker}`,
    inputAmount: amountUsd,
    outputAmount: amountUsd / 100,
    estimatedPriceUsd: 100,
    amountUsd,
    priceImpactPercent: 0.1,
    slippageBps: 50,
    provider: 'jupiter',
    routePayload: { inAmount: '1' },
    quotedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
  };
}

describe('ExecutionService basket support', () => {
  const jupiter = {
    validateQuote: jest.fn(),
    prepareSwap: jest.fn(),
  };
  const selector = {
    selectAndQuote: jest.fn(),
  };
  const quoteCache = {
    set: jest.fn(),
    get: jest.fn(),
    attachExecution: jest.fn(),
    getPendingExecution: jest.fn(),
    delete: jest.fn(),
  };
  const repository = {
    insert: jest.fn(),
    updateStatus: jest.fn(),
    findLatestAwaitingSignature: jest.fn(),
  };
  const portfolio = {
    getPortfolio: jest.fn(),
  };
  const tokens = {};
  const intelligence = {
    getOpportunities: jest.fn(),
  };
  const trigger = {
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getTriggerOrders: jest.fn(),
  };
  const limitOrderCache = {
    setProposal: jest.fn(),
    getProposal: jest.fn(),
    attachPrepared: jest.fn(),
    getPrepared: jest.fn(),
    deleteProposal: jest.fn(),
    setCancel: jest.fn(),
    getCancel: jest.fn(),
    deleteCancel: jest.fn(),
  };
  const limitOrderRepository = {
    upsert: jest.fn(),
    updateStatus: jest.fn(),
    listByWallet: jest.fn(),
    toRecord: jest.fn(),
  };

  let baskets: BasketCache;
  let service: ExecutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    baskets = new BasketCache();
    service = new ExecutionService(
      jupiter as never,
      trigger as never,
      selector as never,
      quoteCache as never,
      baskets,
      limitOrderCache as never,
      limitOrderRepository as never,
      repository as never,
      portfolio as never,
      tokens as never,
      intelligence as never,
    );
  });

  it('creates score-weighted baskets from explicit candidates', async () => {
    const basket = await service.createBasket({
      amountUsd: 100,
      prompt: 'Build me a three stock AI basket',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
        {
          assetId: 'msft',
          ticker: 'MSFT',
          name: 'Microsoft',
          opportunityScore: 60,
          signals: { volatility30d: 2 } as never,
        },
        {
          assetId: 'aapl',
          ticker: 'AAPL',
          name: 'Apple',
          opportunityScore: 50,
          signals: { volatility30d: 1 } as never,
        },
      ],
    });

    expect(basket.allocations.map((a) => a.ticker)).toEqual([
      'NVDA',
      'MSFT',
      'AAPL',
    ]);
    expect(basket.allocations.reduce((sum, a) => sum + a.amountUsd, 0)).toBe(
      100,
    );
    expect(basket.riskLabel).toBe('moderate');
    expect(baskets.get(basket.id)).toBe(basket);
  });

  it('falls back to opportunities when no candidates are supplied', async () => {
    intelligence.getOpportunities.mockResolvedValue([
      {
        assetId: 'nvda',
        ticker: 'NVDA',
        name: 'NVIDIA',
        opportunityScore: 91,
        signals: { volatility30d: 3 },
      },
      {
        assetId: 'msft',
        ticker: 'MSFT',
        name: 'Microsoft',
        opportunityScore: 80,
        signals: { volatility30d: 2 },
      },
    ]);

    const basket = await service.createBasket({
      amountUsd: 50,
      prompt: 'Build two names',
    });

    expect(intelligence.getOpportunities).toHaveBeenCalledWith({ limit: 5 });
    expect(basket.allocations).toHaveLength(2);
  });

  it('fails basket creation when no opportunities exist', async () => {
    intelligence.getOpportunities.mockResolvedValue([]);

    await expect(
      service.createBasket({ amountUsd: 100, prompt: 'Build a basket' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prepares basket legs sequentially and keeps partial failures', async () => {
    const basket = await service.createBasket({
      amountUsd: 100,
      prompt: 'Build two stock basket',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
        {
          assetId: 'msft',
          ticker: 'MSFT',
          name: 'Microsoft',
          opportunityScore: 60,
          signals: { volatility30d: 2 } as never,
        },
      ],
    });
    const nvdaQuote = makeQuote('NVDA', basket.allocations[0].amountUsd);
    const msftQuote = makeQuote('MSFT', basket.allocations[1].amountUsd);

    selector.selectAndQuote
      .mockResolvedValueOnce({ quote: nvdaQuote })
      .mockResolvedValueOnce({ quote: msftQuote });
    quoteCache.get
      .mockReturnValueOnce({ quote: nvdaQuote })
      .mockReturnValueOnce({ quote: msftQuote });
    jupiter.prepareSwap
      .mockResolvedValueOnce({
        quoteId: nvdaQuote.id,
        wallet,
        transaction: 'base64-nvda',
        provider: 'jupiter',
        expiresAt: nvdaQuote.expiresAt,
      })
      .mockRejectedValueOnce(new Error('route vanished'));
    repository.insert.mockResolvedValue({ id: 'exec-1' });

    const result = await service.prepareBasketPurchase({
      basketId: basket.id,
      wallet,
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.progress.legs.map((leg) => leg.status)).toEqual([
      'awaiting_signature',
      'failed',
    ]);
  });
});
