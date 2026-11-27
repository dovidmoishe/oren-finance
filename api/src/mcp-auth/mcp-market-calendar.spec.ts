import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';
import { mcpConnections } from '../database/schema';
import { MarketCalendarService } from '../market/calendar/market-calendar.service';
import { UsEquityCalendarService } from '../market/calendar/us-equity-calendar.service';

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

type Handler = (input: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

async function toolsFor(
  scopes: string[],
  marketCalendar?: McpResourceDeps['marketCalendar'],
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
    delegatedSides: { buy: true, sell: true },
    marketCalendar,
  } as unknown as McpResourceDeps;
  await handleMcpRequest(
    {
      method: 'POST',
      headers: { authorization: 'Bearer opaque-token' },
      body: {},
    } as Request,
    { setHeader: jest.fn(), sendStatus: jest.fn() } as unknown as Response,
    deps,
  );
  const server = (McpServer as jest.Mock).mock.results.at(-1)?.value as {
    registerTool: jest.Mock;
  };
  const registrations = server.registerTool.mock.calls as [
    string,
    { annotations?: { readOnlyHint?: boolean }; description?: string },
    Handler,
  ][];
  const find = (name: string) =>
    registrations.find(([registered]) => registered === name);
  return { names: registrations.map(([name]) => name), find };
}

function realCalendar() {
  return new MarketCalendarService(new UsEquityCalendarService(), {
    listRange: jest.fn().mockResolvedValue([]),
    syncState: jest.fn().mockResolvedValue(null),
  } as never);
}

describe('MCP market calendar tools', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers read-only hours and calendar tools under oren.read only', async () => {
    const read = await toolsFor(['oren.read'], realCalendar());
    expect(read.names).toEqual(
      expect.arrayContaining(['is_market_open', 'get_market_calendar']),
    );
    for (const name of ['is_market_open', 'get_market_calendar'])
      expect(read.find(name)?.[1].annotations).toMatchObject({
        readOnlyHint: true,
      });
    expect(read.find('is_market_open')?.[1].description).toMatch(
      /not a swap-availability check/,
    );

    const prepareOnly = await toolsFor(['oren.trade.prepare'], realCalendar());
    expect(prepareOnly.names).not.toContain('is_market_open');
    const withoutService = await toolsFor(['oren.read']);
    expect(withoutService.names).not.toContain('get_market_calendar');
  });

  it('returns the same payloads as the copilot', async () => {
    const calendar = realCalendar();
    const { find } = await toolsFor(['oren.read'], calendar);
    const open = await find('is_market_open')![2]({
      at: '2026-11-27T18:30:00Z',
      session: 'extended',
    });
    expect(JSON.parse(open.content[0].text)).toEqual(
      calendar.isMarketOpen({
        at: '2026-11-27T18:30:00Z',
        session: 'extended',
      }),
    );
    const week = await find('get_market_calendar')![2]({
      from: '2026-11-23',
      to: '2026-11-29',
    });
    const body = JSON.parse(week.content[0].text) as { days: unknown[] };
    expect(body.days).toHaveLength(7);
    expect(body).toMatchObject({
      eventsAvailable: false,
      attribution: { sources: [], notices: [] },
    });
    expect(week.content[0].text).not.toMatch(/tokens\.xyz|fred/i);
  });

  it('reports bad input and outages as tool errors without internals', async () => {
    const { find } = await toolsFor(['oren.read'], realCalendar());
    const bad = await find('is_market_open')![2]({ at: 'next tuesday' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/ISO 8601/);

    const broken = await toolsFor(['oren.read'], {
      isMarketOpen: () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
      },
      getMarketCalendar: jest.fn(),
    });
    const outage = await broken.find('is_market_open')![2]({});
    expect(outage).toEqual({
      content: [{ type: 'text', text: 'The market calendar is unavailable.' }],
      isError: true,
    });
  });
});
