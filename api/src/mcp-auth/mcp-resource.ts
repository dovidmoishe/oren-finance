import type { Request, Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { mcpConnections } from '../database/schema';
import type { Database } from '../database/database.provider';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { MarketService } from '../market/market.service';
import type { PortfolioService } from '../portfolio/portfolio.service';
import type { McpOAuthRuntime } from './oauth-runtime';

export interface McpResourceDeps {
  db: Database;
  auth: PrivyWalletAuth;
  market: MarketService;
  portfolio: PortfolioService;
  oauth: McpOAuthRuntime;
}

/** Opaque OAuth access tokens are checked against current grant and wallet state. */
export async function requireMcpAccess(req: Request, deps: McpResourceDeps) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return undefined;
  const token = await deps.oauth.provider.AccessToken.find(match[1]);
  if (
    !token?.isValid ||
    token.aud !== deps.oauth.resource ||
    !token.scopes.has('oren.read') ||
    !token.accountId ||
    !token.clientId ||
    !token.grantId
  )
    return undefined;
  const [connection] = await deps.db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.grantId, token.grantId),
        eq(mcpConnections.clientId, token.clientId),
        eq(mcpConnections.userId, token.accountId),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .limit(1);
  if (!connection) return undefined;
  await deps.auth.verifyMcpWallet(
    connection.userId,
    connection.walletId,
    connection.wallet,
  );
  return connection;
}

export async function handleMcpRequest(
  req: Request,
  res: Response,
  deps: McpResourceDeps,
) {
  if (req.method !== 'POST') return res.sendStatus(405);
  if (req.headers.origin && req.headers.origin !== deps.oauth.appOrigin)
    return res.sendStatus(403);
  let connection: Awaited<ReturnType<typeof requireMcpAccess>>;
  try {
    connection = await requireMcpAccess(req, deps);
  } catch {
    return res.sendStatus(503);
  }
  if (!connection) {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${deps.oauth.issuer.replace(/\/oauth$/, '')}/.well-known/oauth-protected-resource/mcp"`,
    );
    return res.sendStatus(401);
  }
  res.setHeader('Cache-Control', 'no-store');
  const server = new McpServer({ name: 'oren', version: '0.1.0' });
  server.registerTool(
    'get_portfolio',
    {
      title: 'Get portfolio',
      description:
        'Read the Oren portfolio for the wallet approved during connection.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await deps.portfolio.getPortfolio(connection.wallet);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
  server.registerTool(
    'search_stocks',
    {
      title: 'Search stocks',
      description: 'Search tokenized stocks by ticker or company name.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(80) }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const result = await deps.market.searchStocks(query);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
  server.registerTool(
    'get_stock',
    {
      title: 'Get stock',
      description: 'Get canonical stock detail by asset id.',
      inputSchema: z.object({ assetId: z.string().trim().min(1).max(80) }),
      annotations: { readOnlyHint: true },
    },
    async ({ assetId }) => {
      const result = await deps.market.getStock(assetId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
}
