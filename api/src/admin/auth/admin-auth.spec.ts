import {
  hashPassword,
  temporaryPassword,
  verifyPassword,
} from './admin-password';
import {
  canManageAccounts,
  canReadReports,
  bootstrapPermissions,
  invitationPermissions,
  temporaryPasswordUsable,
} from './admin-policy';

const now = new Date('2026-11-07T18:00:00.000Z');

describe('admin passwords', () => {
  it('stores a hash that is not the password and rejects a different password', async () => {
    const password = temporaryPassword();
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword(`${password}x`, stored)).toBe(false);
  });
});

describe('admin authority', () => {
  it('requires explicit bounded report and dashboard permissions at bootstrap', () => {
    expect(bootstrapPermissions(undefined)).toEqual([]);
    expect(bootstrapPermissions('reports.read,dashboard.access')).toEqual([
      'reports.read',
      'dashboard.access',
    ]);
    expect(bootstrapPermissions('dashboard.access')).toEqual([
      'dashboard.access',
    ]);
    expect(bootstrapPermissions('')).toBeNull();
    expect(bootstrapPermissions('accounts.manage')).toBeNull();
    expect(bootstrapPermissions('reports.read,trade.execute')).toBeNull();
  });
  const master = {
    id: 'm',
    isMaster: true,
    status: 'active' as const,
    mustChangePassword: false,
    revokedAt: null,
    tempExpiresAt: null,
    tempUsedAt: null,
    permissions: [] as string[],
  };
  it('keeps reports and account management behind the password gate', () => {
    const invited = {
      ...master,
      isMaster: false,
      status: 'invited' as const,
      mustChangePassword: true,
      tempExpiresAt: new Date('2026-11-08T18:00:00.000Z'),
      permissions: ['reports.read'],
    };
    expect(canReadReports(invited)).toBe(false);
    expect(canManageAccounts(invited)).toBe(false);
    expect(temporaryPasswordUsable(invited, now)).toBe(true);
    expect(temporaryPasswordUsable({ ...invited, tempUsedAt: now }, now)).toBe(
      false,
    );
    expect(canReadReports({ ...master, permissions: ['reports.read'] })).toBe(
      true,
    );
    expect(canReadReports(master)).toBe(false);
    expect(canManageAccounts(master)).toBe(true);
    expect(canManageAccounts({ ...master, isMaster: false })).toBe(false);
    expect(invitationPermissions(['reports.read', 'dashboard.access'])).toEqual(
      ['reports.read', 'dashboard.access'],
    );
    expect(invitationPermissions(['accounts.manage'])).toBeNull();
    expect(invitationPermissions(['admin.full'])).toBeNull();
  });
});
