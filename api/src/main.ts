import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express, Request, Response, NextFunction } from 'express';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppModule } from './app.module';
import { PrivyWalletAuth } from './auth/privy-wallet-auth';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validateEnv } from './config/env.schema';
import { DatabaseService } from './database/database.provider';
import {
  mcpConnections,
  mcpBudgetReservations,
  mcpTradeDelegations,
  mcpTradeIntents,
  tradeApprovals,
  mcpApiTradeGrants,
  mcpApiTradeAuthorizations,
} from './database/schema';
import { MarketService } from './market/market.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { ExecutionService } from './execution/execution.service';
import { handleMcpRequest } from './mcp-auth/mcp-resource';
import { mcpConsentScopes } from './mcp-auth/consent-scopes';
import { requireMcpOfflineConsent } from './mcp-auth/offline-consent';
import { SignerGateClient } from './mcp-auth/signer-gate.client';
import { delegatedUserAllowed } from './mcp-auth/delegated-access';
import { SignerGateRejection } from './mcp-auth/signer-gate.errors';
import {
  mcpRegistrationBody,
  registerMcpJsonBodyParser,
} from './mcp-auth/mcp-json-body';
import {
  clientMayPrepareTrades,
  clientMayExecuteTrades,
  createMcpOAuthRuntime,
  mountPathBasedDiscoveryAtIssuer,
} from './mcp-auth/oauth-runtime';
import { createRegistrationRateLimit } from './mcp-auth/registration-rate-limit';
import { approvalMatchesMcpIntent } from './mcp-auth/intent-approval';
import { ApiTradeAuthorization } from './mcp-auth/api-trade-authorization';
import { Connection } from '@solana/web3.js';
import { TokensService } from './tokens/tokens.service';
import { ApprovalRpc } from './execution/approval-rpc.service';
import { ownerProofSchema } from './mcp-auth/grant-owner-proof';
import {
  describeMcpConsentClient,
  nativeMcpConsentGranted,
} from './mcp-auth/client-consent';

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  const oauth = await createMcpOAuthRuntime(app.get(DatabaseService).db);
  if (oauth) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    const db = app.get(DatabaseService).db;
    const identity = app.get(PrivyWalletAuth, { strict: false });
    const delegatedAccess = {
      publicAccess: env.MCP_DELEGATED_TRADES_PUBLIC,
      allowedUsers: new Set(env.MCP_DELEGATED_TRADES_ALLOWED_USERS),
    };
    const apiTradeAuthorization = new ApiTradeAuthorization({
      db,
      auth: identity,
      appId: env.PRIVY_APP_ID ?? '',
      ...delegatedAccess,
      buysEnabled: env.MCP_DELEGATED_BUYS_ENABLED,
      sellsEnabled: env.MCP_DELEGATED_SELLS_ENABLED,
      signerQuorumId: env.PRIVY_MCP_SIGNER_QUORUM_ID ?? '',
      tokens: app.get(TokensService, { strict: false }),
      rpc: app.get(ApprovalRpc, { strict: false }),
      connection: new Connection(
        `https://solana-${env.SOLANA_NETWORK}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,
        'confirmed',
      ),
    });
    const grantGate =
      env.SIGNER_GATE_URL && env.SIGNER_GATE_API_TOKEN
        ? new SignerGateClient(
            env.SIGNER_GATE_URL,
            env.SIGNER_GATE_API_TOKEN,
            env.PRIVY_MCP_SIGNER_PRIVATE_KEY ?? '',
            apiTradeAuthorization,
          )
        : undefined;
    const mcpDeps = {
      db,
      auth: identity,
      market: app.get(MarketService, { strict: false }),
      portfolio: app.get(PortfolioService, { strict: false }),
      execution: app.get(ExecutionService, { strict: false }),
      gate: env.MCP_DELEGATED_TRADES_ENABLED ? grantGate : undefined,
      delegatedSides: {
        buy: env.MCP_DELEGATED_BUYS_ENABLED,
        sell: env.MCP_DELEGATED_SELLS_ENABLED,
      },
      oauth,
    };
    registerMcpJsonBodyParser(expressApp);
    expressApp.get(
      '/.well-known/oauth-protected-resource/mcp',
      (_req: Request, res: Response) =>
        res.json({
          resource: oauth.resource,
          authorization_servers: [oauth.issuer],
          scopes_supported: [
            'oren.read',
            'oren.trade.prepare',
            ...(env.MCP_DELEGATED_TRADES_ENABLED ? ['oren.trade.execute'] : []),
          ],
        }),
    );
    // Path-based issuer discovery for clients following RFC 8414.
    expressApp.use(
      '/.well-known/oauth-authorization-server/oauth',
      (req: Request, res: Response) => {
        mountPathBasedDiscoveryAtIssuer(req);
        void oauth.provider
          .callback()(req, res)
          .catch(() => {
            if (!res.headersSent) res.sendStatus(500);
          });
      },
    );
    expressApp.post('/mcp', (req: Request, res: Response) => {
      void handleMcpRequest(req, res, mcpDeps).catch(() => {
        if (!res.headersSent) res.sendStatus(500);
      });
    });
    expressApp.get('/mcp', (_req: Request, res: Response) =>
      res.sendStatus(405),
    );
    expressApp.use(
      '/mcp/delegation',
      (req: Request, res: Response, next: NextFunction) => {
        if (req.headers.origin && req.headers.origin !== oauth.appOrigin)
          return res.sendStatus(403);
        if (req.headers.origin === oauth.appOrigin) {
          res.setHeader('Access-Control-Allow-Origin', oauth.appOrigin);
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type',
          );
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
      },
    );
    expressApp.get('/mcp/delegation', async (req: Request, res: Response) => {
      try {
        const owner = await identity.requireMcpIdentity(
          req.headers.authorization,
        );
        res.setHeader('Cache-Control', 'no-store');
        const [delegation] = await db
          .select()
          .from(mcpTradeDelegations)
          .where(
            and(
              eq(mcpTradeDelegations.userId, owner.userId),
              eq(mcpTradeDelegations.walletId, owner.walletId),
              eq(mcpTradeDelegations.wallet, owner.wallet),
              inArray(mcpTradeDelegations.status, ['pending_signer', 'active']),
            ),
          )
          .limit(1);
        if (!delegation)
          return res.json({
            enabled: false,
            canEnroll:
              env.MCP_DELEGATED_TRADES_ENABLED &&
              env.MCP_DELEGATED_BUYS_ENABLED &&
              delegatedUserAllowed(delegatedAccess, owner.userId),
            sellAvailable: env.MCP_DELEGATED_SELLS_ENABLED,
          });
        const [independent] = await db
          .select()
          .from(mcpApiTradeGrants)
          .where(
            and(
              eq(mcpApiTradeGrants.id, delegation.id),
              eq(mcpApiTradeGrants.userId, owner.userId),
              eq(mcpApiTradeGrants.walletId, owner.walletId),
              eq(mcpApiTradeGrants.wallet, owner.wallet),
            ),
          );
        if (
          !independent ||
          (env.PRIVY_MCP_SIGNER_POLICY_ID &&
            delegation.policyId !== env.PRIVY_MCP_SIGNER_POLICY_ID) ||
          independent.expiresAt <= new Date() ||
          independent.status === 'revoked' ||
          (delegation.status === 'active' && independent.status !== 'active')
        )
          return res.json({
            enabled: false,
            reenrollmentRequired: true,
            delegationId: delegation.id,
            wallet: owner.wallet,
          });
        if (delegation.status === 'pending_signer')
          return res.json({
            enabled: false,
            canEnroll:
              env.MCP_DELEGATED_TRADES_ENABLED &&
              env.MCP_DELEGATED_BUYS_ENABLED,
            sellAvailable: env.MCP_DELEGATED_SELLS_ENABLED,
            pendingGrant: {
              delegationId: delegation.id,
              wallet: delegation.wallet,
              signerId: independent.signerId,
              policyId: independent.policyId,
              perTradeUsd: independent.perTradeLimitUsd,
              dailyUsd: independent.dailyLimitUsd,
              maxSlippageBps: independent.maxSlippageBps,
              allowSell: independent.allowSell,
              expiresAt: independent.expiresAt.toISOString(),
            },
          });
        const [usage] = await db
          .select({
            total: sql<string>`COALESCE(SUM(${mcpBudgetReservations.amountUsd}), 0)`,
          })
          .from(mcpBudgetReservations)
          .where(
            and(
              eq(mcpBudgetReservations.delegationId, delegation.id),
              or(
                eq(mcpBudgetReservations.status, 'reserved'),
                and(
                  eq(mcpBudgetReservations.status, 'consumed'),
                  gt(
                    mcpBudgetReservations.createdAt,
                    new Date(Date.now() - 24 * 60 * 60_000),
                  ),
                ),
              ),
            ),
          );
        const [apiUsage] = await db
          .select({
            total: sql<string>`COALESCE(SUM(${mcpApiTradeAuthorizations.amountUsd}), 0)`,
          })
          .from(mcpApiTradeAuthorizations)
          .where(eq(mcpApiTradeAuthorizations.delegationId, independent.id));
        return res.json({
          enabled: true,
          sellAvailable: env.MCP_DELEGATED_SELLS_ENABLED,
          delegationId: delegation.id,
          wallet: delegation.wallet,
          perTradeUsd: independent.perTradeLimitUsd,
          dailyUsd: independent.dailyLimitUsd,
          usedTodayUsd:
            Number(apiUsage.total) > Number(usage.total)
              ? apiUsage.total
              : usage.total,
          maxSlippageBps: independent.maxSlippageBps,
          sides: independent.allowSell ? ['buy', 'sell'] : ['buy'],
          expiresAt: independent.expiresAt.toISOString(),
        });
      } catch {
        return res.sendStatus(401);
      }
    });
    const browserToken = (req: Request) =>
      /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const grantSettingsSchema = z
      .object({
        allowSell: z.boolean(),
        perTradeUsd: z.number().finite().min(0.01).max(25),
        dailyUsd: z.number().finite().min(0.01).max(50),
        maxSlippageBps: z.number().int().min(1).max(50),
        durationHours: z.number().int().min(1).max(24),
      })
      .refine((value) => value.dailyUsd >= value.perTradeUsd);
    expressApp.post(
      '/mcp/delegation/authorization',
      async (req: Request, res: Response) => {
        const token = browserToken(req);
        if (!token) return res.sendStatus(401);
        const parsed = z
          .discriminatedUnion('action', [
            z.object({
              action: z.literal('prepare'),
              settings: grantSettingsSchema,
              signerId: z.string().min(1).max(256),
              policyId: z.string().min(1).max(256),
            }),
            z.object({ action: z.literal('activate'), delegationId: z.uuid() }),
            z.object({ action: z.literal('revoke'), delegationId: z.uuid() }),
          ])
          .safeParse(req.body);
        if (!parsed.success) return res.sendStatus(400);
        try {
          return res.json(
            await apiTradeAuthorization.ownerChallenge(
              token,
              parsed.data.action,
              parsed.data,
            ),
          );
        } catch {
          return res.status(409).json({ error: 'permission_unavailable' });
        }
      },
    );
    expressApp.post(
      '/mcp/delegation/prepare',
      async (req: Request, res: Response) => {
        if (!mcpDeps.gate) return res.sendStatus(503);
        const token = browserToken(req);
        if (!token) return res.sendStatus(401);
        const parsed = z
          .object({
            settings: grantSettingsSchema,
            authorization: ownerProofSchema,
          })
          .safeParse(req.body);
        if (!parsed.success) return res.sendStatus(400);
        try {
          const { settings, authorization } = parsed.data;
          await apiTradeAuthorization.verifyPreparation(
            token,
            authorization,
            settings,
          );
          const prepared = await mcpDeps.gate.prepareGrant(
            authorization,
            settings,
          );
          await apiTradeAuthorization.recordPending(
            token,
            authorization,
            settings,
            prepared,
          );
          return res.json(prepared);
        } catch (error) {
          const code =
            error instanceof SignerGateRejection &&
            /^[a-z_]{1,40}$/.test(error.code)
              ? error.code
              : 'gate_unreachable';
          console.error('MCP grant preparation rejected', code);
          return res.status(409).json({ error: code });
        }
      },
    );
    expressApp.post(
      '/mcp/delegation/activate',
      async (req: Request, res: Response) => {
        if (!mcpDeps.gate) return res.sendStatus(503);
        const token = browserToken(req);
        const parsed = z
          .object({ delegationId: z.uuid(), authorization: ownerProofSchema })
          .safeParse(req.body);
        if (!token) return res.sendStatus(401);
        if (!parsed.success) return res.sendStatus(400);
        try {
          return res.json(
            await apiTradeAuthorization.activate(
              token,
              parsed.data.authorization,
              parsed.data.delegationId,
              () =>
                mcpDeps.gate!.activateGrant(
                  parsed.data.authorization,
                  parsed.data.delegationId,
                ),
            ),
          );
        } catch {
          return res.sendStatus(409);
        }
      },
    );
    expressApp.post(
      '/mcp/delegation/revoke',
      async (req: Request, res: Response) => {
        if (!grantGate) return res.sendStatus(503);
        const token = browserToken(req);
        const parsed = z
          .object({ delegationId: z.uuid(), authorization: ownerProofSchema })
          .safeParse(req.body);
        if (!token) return res.sendStatus(401);
        if (!parsed.success) return res.sendStatus(400);
        try {
          await apiTradeAuthorization.revoke(
            token,
            parsed.data.authorization,
            parsed.data.delegationId,
          );
          return res.json(
            await grantGate.revokeGrant(
              parsed.data.authorization,
              parsed.data.delegationId,
            ),
          );
        } catch {
          return res.sendStatus(409);
        }
      },
    );
    expressApp.use(
      '/mcp/intents',
      (req: Request, res: Response, next: NextFunction) => {
        if (req.headers.origin && req.headers.origin !== oauth.appOrigin)
          return res.sendStatus(403);
        if (req.headers.origin === oauth.appOrigin) {
          res.setHeader('Access-Control-Allow-Origin', oauth.appOrigin);
          res.setHeader('Access-Control-Allow-Headers', 'Authorization');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
      },
    );
    expressApp.get('/mcp/intents/:id', async (req: Request, res: Response) => {
      const id = req.params.id;
      if (
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        return res.sendStatus(404);
      try {
        const owner = await identity.requireMcpIdentity(
          req.headers.authorization,
        );
        const [intent] = await db
          .select({
            id: mcpTradeIntents.id,
            assetId: mcpTradeIntents.assetId,
            ticker: mcpTradeIntents.ticker,
            amountUsd: mcpTradeIntents.amountUsd,
            amountShares: mcpTradeIntents.amountShares,
            side: mcpTradeIntents.side,
            stockMint: mcpTradeIntents.stockMint,
            slippageBps: mcpTradeIntents.slippageBps,
            wallet: mcpTradeIntents.wallet,
            expiresAt: mcpTradeIntents.expiresAt,
            grantId: mcpTradeIntents.grantId,
          })
          .from(mcpTradeIntents)
          .where(
            and(
              eq(mcpTradeIntents.id, id),
              eq(mcpTradeIntents.userId, owner.userId),
              eq(mcpTradeIntents.wallet, owner.wallet),
              gt(mcpTradeIntents.expiresAt, new Date()),
              eq(mcpTradeIntents.mode, 'browser'),
              eq(mcpTradeIntents.status, 'prepared'),
            ),
          )
          .limit(1);
        if (!intent) return res.sendStatus(404);
        const [connection] = await db
          .select({ grantId: mcpConnections.grantId })
          .from(mcpConnections)
          .where(
            and(
              eq(mcpConnections.grantId, intent.grantId),
              eq(mcpConnections.userId, owner.userId),
              eq(mcpConnections.wallet, owner.wallet),
              isNull(mcpConnections.revokedAt),
            ),
          )
          .limit(1);
        if (!connection) return res.sendStatus(404);
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          id: intent.id,
          assetId: intent.assetId,
          ticker: intent.ticker,
          amountUsd:
            intent.amountUsd == null ? undefined : Number(intent.amountUsd),
          amountShares:
            intent.amountShares == null
              ? undefined
              : Number(intent.amountShares),
          side: intent.side,
          stockMint: intent.stockMint,
          slippageBps: intent.slippageBps,
          wallet: intent.wallet,
          expiresAt: intent.expiresAt,
        });
      } catch {
        return res.sendStatus(401);
      }
    });
    expressApp.post(
      '/mcp/intents/:id/approval/:approvalId',
      async (req: Request, res: Response) => {
        if (req.headers.origin !== oauth.appOrigin) return res.sendStatus(403);
        const id = req.params.id;
        const approvalId = req.params.approvalId;
        if (typeof id !== 'string' || typeof approvalId !== 'string')
          return res.sendStatus(400);
        try {
          const owner = await identity.requireMcpIdentity(
            req.headers.authorization,
          );
          const [intent] = await db
            .select()
            .from(mcpTradeIntents)
            .where(
              and(
                eq(mcpTradeIntents.id, id),
                eq(mcpTradeIntents.userId, owner.userId),
                eq(mcpTradeIntents.wallet, owner.wallet),
                gt(mcpTradeIntents.expiresAt, new Date()),
                eq(mcpTradeIntents.mode, 'browser'),
                eq(mcpTradeIntents.status, 'prepared'),
              ),
            )
            .limit(1);
          if (!intent) return res.sendStatus(404);
          const [activeConnection] = await db
            .select({ grantId: mcpConnections.grantId })
            .from(mcpConnections)
            .where(
              and(
                eq(mcpConnections.grantId, intent.grantId),
                eq(mcpConnections.clientId, intent.clientId),
                eq(mcpConnections.userId, owner.userId),
                eq(mcpConnections.wallet, owner.wallet),
                isNull(mcpConnections.revokedAt),
              ),
            )
            .limit(1);
          if (!activeConnection) return res.sendStatus(404);
          const [approval] = await db
            .select()
            .from(tradeApprovals)
            .where(
              and(
                eq(tradeApprovals.id, approvalId),
                eq(tradeApprovals.userId, owner.userId),
                eq(tradeApprovals.wallet, owner.wallet),
                eq(tradeApprovals.walletId, owner.walletId),
                eq(tradeApprovals.kind, 'swap'),
              ),
            )
            .limit(1);
          const quote = approval?.details.quote as
            Record<string, unknown> | undefined;
          if (
            !approval ||
            approval.status !== 'prepared' ||
            approval.expiresAt <= new Date() ||
            !approvalMatchesMcpIntent(
              intent,
              quote,
              approval.details.expectation as
                Record<string, unknown> | undefined,
              approval.referenceId,
            )
          )
            return res.sendStatus(403);
          const [updated] = await db
            .update(mcpTradeIntents)
            .set({ approvalId, status: 'executing' })
            .where(
              and(
                eq(mcpTradeIntents.id, intent.id),
                isNull(mcpTradeIntents.approvalId),
                eq(mcpTradeIntents.mode, 'browser'),
                eq(mcpTradeIntents.status, 'prepared'),
              ),
            )
            .returning({ id: mcpTradeIntents.id });
          if (!updated) {
            const [existing] = await db
              .select({ approvalId: mcpTradeIntents.approvalId })
              .from(mcpTradeIntents)
              .where(eq(mcpTradeIntents.id, intent.id))
              .limit(1);
            if (existing?.approvalId !== approvalId) return res.sendStatus(409);
          }
          return res.sendStatus(204);
        } catch {
          return res.sendStatus(400);
        }
      },
    );
    const interaction = '/oauth/interaction/:uid';
    expressApp.use(
      '/oauth/interaction',
      (req: Request, res: Response, next: NextFunction) => {
        if (req.headers.origin !== oauth.appOrigin) {
          if (req.headers.origin) return res.sendStatus(403);
        } else {
          res.setHeader('Access-Control-Allow-Origin', oauth.appOrigin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type, X-Oren-Trade-Execute-Consent, X-Oren-Delegation-Id, X-Oren-Native-Client-Consent',
          );
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
      },
    );
    expressApp.get(interaction, async (req: Request, res: Response) => {
      try {
        const details = await oauth.provider.interactionDetails(req, res);
        if (details.uid !== req.params.uid) return res.sendStatus(403);
        res.setHeader('Cache-Control', 'no-store');
        if (req.query.launch === '1') {
          return res.redirect(
            303,
            `${oauth.appOrigin}/connect/mcp?uid=${encodeURIComponent(details.uid)}`,
          );
        }
        const client = await oauth.provider.Client.find(
          String(details.params.client_id),
        );
        const consentClient =
          client &&
          describeMcpConsentClient(client, details.params.redirect_uri);
        if (!consentClient) return res.sendStatus(403);
        return res.json({
          clientId: details.params.client_id,
          scope: details.params.scope,
          resource: oauth.resource,
          ...consentClient,
        });
      } catch {
        return res.sendStatus(400);
      }
    });
    expressApp.post(interaction, async (req: Request, res: Response) => {
      if (req.headers.origin !== oauth.appOrigin) return res.sendStatus(403);
      try {
        const details = await oauth.provider.interactionDetails(req, res);
        if (details.uid !== req.params.uid) return res.sendStatus(403);
        if (typeof details.params.scope !== 'string')
          return res.sendStatus(403);
        const scopes = mcpConsentScopes(
          details.params.scope,
          env.MCP_DELEGATED_TRADES_ENABLED,
        );
        if (!scopes) return res.sendStatus(403);
        const { requested, resourceScopes, oidcScopes } = scopes;
        const clientId = String(details.params.client_id);
        const client = await oauth.provider.Client.find(clientId);
        if (
          !client ||
          (requested.includes('oren.trade.prepare') &&
            !clientMayPrepareTrades(client.redirectUris)) ||
          (requested.includes('oren.trade.execute') &&
            !clientMayExecuteTrades(client.redirectUris))
        )
          return res.sendStatus(403);
        const consentClient = describeMcpConsentClient(
          client,
          details.params.redirect_uri,
        );
        if (
          !consentClient ||
          !nativeMcpConsentGranted(
            consentClient,
            req.headers['x-oren-native-client-consent'],
          )
        )
          return res.sendStatus(403);
        const owner = await identity.requireMcpIdentity(
          req.headers.authorization,
        );
        if (requested.includes('oren.trade.execute')) {
          if (req.headers['x-oren-trade-execute-consent'] !== 'true')
            return res.sendStatus(403);
          if (
            !env.MCP_DELEGATED_TRADES_ENABLED ||
            !delegatedUserAllowed(delegatedAccess, owner.userId)
          )
            return res.sendStatus(403);
          const [delegation] = await db
            .select({ id: mcpTradeDelegations.id })
            .from(mcpTradeDelegations)
            .where(
              and(
                eq(mcpTradeDelegations.userId, owner.userId),
                eq(mcpTradeDelegations.walletId, owner.walletId),
                eq(mcpTradeDelegations.wallet, owner.wallet),
                eq(mcpTradeDelegations.status, 'active'),
                gt(mcpTradeDelegations.expiresAt, new Date()),
              ),
            )
            .limit(1);
          if (
            !delegation ||
            req.headers['x-oren-delegation-id'] !== delegation.id
          )
            return res.sendStatus(403);
          const [independent] = await db
            .select({ id: mcpApiTradeGrants.id })
            .from(mcpApiTradeGrants)
            .where(
              and(
                eq(mcpApiTradeGrants.id, delegation.id),
                eq(mcpApiTradeGrants.userId, owner.userId),
                eq(mcpApiTradeGrants.walletId, owner.walletId),
                eq(mcpApiTradeGrants.wallet, owner.wallet),
                eq(mcpApiTradeGrants.status, 'active'),
                gt(mcpApiTradeGrants.expiresAt, new Date()),
              ),
            );
          if (!independent) return res.sendStatus(403);
        }
        const grant = new oauth.provider.Grant({
          accountId: owner.userId,
          clientId,
        });
        grant.addResourceScope(oauth.resource, resourceScopes);
        // oidc-provider also checks configured scopes against the OP grant.
        // Keep that check satisfied while the resource grant remains required.
        grant.addOIDCScope(oidcScopes);
        const grantId = await grant.save();
        await db.insert(mcpConnections).values({
          grantId,
          clientId,
          userId: owner.userId,
          walletId: owner.walletId,
          wallet: owner.wallet,
          scopes: resourceScopes.join(' '),
        });
        const redirect = await oauth.provider.interactionResult(
          req,
          res,
          {
            login: {
              accountId: owner.userId,
              amr: ['email_otp'],
              remember: false,
            },
            consent: { grantId },
          },
          { mergeWithLastSubmission: false },
        );
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ redirect });
      } catch {
        return res.sendStatus(400);
      }
    });
    expressApp.use(
      '/oauth/connections',
      (req: Request, res: Response, next: NextFunction) => {
        if (req.headers.origin && req.headers.origin !== oauth.appOrigin)
          return res.sendStatus(403);
        if (req.headers.origin === oauth.appOrigin) {
          res.setHeader('Access-Control-Allow-Origin', oauth.appOrigin);
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type',
          );
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
      },
    );
    expressApp.get(
      '/oauth/connections',
      async (req: Request, res: Response) => {
        try {
          const userId = await identity.requireMcpUser(
            req.headers.authorization,
          );
          const rows = await db
            .select({
              grantId: mcpConnections.grantId,
              clientId: mcpConnections.clientId,
              wallet: mcpConnections.wallet,
              scopes: mcpConnections.scopes,
              createdAt: mcpConnections.createdAt,
            })
            .from(mcpConnections)
            .where(
              and(
                eq(mcpConnections.userId, userId),
                isNull(mcpConnections.revokedAt),
              ),
            );
          res.setHeader('Cache-Control', 'no-store');
          return res.json(rows);
        } catch {
          return res.sendStatus(401);
        }
      },
    );
    expressApp.post(
      '/oauth/connections/:grantId/revoke',
      async (req: Request, res: Response) => {
        if (req.headers.origin !== oauth.appOrigin) return res.sendStatus(403);
        const grantId = req.params.grantId;
        if (typeof grantId !== 'string') return res.sendStatus(400);
        try {
          const userId = await identity.requireMcpUser(
            req.headers.authorization,
          );
          const [row] = await db
            .update(mcpConnections)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(mcpConnections.grantId, grantId),
                eq(mcpConnections.userId, userId),
                isNull(mcpConnections.revokedAt),
              ),
            )
            .returning({ grantId: mcpConnections.grantId });
          if (!row) return res.sendStatus(404);
          await Promise.all([
            oauth.provider.AccessToken.revokeByGrantId(row.grantId),
            oauth.provider.RefreshToken.revokeByGrantId(row.grantId),
            oauth.provider.Grant.find(row.grantId).then((grant) =>
              grant?.destroy(),
            ),
          ]);
          return res.sendStatus(204);
        } catch {
          return res.sendStatus(503);
        }
      },
    );
    const registrationRetryAfter = createRegistrationRateLimit();
    expressApp.post(
      '/oauth/reg',
      (_req: Request, res: Response, next: NextFunction) => {
        const retryAfter = registrationRetryAfter();
        if (retryAfter) {
          res.setHeader('Retry-After', String(retryAfter));
          return res.sendStatus(429);
        }
        next();
      },
      mcpRegistrationBody,
    );
    expressApp.get('/oauth/auth', requireMcpOfflineConsent);
    expressApp.use('/oauth', oauth.provider.callback());
  }

  // MCP browser routes answer their own credentialed preflights before the
  // general Nest CORS handler handles /api requests.
  app.enableCors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
  });

  await app.listen(env.PORT);
  console.log(`Oren API listening on http://localhost:${env.PORT}/api`);
}

void bootstrap();
