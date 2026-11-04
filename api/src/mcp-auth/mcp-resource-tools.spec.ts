import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';
import { mcpConnections } from '../database/schema';
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

async function registeredTools(scopes: string[], quote?: Quote) {
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
  const deps = {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: jest.fn().mockResolvedValue(
              table === mcpConnections
                ? [connection]
                : [
                    {
                      id: 'delegation-test',
                      activatedAt: new Date(Date.now() - 60_000),
                      maxSlippageBps: 50,
                      allowSell: true,
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

  it('offers the delegated path without browser-only buy aliases to an execute connection', async () => {
    const { names: tools } = await registeredTools([
      'oren.read',
      'oren.trade.prepare',
      'oren.trade.execute',
    ]);
    expect(tools).toEqual(
      expect.arrayContaining([
        'prepare_trade',
        'execute_trade',
        'review_trade',
      ]),
    );
    expect(tools).not.toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy']),
    );
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
