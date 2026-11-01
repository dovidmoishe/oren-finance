import type { Request, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import {
  mcpConnections,
  mcpTradeIntents,
  tradeApprovals,
} from '../database/schema';
import type { Database } from '../database/database.provider';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { MarketService } from '../market/market.service';
import type { PortfolioService } from '../portfolio/portfolio.service';
import type { ExecutionService } from '../execution/execution.service';
import {
  enforcedMinimumOut,
  rawIn,
  reviewedTermsFor,
} from '../execution/swap-terms';
import type { McpOAuthRuntime } from './oauth-runtime';

export interface McpResourceDeps {
  db: Database;
  auth: PrivyWalletAuth;
  market: MarketService;
  portfolio: PortfolioService;
  execution: ExecutionService;
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
    ![...token.scopes].some((scope) =>
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'].includes(scope),
    ) ||
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
  if (connection.createdAt.getTime() <= Date.now() - 7 * 24 * 60 * 60_000)
    return undefined;
  const granted = new Set(connection.scopes.split(/\s+/));
  if (
    [...token.scopes].some(
      (scope) => scope.startsWith('oren.') && !granted.has(scope),
    )
  )
    return undefined;
  await deps.auth.verifyMcpWallet(
    connection.userId,
    connection.walletId,
    connection.wallet,
  );
  return { ...connection, tokenScopes: token.scopes };
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
  if (connection.tokenScopes.has('oren.read'))
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
  if (connection.tokenScopes.has('oren.read'))
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
  if (connection.tokenScopes.has('oren.read'))
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
  if (connection.tokenScopes.has('oren.trade.prepare')) {
    server.registerTool(
      'prepare_trade',
      {
        title: 'Prepare stock trade',
        description:
          'Prepare a USDC stock buy or stock sell for review and signature in Oren.',
        inputSchema: z.object({
          assetId: z.string().trim().min(1).max(80),
          side: z.enum(['buy', 'sell']),
          amountUsd: z.number().finite().min(0.01).max(100000).optional(),
          amountShares: z
            .number()
            .finite()
            .positive()
            .max(1_000_000_000)
            .optional(),
          slippageBps: z.number().int().min(1).max(50).default(50),
        }),
        annotations: { destructiveHint: false },
      },
      async ({ assetId, side, amountUsd, amountShares, slippageBps }) => {
        if (
          (side === 'buy' &&
            (amountUsd === undefined || amountShares !== undefined)) ||
          (side === 'sell' &&
            (amountShares === undefined || amountUsd !== undefined))
        )
          return {
            content: [
              {
                type: 'text',
                text: 'Use amountUsd for buys or amountShares for sells.',
              },
            ],
            isError: true,
          };
        const quote = await deps.execution.getQuote({
          assetId,
          ticker: '',
          side,
          amountUsd,
          amount: amountShares,
          slippageBps,
          wallet: connection.wallet,
        });
        const maxIn = rawIn(quote);
        const minOut = enforcedMinimumOut(quote);
        const reviewed = reviewedTermsFor(quote);
        if (!maxIn || minOut === undefined || !reviewed)
          return {
            content: [
              {
                type: 'text',
                text: 'The route has no verifiable trade amounts.',
              },
            ],
            isError: true,
          };
        const stock =
          side === 'sell'
            ? await deps.market.getStock(quote.assetId)
            : undefined;
        const referenceValueUsd =
          side === 'sell' &&
          stock?.price &&
          Number.isFinite(stock.price) &&
          stock.price > 0 &&
          Number.isFinite(amountShares! * stock.price)
            ? (
                Math.ceil(amountShares! * stock.price * 1_000_000) / 1_000_000
              ).toFixed(6)
            : null;
        const quotedProceedsUsd =
          side === 'sell' &&
          Number.isFinite(quote.outputAmount) &&
          quote.outputAmount > 0
            ? (Math.ceil(quote.outputAmount * 1_000_000) / 1_000_000).toFixed(6)
            : null;
        const [intent] = await deps.db
          .insert(mcpTradeIntents)
          .values({
            grantId: connection.grantId,
            clientId: connection.clientId,
            userId: connection.userId,
            wallet: connection.wallet,
            assetId: quote.assetId,
            ticker: quote.ticker,
            side,
            stockMint: quote.variant.mint,
            amountUsd: side === 'buy' ? amountUsd!.toFixed(6) : null,
            amountShares: side === 'sell' ? amountShares!.toFixed(12) : null,
            maxInRaw: maxIn,
            minOutRaw: minOut.toString(),
            referenceValueUsd,
            quotedProceedsUsd,
            reviewedTerms: { ...reviewed },
            slippageBps,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          })
          .returning({
            id: mcpTradeIntents.id,
            expiresAt: mcpTradeIntents.expiresAt,
          });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                intentId: intent.id,
                side,
                ticker: quote.ticker,
                stockMint: quote.variant.mint,
                amountUsd,
                amountShares,
                minOutRaw: minOut.toString(),
                referenceValueUsd,
                quotedProceedsUsd,
                maxInRaw: maxIn,
                slippageBps,
                expiresAt: intent.expiresAt.toISOString(),
                mode: 'browser',
                approvalUrl: `${deps.oauth.appOrigin}/app/trades/review/${intent.id}`,
              }),
            },
          ],
        };
      },
    );
    server.registerTool(
      'prepare_buy',
      {
        title: 'Prepare buy request',
        description:
          'Save a USDC stock buy request for browser review. This does not sign or submit a trade.',
        inputSchema: z.object({
          assetId: z.string().trim().min(1).max(80),
          amountUsd: z.number().finite().min(0.01).max(100000),
          slippageBps: z.number().int().min(1).max(50).default(50),
        }),
      },
      async ({ assetId, amountUsd, slippageBps }) => {
        const stock = await deps.market.getStock(assetId);
        if (!stock.variants.some((variant) => variant.tradable))
          return {
            content: [
              { type: 'text', text: 'No tradable stock variant is available.' },
            ],
            isError: true,
          };
        const [intent] = await deps.db
          .insert(mcpTradeIntents)
          .values({
            grantId: connection.grantId,
            clientId: connection.clientId,
            userId: connection.userId,
            wallet: connection.wallet,
            assetId: stock.id,
            ticker: stock.ticker,
            amountUsd: amountUsd.toFixed(6),
            slippageBps,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          })
          .returning({
            id: mcpTradeIntents.id,
            expiresAt: mcpTradeIntents.expiresAt,
          });
        const result = {
          intentId: intent.id,
          ticker: stock.ticker,
          amountUsd,
          slippageBps,
          expiresAt: intent.expiresAt.toISOString(),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
    const openTradeReview = async ({ intentId }: { intentId: string }) => {
      const [intent] = await deps.db
        .select({ id: mcpTradeIntents.id })
        .from(mcpTradeIntents)
        .where(
          and(
            eq(mcpTradeIntents.id, intentId),
            eq(mcpTradeIntents.grantId, connection.grantId),
            eq(mcpTradeIntents.clientId, connection.clientId),
            eq(mcpTradeIntents.userId, connection.userId),
            eq(mcpTradeIntents.wallet, connection.wallet),
            gt(mcpTradeIntents.expiresAt, new Date()),
            eq(mcpTradeIntents.mode, 'browser'),
            eq(mcpTradeIntents.status, 'prepared'),
          ),
        )
        .limit(1);
      if (!intent)
        return {
          content: [
            { type: 'text' as const, text: 'Intent expired or unavailable.' },
          ],
          isError: true,
        };
      const result = {
        intentId,
        status: 'browser_approval_required',
        approvalUrl: `${deps.oauth.appOrigin}/app/trades/review/${intentId}`,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    };
    server.registerTool(
      'review_trade',
      {
        title: 'Open trade review',
        description:
          'Get the Oren browser review link for a prepared buy or sell intent. The user signs there.',
        inputSchema: z.object({ intentId: z.uuid() }),
      },
      openTradeReview,
    );
    server.registerTool(
      'execute_buy',
      {
        title: 'Open trade review',
        description:
          'Get the Oren browser review link for a prepared buy or sell intent. The user signs there.',
        inputSchema: z.object({ intentId: z.uuid() }),
      },
      openTradeReview,
    );
    server.registerTool(
      'trade_status',
      {
        title: 'Get trade request status',
        description:
          'Read the status of an Oren buy or sell intent and its browser approval, if one exists.',
        inputSchema: z.object({ intentId: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      async ({ intentId }) => {
        const [intent] = await deps.db
          .select({
            id: mcpTradeIntents.id,
            approvalId: mcpTradeIntents.approvalId,
            mode: mcpTradeIntents.mode,
            status: mcpTradeIntents.status,
            expiresAt: mcpTradeIntents.expiresAt,
          })
          .from(mcpTradeIntents)
          .where(
            and(
              eq(mcpTradeIntents.id, intentId),
              eq(mcpTradeIntents.grantId, connection.grantId),
              eq(mcpTradeIntents.clientId, connection.clientId),
              eq(mcpTradeIntents.userId, connection.userId),
              eq(mcpTradeIntents.wallet, connection.wallet),
            ),
          )
          .limit(1);
        if (!intent)
          return {
            content: [{ type: 'text', text: 'Intent unavailable.' }],
            isError: true,
          };
        let status =
          intent.status === 'prepared' && intent.expiresAt <= new Date()
            ? 'expired'
            : intent.mode === 'delegated' || intent.status !== 'prepared'
              ? intent.status
              : 'browser_approval_required';
        let signature: string | undefined;
        if (intent.approvalId) {
          const [approval] = await deps.db
            .select({
              status: tradeApprovals.status,
              signature: tradeApprovals.signature,
              expiresAt: tradeApprovals.expiresAt,
            })
            .from(tradeApprovals)
            .where(
              and(
                eq(tradeApprovals.id, intent.approvalId),
                eq(tradeApprovals.userId, connection.userId),
                eq(tradeApprovals.wallet, connection.wallet),
              ),
            )
            .limit(1);
          if (approval) {
            status =
              approval.status === 'prepared' && approval.expiresAt <= new Date()
                ? 'expired'
                : approval.status;
            signature = approval.signature ?? undefined;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                intentId,
                status,
                signature,
                observedAt: new Date().toISOString(),
              }),
            },
          ],
        };
      },
    );
  }
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
