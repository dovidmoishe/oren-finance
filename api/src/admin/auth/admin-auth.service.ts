import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { secretHash, secretsMatch, newSecret } from './admin-cookie';
import {
  dummyPasswordHash,
  hashPassword,
  temporaryPassword,
  verifyPassword,
} from './admin-password';
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_WINDOW_MS,
  TEMP_PASSWORD_TTL_MS,
  canManageAccounts,
  canAccessDashboard,
  canReadReports,
  invitationPermissions,
  normalizeEmail,
  passwordAcceptable,
  sessionLifetime,
  temporaryPasswordUsable,
  type AdminPrincipal,
} from './admin-policy';
import { AdminAuthRepository, type StoredAdmin } from './admin-auth.repository';

const INVALID = 'Invalid email or password';

@Injectable()
export class AdminAuthService {
  constructor(private readonly repository: AdminAuthRepository) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
  }): Promise<{
    sessionId: string;
    csrfToken: string;
    maxAgeSeconds: number;
    mustChangePassword: boolean;
  }> {
    if (typeof input.email !== 'string' || typeof input.password !== 'string')
      throw new UnauthorizedException(INVALID);
    const email = normalizeEmail(input.email);
    const emailKey = secretHash(
      `email:${email ?? input.email.trim().toLowerCase()}`,
    );
    const ipKey = input.ip ? secretHash(`ip:${input.ip}`) : null;
    if (await this.throttled(emailKey, ipKey)) {
      throw new HttpException({ message: 'Try again later' }, 429);
    }
    if (!email || !passwordAcceptable(input.password)) {
      await this.repository.recordAttempt(emailKey, false);
      throw new UnauthorizedException(INVALID);
    }
    const account = await this.repository.findByEmail(email);
    const hash = account?.passwordHash ?? (await dummyPasswordHash());
    const matches = await verifyPassword(input.password, hash);
    if (!account || !matches) {
      await this.repository.recordAttempt(emailKey, false);
      if (ipKey) await this.repository.recordAttempt(ipKey, false);
      throw new UnauthorizedException(INVALID);
    }
    const principal = toPrincipal(account);
    if (
      principal.mustChangePassword &&
      !temporaryPasswordUsable(principal, new Date())
    ) {
      await this.repository.recordAttempt(emailKey, false);
      throw new UnauthorizedException(INVALID);
    }
    if (principal.status === 'revoked' || principal.revokedAt) {
      await this.repository.recordAttempt(emailKey, false);
      throw new UnauthorizedException(INVALID);
    }
    const now = new Date();
    const sessionId = newSecret();
    const csrfToken = secretHash(`csrf:${sessionId}`);
    const lifetime = sessionLifetime(principal.mustChangePassword);
    await this.repository.createSession(
      {
        idHash: secretHash(sessionId),
        accountId: account.id,
        csrfHash: secretHash(csrfToken),
        expiresAt: new Date(now.getTime() + lifetime),
      },
      account.passwordHash,
    );
    await this.repository.recordAttempt(emailKey, true);
    await this.repository.audit({
      actorId: account.id,
      action: 'login_succeeded',
      targetId: account.id,
      metadata: { mustChangePassword: String(principal.mustChangePassword) },
    });
    return {
      sessionId,
      csrfToken,
      maxAgeSeconds: Math.floor(lifetime / 1000),
      mustChangePassword: principal.mustChangePassword,
    };
  }

  async reportActor(sessionId: string | undefined): Promise<void> {
    if (!sessionId) throw new UnauthorizedException();
    const account = await this.accountForSession(sessionId, false);
    if (!account) throw new UnauthorizedException();
    if (!canReadReports(toPrincipal(account))) throw new ForbiddenException();
  }

  async session(sessionId: string | undefined) {
    if (!sessionId) throw new UnauthorizedException();
    const csrfToken = secretHash(`csrf:${sessionId}`);
    // Sessions created before restorable CSRF tokens must sign in again.
    const account = await this.accountForSession(sessionId, csrfToken);
    if (!account) throw new UnauthorizedException();
    return {
      id: account.id,
      email: account.email,
      isMaster: account.isMaster,
      permissions: account.permissions,
      mustChangePassword: account.mustChangePassword,
      csrfToken,
    };
  }

  async dashboardActor(sessionId: string | undefined): Promise<void> {
    const account = await this.accountForSession(sessionId, false);
    if (!account) throw new UnauthorizedException();
    if (!canAccessDashboard(toPrincipal(account)))
      throw new ForbiddenException();
  }

  async masterActor(sessionId: string | undefined): Promise<void> {
    const account = await this.accountForSession(sessionId, false);
    if (!account) throw new UnauthorizedException();
    if (!canManageAccounts(toPrincipal(account)))
      throw new ForbiddenException();
  }

  async logout(
    sessionId: string | undefined,
    csrfToken: string | undefined,
  ): Promise<void> {
    const account = await this.accountForSession(sessionId, csrfToken ?? '');
    if (!account || !sessionId) throw new UnauthorizedException();
    await this.repository.revokeSession(secretHash(sessionId), new Date());
    await this.repository.audit({
      actorId: account.id,
      action: 'logout',
      targetId: account.id,
    });
  }

  async changePassword(input: {
    sessionId: string | undefined;
    csrfToken: string | undefined;
    currentPassword: string;
    nextPassword: string;
  }): Promise<void> {
    const account = await this.requireAccount(input.sessionId, input.csrfToken);
    if (
      !passwordAcceptable(input.nextPassword) ||
      input.nextPassword === input.currentPassword
    ) {
      throw new BadRequestException(
        'Choose a different password of at least 12 characters',
      );
    }
    const matches = await verifyPassword(
      input.currentPassword,
      account.passwordHash,
    );
    if (!matches) throw new UnauthorizedException(INVALID);
    await this.repository.replacePassword(
      account.id,
      await hashPassword(input.nextPassword),
      new Date(),
      account.passwordHash,
    );
    await this.repository.audit({
      actorId: account.id,
      action: 'password_changed',
      targetId: account.id,
    });
  }

  async invite(input: {
    sessionId: string | undefined;
    csrfToken: string | undefined;
    email: string;
    permissions: string[];
  }): Promise<{
    id: string;
    email: string;
    temporaryPassword: string;
    expiresAt: string;
  }> {
    const actor = await this.requireAccount(input.sessionId, input.csrfToken);
    if (!canManageAccounts(toPrincipal(actor))) throw new ForbiddenException();
    if (typeof input.email !== 'string' || !Array.isArray(input.permissions))
      throw new BadRequestException('Invalid invitation');
    const email = normalizeEmail(input.email);
    const permissions = invitationPermissions(input.permissions);
    if (!email || !permissions)
      throw new BadRequestException('Invalid invitation');
    if (await this.repository.findByEmail(email)) {
      throw new HttpException({ message: 'That admin already exists' }, 409);
    }
    const plaintext = temporaryPassword();
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
    const id = await this.repository.insertAccount({
      email,
      passwordHash: await hashPassword(plaintext),
      isMaster: false,
      status: 'invited',
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
      createdBy: actor.id,
      permissions,
    });
    await this.repository.audit({
      actorId: actor.id,
      action: 'invited',
      targetId: id,
      metadata: { permissions: permissions.join(',') },
    });
    return {
      id,
      email,
      temporaryPassword: plaintext,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async rotateTemporary(input: {
    sessionId: string | undefined;
    csrfToken: string | undefined;
    accountId: string;
  }): Promise<{ temporaryPassword: string; expiresAt: string }> {
    const actor = await this.requireAccount(input.sessionId, input.csrfToken);
    if (!canManageAccounts(toPrincipal(actor))) throw new ForbiddenException();
    const target = await this.repository.findById(input.accountId);
    if (
      !target ||
      target.isMaster ||
      target.status === 'revoked' ||
      target.revokedAt
    )
      throw new ForbiddenException();
    const plaintext = temporaryPassword();
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
    await this.repository.rotateTemporary(
      target.id,
      await hashPassword(plaintext),
      expiresAt,
    );
    await this.repository.audit({
      actorId: actor.id,
      action: 'temporary_password_rotated',
      targetId: target.id,
    });
    return { temporaryPassword: plaintext, expiresAt: expiresAt.toISOString() };
  }

  async revoke(input: {
    sessionId: string | undefined;
    csrfToken: string | undefined;
    accountId: string;
  }): Promise<void> {
    const actor = await this.requireAccount(input.sessionId, input.csrfToken);
    if (!canManageAccounts(toPrincipal(actor))) throw new ForbiddenException();
    if (input.accountId === actor.id) throw new ForbiddenException();
    const target = await this.repository.findById(input.accountId);
    if (!target || target.isMaster) throw new ForbiddenException();
    await this.repository.revokeAccount(target.id, new Date());
    await this.repository.audit({
      actorId: actor.id,
      action: 'revoked',
      targetId: target.id,
    });
  }

  async list(input: {
    sessionId: string | undefined;
    csrfToken: string | undefined;
  }) {
    const actor = await this.requireAccount(input.sessionId, input.csrfToken);
    if (!canManageAccounts(toPrincipal(actor))) throw new ForbiddenException();
    const rows = await this.repository.list();
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      isMaster: row.isMaster,
      status: row.status,
      mustChangePassword: row.mustChangePassword,
      permissions: row.permissions,
    }));
  }

  private async requireAccount(
    sessionId: string | undefined,
    csrfToken: string | undefined,
  ): Promise<StoredAdmin> {
    const account = await this.accountForSession(sessionId, csrfToken ?? '');
    if (!account) throw new UnauthorizedException();
    return account;
  }

  private async accountForSession(
    sessionId: string | undefined,
    csrfToken: string | false,
  ): Promise<StoredAdmin | null> {
    if (!sessionId) return null;
    const session = await this.repository.findSession(secretHash(sessionId));
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      return null;
    if (csrfToken !== false) {
      if (
        !csrfToken ||
        !secretsMatch(secretHash(csrfToken), session.csrfHash)
      ) {
        return null;
      }
    }
    const account = await this.repository.findById(session.accountId);
    if (!account || account.status === 'revoked' || account.revokedAt)
      return null;
    return account;
  }

  private async throttled(
    emailKey: string,
    ipKey: string | null,
  ): Promise<boolean> {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS);
    if (
      (await this.repository.failureCount(emailKey, since)) >=
      LOGIN_FAILURE_LIMIT
    ) {
      return true;
    }
    if (
      ipKey &&
      (await this.repository.failureCount(ipKey, since)) >= LOGIN_FAILURE_LIMIT
    ) {
      return true;
    }
    return false;
  }
}

function toPrincipal(account: StoredAdmin): AdminPrincipal {
  return {
    id: account.id,
    isMaster: account.isMaster,
    status: account.status,
    mustChangePassword: account.mustChangePassword,
    revokedAt: account.revokedAt,
    tempExpiresAt: account.tempPasswordExpiresAt,
    tempUsedAt: account.tempPasswordUsedAt,
    permissions: account.permissions,
  };
}
