import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';
import { mcpConnections, mcpTradeIntents } from '../database/schema';
import { USDC_MINT } from '../config/constants';
import type { Quote } from '../../types/quote';
import { uiAmountToRaw } from '../execution/jupiter/jupiter.mapper';
import { rawSellReferenceUsd } from './delegated-amounts';

jest.mock('@modelcontextprotocol/server', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: jest.fn().mockImplementation(() => ({
    handleRequest: jest.fn().mockResolvedValue(undefined),
  })),
}));

async function registeredTools(
  scopes: string[],
  quote?: Quote,
  review?: {
    intent?: { id: string; mode: string };
    converted?: boolean;
    delegation?: Record<string, unknown> | null;
  },
) {
  const connection = {
    grantId: 'grant-1',
    clientId: 'client-1',
    userId: 'user-1',
    walletId: 'wallet-1',
    wallet: 'solana-wallet',
    scopes: scopes.join(' '),
    createdAt: new Date(),
  };
  const values = jest.fn().mockReturnValue({
    returning: jest
      .fn()
      .mockResolvedValue([
        { id: 'intent-test', expiresAt: new Date(Date.now() + 300_000) },
      ]),
  });
  const set = jest.fn().mockReturnValue({
    where: () => ({
      returning: jest
        .fn()
        .mockResolvedValue(
          review?.converted ? [{ id: review.intent?.id }] : [],
        ),
    }),
  });
  const deps = {
    db: {
      update: () => ({ set }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: jest.fn().mockResolvedValue(
              table === mcpConnections
                ? [connection]
                : table === mcpTradeIntents
                  ? review?.intent
                    ? [review.intent]
                    : []
                  : review?.delegation === null
                    ? []
                    : [
                        {
                          id: 'delegation-test',
                          activatedAt: new Date(Date.now() - 60_000),
                          maxSlippageBps: 50,
                          allowSell: true,
                          ...review?.delegation,
                        },
                      ],
            ),
          }),
        }),
      }),
      insert: () => ({ values }),
    },
    auth: { verifyMcpWallet: jest.fn().mockResolvedValue(undefined) },
    oauth: {
      resource: 'https://api.oren.finance/mcp',
      appOrigin: 'https://oren.finance',
      issuer: 'https://api.oren.finance/oauth',
      provider: {
        AccessToken: {
          find: jest.fn().mockResolvedValue({
            isValid: true,
            aud: 'https://api.oren.finance/mcp',
            scopes: new Set(scopes),
            accountId: connection.userId,
            clientId: connection.clientId,
            grantId: connection.grantId,
          }),
        },
      },
    },
    gate: {},
    delegatedSides: { buy: true, sell: true },
    execution: { getQuote: jest.fn().mockResolvedValue(quote) },
    market: { getStock: jest.fn().mockResolvedValue({ price: 100 }) },
  } as unknown as McpResourceDeps;
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-token' },
    body: {},
  } as Request;
  const res = { setHeader: jest.fn() } as unknown as Response;
  await handleMcpRequest(req, res, deps);
  const server = (McpServer as jest.Mock).mock.results.at(-1)?.value as {
    registerTool: jest.Mock;
  };
  const registrations = server.registerTool.mock.calls as [
    string,
    unknown,
    unknown,
  ][];
  return {
    names: registrations.map(([name]) => name),
    values,
    set,
    review: registrations.find(
      ([name]) => name === 'review_trade',
    )?.[2] as (input: {
      intentId: string;
    }) => Promise<{ content: { text: string }[]; isError?: boolean }>,
    prepare: registrations.find(
      ([name]) => name === 'prepare_trade',
    )?.[2] as (input: {
      assetId: string;
      side: 'sell';
      amountShares: number;
      slippageBps: number;
    }) => Promise<{ content: { text: string }[]; isError?: boolean }>,
  };
}

describe('MCP trade tool exposure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives a chat-trading connection only the in-chat path, with no review link tools', async () => {
    const { names: tools } = await registeredTools([
      'oren.read',
      'oren.trade.prepare',
      'oren.trade.execute',
    ]);
    expect(tools).toEqual(
      expect.arrayContaining(['prepare_trade', 'execute_trade']),
    );
    expect(tools).not.toContain('review_trade');
    expect(tools).not.toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy']),
    );
  });

  describe('review_trade (connections without chat trading)', () => {
    const scopes = ['oren.read', 'oren.trade.prepare'];
    const intentId = '7b2c1c4e-2f0a-4f33-9d6e-1a2b3c4d5e6f';

    it('moves a prepared delegated intent to browser review and returns the link', async () => {
      const { review, set } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'delegated' },
        converted: true,
      });
      const result = await review({ intentId });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual({
        intentId,
        status: 'browser_approval_required',
        approvalUrl: `https://oren.finance/app/trades/review/${intentId}`,
      });
      expect(set).toHaveBeenCalledWith({ mode: 'browser', delegationId: null });
    });

    it('refuses when the delegated intent was claimed before it could move', async () => {
      const { review } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'delegated' },
        converted: false,
      });
      const result = await review({ intentId });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Intent expired or unavailable.');
    });

    it('returns the link for a browser intent without changing it', async () => {
      const { review, set } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'browser' },
      });
      const result = await review({ intentId });
      const body = JSON.parse(result.content[0].text) as {
        approvalUrl: string;
      };
      expect(body.approvalUrl).toBe(
        `https://oren.finance/app/trades/review/${intentId}`,
      );
      expect(set).not.toHaveBeenCalled();
    });

    it('refuses an expired, executed or foreign intent', async () => {
      const { review, set } = await registeredTools(scopes);
      const result = await review({ intentId });
      expect(result.isError).toBe(true);
      expect(set).not.toHaveBeenCalled();
    });
  });

  it('keeps browser-only buy aliases for a prepare connection', async () => {
    const { names: tools } = await registeredTools([
      'oren.read',
      'oren.trade.prepare',
    ]);
    expect(tools).toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy', 'prepare_trade']),
    );
    expect(tools).not.toContain('execute_trade');
  });

  it.each([true, false])(
    'persists and reports exact rounded sell shares (execute scope: %s)',
    async (execute) => {
      const requested = 0.123456789;
      const raw = uiAmountToRaw(requested, 8);
      expect(raw).toBe('12345679');
      const quote = {
        id: 'quote-test',
        assetId: 'stock',
        ticker: 'TEST',
        side: 'sell',
        variant: { mint: 'stock-mint', decimals: 8 },
        inputMint: 'stock-mint',
        outputMint: USDC_MINT,
        inputAmount: Number(raw) / 1e8,
        outputAmount: 12.3,
        provider: 'jupiter',
        slippageBps: 50,
        routePayload: {
          inAmount: raw,
          outAmount: '12300000',
          otherAmountThreshold: '12238500',
          swapMode: 'ExactIn',
        },
      } as Quote;
      const scopes = [
        'oren.read',
        'oren.trade.prepare',
        ...(execute ? ['oren.trade.execute'] : []),
      ];
      const tools = await registeredTools(scopes, quote);
      const result = await tools.prepare({
        assetId: 'stock',
        side: 'sell',
        amountShares: requested,
        slippageBps: 50,
      });
      const saved = (
        tools.values.mock.calls as [
          {
            amountShares: string;
            maxInRaw: string;
            referenceValueUsd: string;
            mode: string;
          },
        ][]
      )[0][0];
      expect(saved).toMatchObject({
        amountShares: '0.123456790000',
        maxInRaw: raw,
        referenceValueUsd: '12.345679',
        mode: execute ? 'delegated' : 'browser',
      });
      expect(
        rawSellReferenceUsd(saved.maxInRaw, saved.amountShares, 8, 100),
      ).toBe(saved.referenceValueUsd);
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        amountShares: 0.12345679,
        maxInRaw: raw,
      });
    },
  );
});

describe('prepare_trade for chat-trading connections', () => {
  const execute = ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'];
  const raw = uiAmountToRaw(0.5, 8);
  const quote = {
    id: 'quote-chat',
    assetId: 'stock',
    ticker: 'TEST',
    side: 'sell',
    variant: { mint: 'stock-mint', decimals: 8 },
    inputMint: 'stock-mint',
    outputMint: USDC_MINT,
    inputAmount: 0.5,
    outputAmount: 50,
    provider: 'jupiter',
    slippageBps: 50,
    routePayload: {
      inAmount: raw,
      outAmount: '50000000',
      otherAmountThreshold: '49750000',
      swapMode: 'ExactIn',
    },
  } as Quote;
  const sell = {
    assetId: 'stock',
    side: 'sell' as const,
    amountShares: 0.5,
    slippageBps: 50,
  };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['no active grant', null, 'chat_trading_inactive'],
    [
      'a grant activated after the connection',
      { activatedAt: new Date(Date.now() + 60_000) },
      'reconnect_required',
    ],
    ['a grant without sells', { allowSell: false }, 'sells_not_allowed'],
    [
      'slippage above the grant',
      { maxSlippageBps: 10 },
      'slippage_above_limit',
    ],
  ] as const)(
    'explains %s instead of preparing a linked browser trade',
    async (_case, delegation, code) => {
      const tools = await registeredTools(execute, quote, {
        delegation: delegation as Record<string, unknown> | null,
      });
      const result = await tools.prepare(sell);
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({ status: 'not_executable_in_chat', code });
      expect(body).not.toHaveProperty('approvalUrl');
      expect(tools.values).not.toHaveBeenCalled();
    },
  );

  it('tells the agent to execute in chat when the grant covers the trade', async () => {
    const tools = await registeredTools(execute, quote);
    const result = await tools.prepare(sell);
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body).toMatchObject({ mode: 'delegated' });
    expect(body.next).toMatch(/execute_trade/);
    expect(body).not.toHaveProperty('approvalUrl');
  });

  it('keeps the review link for connections without chat trading', async () => {
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare'],
      quote,
    );
    const body = JSON.parse(
      (await tools.prepare(sell)).content[0].text,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({ mode: 'browser' });
    expect(body.approvalUrl).toMatch(/\/app\/trades\/review\//);
  });
});
