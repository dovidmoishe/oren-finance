import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../config/constants';
import type { Database } from '../../database/database.provider';
import {
  adminAccounts,
  adminAuditEvents,
  adminLoginAttempts,
  adminPermissions,
  adminSessions,
} from '../../database/schema';
import type { AdminPermission } from './admin-policy';

export interface StoredAdmin {
  id: string;
  email: string;
  passwordHash: string;
  isMaster: boolean;
  status: 'invited' | 'active' | 'revoked';
  mustChangePassword: boolean;
  tempPasswordExpiresAt: Date | null;
  tempPasswordUsedAt: Date | null;
  revokedAt: Date | null;
  permissions: string[];
}

@Injectable()
export class AdminAuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<StoredAdmin | null> {
    const [row] = await this.db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.email, email))
      .limit(1);
    if (!row) return null;
    return this.withPermissions(row);
  }

  async findById(id: string): Promise<StoredAdmin | null> {
    const [row] = await this.db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.id, id))
      .limit(1);
    if (!row) return null;
    return this.withPermissions(row);
  }

  async list(): Promise<StoredAdmin[]> {
    const rows = await this.db.select().from(adminAccounts);
    return Promise.all(rows.map((row) => this.withPermissions(row)));
  }

  async masterCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminAccounts)
      .where(eq(adminAccounts.isMaster, true));
    return row?.count ?? 0;
  }

  async insertAccount(input: {
    email: string;
    passwordHash: string;
    isMaster: boolean;
    status: 'invited' | 'active';
    mustChangePassword: boolean;
    tempPasswordExpiresAt: Date | null;
    createdBy: string | null;
    permissions: AdminPermission[];
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminAccounts)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          isMaster: input.isMaster,
          status: input.status,
          mustChangePassword: input.mustChangePassword,
          tempPasswordExpiresAt: input.tempPasswordExpiresAt,
          createdBy: input.createdBy,
        })
        .returning({ id: adminAccounts.id });
      if (input.permissions.length > 0) {
        await tx.insert(adminPermissions).values(
          input.permissions.map((permission) => ({
            accountId: row.id,
            permission,
          })),
        );
      }
      return row.id;
    });
  }

  async replacePassword(
    id: string,
    passwordHash: string,
    at: Date,
    currentHash: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(adminAccounts)
        .set({
          passwordHash,
          mustChangePassword: false,
          status: 'active',
          tempPasswordExpiresAt: null,
          tempPasswordUsedAt: null,
          passwordChangedAt: at,
        })
        .where(
          and(
            eq(adminAccounts.id, id),
            eq(adminAccounts.passwordHash, currentHash),
            isNull(adminAccounts.revokedAt),
          ),
        )
        .returning({ id: adminAccounts.id });
      if (!updated.length) throw new UnauthorizedException();
      await tx
        .update(adminSessions)
        .set({ revokedAt: at })
        .where(
          and(eq(adminSessions.accountId, id), isNull(adminSessions.revokedAt)),
        );
    });
  }

  async revokeAccount(id: string, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(adminAccounts)
        .set({ status: 'revoked', revokedAt: at })
        .where(eq(adminAccounts.id, id));
      await tx
        .update(adminSessions)
        .set({ revokedAt: at })
        .where(
          and(eq(adminSessions.accountId, id), isNull(adminSessions.revokedAt)),
        );
    });
  }

  async rotateTemporary(
    id: string,
    passwordHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(adminAccounts)
        .set({
          passwordHash,
          mustChangePassword: true,
          status: 'invited',
          tempPasswordExpiresAt: expiresAt,
          tempPasswordUsedAt: null,
        })
        .where(eq(adminAccounts.id, id));
      await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(adminSessions.accountId, id), isNull(adminSessions.revokedAt)),
        );
    });
  }

  async createSession(
    input: {
      idHash: string;
      accountId: string;
      csrfHash: string;
      expiresAt: Date;
    },
    passwordHash: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(adminAccounts)
        .where(
          and(
            eq(adminAccounts.id, input.accountId),
            eq(adminAccounts.passwordHash, passwordHash),
            isNull(adminAccounts.revokedAt),
          ),
        )
        .for('update');
      if (!account || account.status === 'revoked')
        throw new UnauthorizedException('Invalid email or password');
      if (account.mustChangePassword) {
        const now = new Date();
        const used = await tx
          .update(adminAccounts)
          .set({ tempPasswordUsedAt: now })
          .where(
            and(
              eq(adminAccounts.id, account.id),
              isNull(adminAccounts.tempPasswordUsedAt),
              gt(adminAccounts.tempPasswordExpiresAt, now),
            ),
          )
          .returning({ id: adminAccounts.id });
        if (!used.length)
          throw new UnauthorizedException('Invalid email or password');
      }
      await tx.insert(adminSessions).values(input);
    });
  }

  async findSession(idHash: string): Promise<{
    accountId: string;
    csrfHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    const [row] = await this.db
      .select({
        accountId: adminSessions.accountId,
        csrfHash: adminSessions.csrfHash,
        expiresAt: adminSessions.expiresAt,
        revokedAt: adminSessions.revokedAt,
      })
      .from(adminSessions)
      .where(eq(adminSessions.idHash, idHash))
      .limit(1);
    return row ?? null;
  }

  async revokeSession(idHash: string, at: Date): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: at })
      .where(
        and(eq(adminSessions.idHash, idHash), isNull(adminSessions.revokedAt)),
      );
  }

  async failureCount(subjectHash: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminLoginAttempts)
      .where(
        and(
          eq(adminLoginAttempts.subjectHash, subjectHash),
          eq(adminLoginAttempts.succeeded, false),
          gte(adminLoginAttempts.createdAt, since),
        ),
      );
    return row?.count ?? 0;
  }

  async recordAttempt(subjectHash: string, succeeded: boolean): Promise<void> {
    await this.db.insert(adminLoginAttempts).values({ subjectHash, succeeded });
  }

  async audit(input: {
    actorId: string | null;
    action: string;
    targetId: string | null;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.db.insert(adminAuditEvents).values({
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    });
  }

  private async withPermissions(
    row: typeof adminAccounts.$inferSelect,
  ): Promise<StoredAdmin> {
    const permissions = await this.db
      .select({ permission: adminPermissions.permission })
      .from(adminPermissions)
      .where(eq(adminPermissions.accountId, row.id));
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      isMaster: row.isMaster,
      status: row.status,
      mustChangePassword: row.mustChangePassword,
      tempPasswordExpiresAt: row.tempPasswordExpiresAt,
      tempPasswordUsedAt: row.tempPasswordUsedAt,
      revokedAt: row.revokedAt,
      permissions: permissions.map((item) => item.permission),
    };
  }
}
