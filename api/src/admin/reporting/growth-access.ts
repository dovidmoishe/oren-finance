export const REPORT_PERMISSIONS = [
  'marketing.read',
  'marketing.import',
] as const;
export type ReportPermission = (typeof REPORT_PERMISSIONS)[number];

export interface AccessGrant {
  id: string;
  permission: ReportPermission;
  revokedAt?: Date | null;
  expiresAt?: Date | null;
}

export type AccessDenial =
  'missing' | 'revoked' | 'expired' | 'wrong_permission';

/** marketing.read does not imply import, and neither is full admin authority. */
export function accessDecision(
  grant: AccessGrant | undefined,
  now: Date,
  required: ReportPermission,
): { ok: true; grantId: string } | { ok: false; reason: AccessDenial } {
  if (!grant) return { ok: false, reason: 'missing' };
  if (grant.revokedAt && grant.revokedAt <= now) {
    return { ok: false, reason: 'revoked' };
  }
  if (grant.expiresAt && grant.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }
  if (grant.permission !== required) {
    return { ok: false, reason: 'wrong_permission' };
  }
  return { ok: true, grantId: grant.id };
}

export function isReportPermission(value: string): value is ReportPermission {
  return (REPORT_PERMISSIONS as readonly string[]).includes(value);
}

const MACHINE_TOKEN = /^oren_rpt_[A-Za-z0-9_-]{40,}$/;

export function isMachineToken(token: string): boolean {
  return MACHINE_TOKEN.test(token);
}

/** Local manual CLI only. Production apply is refused unless an operator opts in. */
export function manualDatabaseAllowed(input: {
  postgresUrl: string;
  deploymentEnv?: string;
  allowProduction: boolean;
}): void {
  let host = '';
  try {
    host = new URL(input.postgresUrl).hostname;
  } catch {
    throw new Error('POSTGRES_URL is not a URL');
  }
  const production =
    input.deploymentEnv === 'production' ||
    host === 'oren.finance' ||
    host.endsWith('.oren.finance');
  if (production && !input.allowProduction) {
    throw new Error(
      'Refusing a production database. Provisioning and history import are manual and are not part of deploy.',
    );
  }
}
