import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express, Request, Response, NextFunction } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { AppModule } from './app.module';
import { PrivyWalletAuth } from './auth/privy-wallet-auth';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validateEnv } from './config/env.schema';
import { DatabaseService } from './database/database.provider';
import { mcpConnections } from './database/schema';
import { MarketService } from './market/market.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { handleMcpRequest } from './mcp-auth/mcp-resource';
import { createMcpOAuthRuntime } from './mcp-auth/oauth-runtime';

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
  app.enableCors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
  });

  const oauth = await createMcpOAuthRuntime(app.get(DatabaseService).db);
  if (oauth) {
    if (env.DEPLOYMENT_ENV === 'preview')
      throw new Error('MCP OAuth is disabled in preview deployments');
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    const db = app.get(DatabaseService).db;
    const identity = app.get(PrivyWalletAuth, { strict: false });
    const mcpDeps = {
      db,
      auth: identity,
      market: app.get(MarketService, { strict: false }),
      portfolio: app.get(PortfolioService, { strict: false }),
      oauth,
    };
    expressApp.get(
      '/.well-known/oauth-protected-resource/mcp',
      (_req: Request, res: Response) =>
        res.json({
          resource: oauth.resource,
          authorization_servers: [oauth.issuer],
        }),
    );
    // Path-based issuer discovery for clients following RFC 8414.
    expressApp.use(
      '/.well-known/oauth-authorization-server/oauth',
      (req: Request, res: Response) => {
        req.url = '/.well-known/oauth-authorization-server';
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
            'Authorization, Content-Type',
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
        return res.json({
          clientId: details.params.client_id,
          scope: details.params.scope,
          resource: oauth.resource,
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
        const requested = details.params.scope.split(/\s+/).filter(Boolean);
        if (
          requested.some(
            (scope) => !['oren.read', 'offline_access'].includes(scope),
          )
        )
          return res.sendStatus(403);
        const owner = await identity.requireMcpIdentity(
          req.headers.authorization,
        );
        const grant = new oauth.provider.Grant({
          accountId: owner.userId,
          clientId: String(details.params.client_id),
        });
        grant.addResourceScope(oauth.resource, 'oren.read');
        if (requested.includes('offline_access'))
          grant.addOIDCScope('offline_access');
        const grantId = await grant.save();
        await db.insert(mcpConnections).values({
          grantId,
          clientId: String(details.params.client_id),
          userId: owner.userId,
          walletId: owner.walletId,
          wallet: owner.wallet,
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
    expressApp.use('/oauth', oauth.provider.callback());
  }

  await app.listen(env.PORT);
  console.log(`Oren API listening on http://localhost:${env.PORT}/api`);
}

void bootstrap();
