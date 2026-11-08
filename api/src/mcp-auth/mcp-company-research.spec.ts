import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';
import { mcpConnections } from '../database/schema';

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

const resource = 'https://api.oren.finance/mcp';

async function toolsFor(scopes: string[], research?: { getStock: jest.Mock }) {
  const connection = {
    grantId: 'grant-1',
    clientId: 'client-1',
    userId: 'user-1',
    walletId: 'wallet-1',
    wallet: 'solana-wallet',
    scopes: scopes.join(' '),
    createdAt: new Date(),
  };
  const deps = {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: jest
              .fn()
              .mockResolvedValue(table === mcpConnections ? [connection] : []),
          }),
        }),
      }),
    },
    auth: { verifyMcpWallet: jest.fn().mockResolvedValue(undefined) },
    oauth: {
      resource,
      appOrigin: 'https://oren.finance',
      issuer: 'https://api.oren.finance/oauth',
      provider: {
        AccessToken: {
          find: jest.fn().mockResolvedValue({
            isValid: true,
            aud: resource,
            scopes: new Set(scopes),
            accountId: connection.userId,
            clientId: connection.clientId,
            grantId: connection.grantId,
          }),
        },
      },
    },
    market: { getStock: jest.fn(), searchStocks: jest.fn() },
    portfolio: { getPortfolio: jest.fn() },
    execution: { getQuote: jest.fn() },
    gate: { execute: jest.fn() },
    delegatedSides: { buy: true, sell: true },
    research,
  } as unknown as McpResourceDeps;
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-token' },
    body: {},
  } as Request;
  const res = {
    setHeader: jest.fn(),
    sendStatus: jest.fn(),
  } as unknown as Response;
  await handleMcpRequest(req, res, deps);
  const server = (McpServer as jest.Mock).mock.results.at(-1)?.value as {
    registerTool: jest.Mock;
  };
  const registrations = server.registerTool.mock.calls as [
    string,
    { annotations?: { readOnlyHint?: boolean } },
    (input: {
      assetId?: string;
      userId?: string;
      walletAddress?: string;
    }) => Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>,
  ][];
  return {
    names: registrations.map(([name]) => name),
    researchTool: registrations.find(([name]) => name === 'get_stock_research'),
  };
}

describe('MCP get_stock_research', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects an unauthenticated call before research runs', async () => {
    const research = { getStock: jest.fn() };
    const deps = {
      db: { select: jest.fn() },
      auth: { verifyMcpWallet: jest.fn() },
      oauth: {
        resource,
        appOrigin: 'https://oren.finance',
        issuer: 'https://api.oren.finance/oauth',
        provider: {
          AccessToken: { find: jest.fn().mockResolvedValue(undefined) },
        },
      },
      research,
    } as unknown as McpResourceDeps;
    const res = { setHeader: jest.fn(), sendStatus: jest.fn() };
    await handleMcpRequest(
      { method: 'POST', headers: {}, body: {} } as Request,
      res as unknown as Response,
      deps,
    );
    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(research.getStock).not.toHaveBeenCalled();
    expect(McpServer).not.toHaveBeenCalled();
  });

  it('binds the report to the connection and ignores a supplied user or wallet', async () => {
    const research = {
      getStock: jest
        .fn()
        .mockResolvedValue({ assetId: 'apple', company: { available: true } }),
    };
    const { names, researchTool } = await toolsFor(['oren.read'], research);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_portfolio',
        'search_stocks',
        'get_stock',
        'get_stock_research',
      ]),
    );
    expect(names).not.toContain('prepare_trade');
    expect(names).not.toContain('execute_trade');
    expect(researchTool?.[1].annotations).toMatchObject({ readOnlyHint: true });
    const result = await researchTool?.[2]({
      assetId: 'apple',
      userId: 'attacker',
      walletAddress: 'attacker-wallet',
    });
    expect(research.getStock).toHaveBeenCalledWith(
      'apple',
      { userId: 'user-1', walletAddress: 'solana-wallet' },
      { audience: 'mcp' },
    );
    expect(JSON.parse(result?.content[0].text ?? '{}')).toMatchObject({
      assetId: 'apple',
    });
  });

  it('rejects a blank or unsafe asset id and keeps existing trade tools', async () => {
    const research = { getStock: jest.fn() };
    const read = await toolsFor(['oren.read'], research);
    const invalid = await read.researchTool?.[2]({ assetId: 'apple inc' });
    expect(invalid?.isError).toBe(true);
    expect(research.getStock).not.toHaveBeenCalled();

    const prepare = await toolsFor(
      ['oren.read', 'oren.trade.prepare'],
      research,
    );
    expect(prepare.names).toEqual(
      expect.arrayContaining(['prepare_trade', 'prepare_buy', 'execute_buy']),
    );
    expect(prepare.names).not.toContain('execute_trade');

    const execute = await toolsFor(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      research,
    );
    expect(execute.names).toContain('execute_trade');
    expect(execute.names).not.toContain('prepare_buy');
    expect(execute.names).toContain('get_stock_research');
  });
});
