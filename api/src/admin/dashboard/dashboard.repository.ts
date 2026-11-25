import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../config/constants';
import type { Database } from '../../database/database.provider';
import {
  adminAuditEvents,
  agentMessages,
  tradeFills,
  mcpConnections,
  mcpTradeIntents,
} from '../../database/schema';

const PAGE_SIZE = 25;

@Injectable()
export class DashboardRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async activity(start: Date, end: Date) {
    const [[stock], [chat]] = await Promise.all([
      this.db
        .select({
          volumeUsd: sql<string>`coalesce(sum(${tradeFills.usdNotional}), 0)`,
          trades: sql<number>`count(distinct ${tradeFills.transactionSignature})::int`,
        })
        .from(tradeFills)
        .where(
          and(gte(tradeFills.blockTime, start), lt(tradeFills.blockTime, end)),
        ),
      this.db
        .select({
          chats: sql<number>`count(distinct ${agentMessages.threadId})::int`,
          messages: sql<number>`count(*)::int`,
        })
        .from(agentMessages)
        .where(
          and(
            eq(agentMessages.role, 'user'),
            gte(agentMessages.createdAt, start),
            lt(agentMessages.createdAt, end),
          ),
        ),
    ]);
    return {
      volumeUsd: Number(stock.volumeUsd),
      trades: stock.trades,
      ...chat,
    };
  }

  async users(page: number) {
    const rows = await this.db
      .select({
        userId: mcpConnections.userId,
        connections: sql<number>`count(*)::int`,
        activeConnections: sql<number>`count(*) filter (where ${mcpConnections.revokedAt} is null)::int`,
        firstConnectedAt: sql<string>`min(${mcpConnections.createdAt})`,
        lastConnectedAt: sql<string>`max(${mcpConnections.createdAt})`,
      })
      .from(mcpConnections)
      .groupBy(mcpConnections.userId)
      .orderBy(
        desc(sql`max(${mcpConnections.createdAt})`),
        mcpConnections.userId,
      )
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return paged(
      rows,
      page,
      'Accounts with recorded MCP connections. This is not the complete Privy user directory.',
    );
  }

  async connections(page: number) {
    const rows = await this.db
      .select({
        grantId: mcpConnections.grantId,
        clientId: mcpConnections.clientId,
        userId: mcpConnections.userId,
        wallet: mcpConnections.wallet,
        scopes: mcpConnections.scopes,
        createdAt: mcpConnections.createdAt,
        revokedAt: mcpConnections.revokedAt,
      })
      .from(mcpConnections)
      .orderBy(desc(mcpConnections.createdAt), mcpConnections.grantId)
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return paged(
      rows,
      page,
      'Recorded OAuth connections. Not revoked does not guarantee that an access token is unexpired.',
    );
  }

  async trades(page: number) {
    const rows = await this.db
      .select({
        id: mcpTradeIntents.id,
        userId: mcpTradeIntents.userId,
        ticker: mcpTradeIntents.ticker,
        side: mcpTradeIntents.side,
        mode: mcpTradeIntents.mode,
        status: mcpTradeIntents.status,
        amountUsd: mcpTradeIntents.amountUsd,
        amountShares: mcpTradeIntents.amountShares,
        createdAt: mcpTradeIntents.createdAt,
        expiresAt: mcpTradeIntents.expiresAt,
      })
      .from(mcpTradeIntents)
      .orderBy(desc(mcpTradeIntents.createdAt), mcpTradeIntents.id)
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return paged(
      rows,
      page,
      'Agent trade intents only. Status is application memory; Solana remains the financial ledger. No signing or retry actions are available here.',
    );
  }

  async audit(page: number) {
    const rows = await this.db
      .select({
        id: adminAuditEvents.id,
        actorId: adminAuditEvents.actorId,
        action: adminAuditEvents.action,
        targetId: adminAuditEvents.targetId,
        createdAt: adminAuditEvents.createdAt,
      })
      .from(adminAuditEvents)
      .orderBy(desc(adminAuditEvents.createdAt), adminAuditEvents.id)
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return paged(
      rows,
      page,
      'Admin access and account actions. Credentials and session values are never included.',
    );
  }
}

function paged<T>(rows: T[], page: number, note: string) {
  return {
    rows: rows.slice(0, PAGE_SIZE),
    page,
    hasNext: rows.length > PAGE_SIZE,
    note,
  };
}
