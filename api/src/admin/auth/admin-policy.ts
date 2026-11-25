export const ADMIN_PERMISSIONS = ['reports.read', 'dashboard.access'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
export const CHANGE_SESSION_MS = 30 * 60 * 1000;
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 8;

export interface AdminPrincipal {
  id: string;
  isMaster: boolean;
  status: 'invited' | 'active' | 'revoked';
  mustChangePassword: boolean;
  revokedAt: Date | null;
  tempExpiresAt: Date | null;
  tempUsedAt: Date | null;
  permissions: readonly string[];
}

export function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (value.length > 200) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

export function passwordAcceptable(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    password.length <= 200
  );
}

export function invitationPermissions(
  requested: readonly string[],
): AdminPermission[] | null {
  if (requested.length === 0) return null;
  const unique = [...new Set(requested)];
  if (
    unique.some((item) => !ADMIN_PERMISSIONS.includes(item as AdminPermission))
  ) {
    return null;
  }
  return unique as AdminPermission[];
}

/** Offline bootstrap is explicit; being master alone never implies report access. */
export function bootstrapPermissions(
  value: string | undefined,
): AdminPermission[] | null {
  return value === undefined
    ? []
    : invitationPermissions(value.split(',').map((item) => item.trim()));
}

export function temporaryPasswordUsable(
  account: AdminPrincipal,
  now: Date,
): boolean {
  if (account.status === 'revoked' || account.revokedAt) return false;
  if (!account.mustChangePassword) return false;
  if (!account.tempExpiresAt || account.tempExpiresAt <= now) return false;
  if (account.tempUsedAt) return false;
  return true;
}

/** Report reads require an explicit permission and a replaced password. */
export function canReadReports(account: AdminPrincipal): boolean {
  if (account.status === 'revoked' || account.revokedAt) return false;
  if (account.mustChangePassword) return false;
  if (account.status !== 'active') return false;
  return account.permissions.includes('reports.read');
}

/** Operational reads are separate from aggregate reporting and trade authority. */
export function canAccessDashboard(account: AdminPrincipal): boolean {
  return (
    account.status === 'active' &&
    !account.revokedAt &&
    !account.mustChangePassword &&
    account.permissions.includes('dashboard.access')
  );
}

/** Only a master who has replaced the temporary password manages accounts. */
export function canManageAccounts(account: AdminPrincipal): boolean {
  if (!account.isMaster) return false;
  if (account.mustChangePassword) return false;
  if (account.status === 'revoked' || account.revokedAt) return false;
  return account.status === 'active';
}

export function sessionLifetime(mustChangePassword: boolean): number {
  return mustChangePassword ? CHANGE_SESSION_MS : ADMIN_SESSION_MS;
}
