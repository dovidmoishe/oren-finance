import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';

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

async function registeredTools(scopes: string[]) {
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
        from: () => ({
          where: () => ({ limit: jest.fn().mockResolvedValue([connection]) }),
        }),
      }),
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
  return server.registerTool.mock.calls.map(([name]) => name as string);
}

describe('MCP trade tool exposure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers the delegated path without browser-only buy aliases to an execute connection', async () => {
    const tools = await registeredTools([
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
    const tools = await registeredTools(['oren.read', 'oren.trade.prepare']);
    expect(tools).toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy', 'prepare_trade']),
    );
    expect(tools).not.toContain('execute_trade');
  });
});
