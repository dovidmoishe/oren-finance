import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ENV } from '../../config/constants';
import { AdminAuthController } from '../auth/admin-auth.controller';
import {
  AdminAuthRepository,
  type StoredAdmin,
} from '../auth/admin-auth.repository';
import { AdminAuthService } from '../auth/admin-auth.service';
import { secretHash } from '../auth/admin-cookie';
import { hashPassword } from '../auth/admin-password';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';

describe('admin dashboard HTTP authorization', () => {
  let app: INestApplication<Server>;
  let account: StoredAdmin;
  let storedSession: {
    accountId: string;
    csrfHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
  };
  const sessionId = 'local-test-session';
  const csrf = secretHash(`csrf:${sessionId}`);
  const cookie = `oren_admin_session=${sessionId}`;
  let storedSessionHash = secretHash(sessionId);
  const repository = {
    findSession: jest.fn((id: string) =>
      id === storedSessionHash ? storedSession : null,
    ),
    findById: jest.fn(() => account),
    findByEmail: jest.fn((email: string) =>
      email === account.email ? account : null,
    ),
    failureCount: jest.fn(() => 0),
    recordAttempt: jest.fn(() => undefined),
    audit: jest.fn(() => undefined),
    markTemporaryUsed: jest.fn((_id: string, at: Date) => {
      account.tempPasswordUsedAt = at;
    }),
    createSession: jest.fn(
      (input: Parameters<AdminAuthRepository['createSession']>[0]) => {
        storedSessionHash = input.idHash;
        storedSession = { ...input, revokedAt: null };
      },
    ),
    revokeSession: jest.fn((_id: string, at: Date) => {
      storedSession.revokedAt = at;
    }),
    replacePassword: jest.fn((_id: string, hash: string, at: Date) => {
      account.passwordHash = hash;
      account.mustChangePassword = false;
      account.status = 'active';
      storedSession.revokedAt = at;
    }),
  };
  const dashboard = {
    users: jest.fn(() => ({ rows: [], hasNext: false, page: 1 })),
    connections: jest.fn(() => ({ rows: [], hasNext: false, page: 1 })),
    trades: jest.fn(() => ({ rows: [], hasNext: false, page: 1 })),
    audit: jest.fn(() => ({ rows: [], hasNext: false, page: 1 })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminAuthController, DashboardController],
      providers: [
        AdminAuthService,
        { provide: AdminAuthRepository, useValue: repository },
        { provide: DashboardRepository, useValue: dashboard },
        { provide: APP_ENV, useValue: { DEPLOYMENT_ENV: 'development' } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    storedSessionHash = secretHash(sessionId);
    account = {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'admin@example.test',
      passwordHash: await hashPassword('test-password-only'),
      isMaster: false,
      status: 'active',
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
      tempPasswordUsedAt: null,
      revokedAt: null,
      permissions: ['dashboard.access'],
    };
    storedSession = {
      accountId: account.id,
      csrfHash: secretHash(csrf),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    };
  });
  afterAll(async () => {
    await app.close();
  });

  it('restores safe session metadata and the same CSRF token without exposing hashes', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(200);
    expect(result.body).toEqual({
      id: account.id,
      email: account.email,
      isMaster: false,
      permissions: ['dashboard.access'],
      mustChangePassword: false,
      csrfToken: csrf,
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(result.body)).not.toContain(account.passwordHash);
  });
  it('requires the admin marker for session discovery', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .expect(401);
  });
  it('signs in with an HttpOnly scoped cookie and restores the login CSRF token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/session')
      .set('X-Oren-Admin', '1')
      .send({ email: account.email, password: 'test-password-only' })
      .expect(200);
    const setCookie = String(login.headers['set-cookie'][0]);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/api/admin');
    expect(login.headers['cache-control']).toBe('no-store');
    const restored = await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', setCookie.split(';')[0])
      .set('X-Oren-Admin', '1')
      .expect(200);
    expect((restored.body as { csrfToken: string }).csrfToken).toBe(
      (login.body as { csrfToken: string }).csrfToken,
    );
  });
  it('requires CSRF to log out and revokes the session after a valid logout', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/auth/session/logout')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
    const result = await request(app.getHttpServer())
      .post('/api/admin/auth/session/logout')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .set('X-CSRF-Token', csrf)
      .expect(204);
    expect(String(result.headers['set-cookie'][0])).toContain('Max-Age=0');
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
  });
  it('requires CSRF and the current password before replacing the password and invalidating sessions', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/auth/password')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .send({
        currentPassword: 'test-password-only',
        nextPassword: 'new-test-password-only',
      })
      .expect(401);
    expect(repository.replacePassword).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/admin/auth/password')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .set('X-CSRF-Token', csrf)
      .send({
        currentPassword: 'incorrect-password-only',
        nextPassword: 'new-test-password-only',
      })
      .expect(401);
    expect(repository.replacePassword).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/admin/auth/password')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .set('X-CSRF-Token', csrf)
      .send({
        currentPassword: 'test-password-only',
        nextPassword: 'new-test-password-only',
      })
      .expect(204);
    expect(repository.replacePassword).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
  });
  it('consumes temporary credentials at first login while retaining the password-replacement session', async () => {
    account.status = 'invited';
    account.mustChangePassword = true;
    account.tempPasswordExpiresAt = new Date(Date.now() + 60_000);
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/session')
      .set('X-Oren-Admin', '1')
      .send({ email: account.email, password: 'test-password-only' })
      .expect(200);
    const replacementCookie = String(login.headers['set-cookie'][0]).split(
      ';',
    )[0];
    expect(
      (login.body as { mustChangePassword: boolean }).mustChangePassword,
    ).toBe(true);
    await request(app.getHttpServer())
      .post('/api/admin/auth/session')
      .set('X-Oren-Admin', '1')
      .send({ email: account.email, password: 'test-password-only' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', replacementCookie)
      .set('X-Oren-Admin', '1')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/users')
      .set('Cookie', replacementCookie)
      .set('X-Oren-Admin', '1')
      .expect(403);
  });
  it('rejects expired sessions, revoked sessions and revoked accounts', async () => {
    storedSession.expiresAt = new Date(0);
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
    storedSession.expiresAt = new Date(Date.now() + 60_000);
    storedSession.revokedAt = new Date();
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/users')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
    storedSession.revokedAt = null;
    account.revokedAt = new Date();
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/users')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
    expect(dashboard.users).not.toHaveBeenCalled();
  });
  it('requires sign-in again for legacy non-restorable CSRF sessions', async () => {
    storedSession.csrfHash = secretHash('old-random-token');
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(401);
  });
  it('allows password replacement sessions to restore, while blocking operational reads', async () => {
    account.mustChangePassword = true;
    account.status = 'invited';
    await request(app.getHttpServer())
      .get('/api/admin/auth/session')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/trades')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(403);
    expect(dashboard.trades).not.toHaveBeenCalled();
  });
  it('does not elevate report readers, masters without the permission, or machine bearers', async () => {
    account.permissions = ['reports.read'];
    account.isMaster = true;
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/connections')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/users')
      .set('Authorization', 'Bearer synthetic-machine-token')
      .set('X-Oren-Admin', '1')
      .expect(401);
    expect(dashboard.connections).not.toHaveBeenCalled();
    expect(dashboard.users).not.toHaveBeenCalled();
  });
  it('authorizes operational reads only with explicit dashboard access and never caches them', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/admin/dashboard/trades?page=2')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(200);
    expect(dashboard.trades).toHaveBeenCalledWith(2);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('restricts audit history to master admins', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/audit')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(403);
    account.isMaster = true;
    await request(app.getHttpServer())
      .get('/api/admin/dashboard/audit')
      .set('Cookie', cookie)
      .set('X-Oren-Admin', '1')
      .expect(200);
  });
  it.each(['0', '-1', '1.2', '100000', 'abc'])(
    'rejects malformed page %s before querying data',
    async (page) => {
      await request(app.getHttpServer())
        .get(`/api/admin/dashboard/trades?page=${page}`)
        .set('Cookie', cookie)
        .set('X-Oren-Admin', '1')
        .expect(400);
      expect(dashboard.trades).not.toHaveBeenCalled();
    },
  );
});
