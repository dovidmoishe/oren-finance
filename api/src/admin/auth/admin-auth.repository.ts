import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
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
    const [row] = await this.db
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
      await this.db.insert(adminPermissions).values(
        input.permissions.map((permission) => ({
          accountId: row.id,
          permission,
        })),
      );
    }
    return row.id;
  }

  async markTemporaryUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(adminAccounts)
      .set({ tempPasswordUsedAt: at })
      .where(eq(adminAccounts.id, id));
  }

  async replacePassword(
    id: string,
    passwordHash: string,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(adminAccounts)
      .set({
        passwordHash,
        mustChangePassword: false,
        status: 'active',
        tempPasswordExpiresAt: null,
        tempPasswordUsedAt: null,
        passwordChangedAt: at,
      })
      .where(eq(adminAccounts.id, id));
    await this.revokeSessions(id, at);
  }

  async revokeAccount(id: string, at: Date): Promise<void> {
    await this.db
      .update(adminAccounts)
      .set({ status: 'revoked', revokedAt: at })
      .where(eq(adminAccounts.id, id));
    await this.revokeSessions(id, at);
  }

  async rotateTemporary(
    id: string,
    passwordHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db
      .update(adminAccounts)
      .set({
        passwordHash,
        mustChangePassword: true,
        status: 'invited',
        tempPasswordExpiresAt: expiresAt,
        tempPasswordUsedAt: null,
      })
      .where(eq(adminAccounts.id, id));
    await this.revokeSessions(id, new Date());
  }

  async createSession(input: {
    idHash: string;
    accountId: string;
    csrfHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(adminSessions).values(input);
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

  async revokeSessions(accountId: string, at: Date): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: at })
      .where(
        and(
          eq(adminSessions.accountId, accountId),
          isNull(adminSessions.revokedAt),
        ),
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
