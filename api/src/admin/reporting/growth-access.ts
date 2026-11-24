export const MARKETING_BOT_PRINCIPAL = 'marketing_bot';
export const MARKETING_BOT_READ = 'marketing.bot.read';

export interface AccessGrant {
  id: string;
  principalKind: string;
  permission: string;
  revokedAt?: Date | null;
  expiresAt?: Date | null;
}

export type AccessDenial =
  'missing' | 'revoked' | 'expired' | 'not_marketing_bot' | 'wrong_permission';

/**
 * Report reads succeed only for the designated marketing-bot principal and
 * its read permission. A human grant, an owner, a future admin, or another
 * machine principal does not pass, even if the permission string matches.
 */
export function accessDecision(
  grant: AccessGrant | undefined,
  now: Date,
): { ok: true; grantId: string } | { ok: false; reason: AccessDenial } {
  if (!grant) return { ok: false, reason: 'missing' };
  if (grant.revokedAt) {
    return { ok: false, reason: 'revoked' };
  }
  if (grant.expiresAt && grant.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }
  if (grant.principalKind !== MARKETING_BOT_PRINCIPAL) {
    return { ok: false, reason: 'not_marketing_bot' };
  }
  if (grant.permission !== MARKETING_BOT_READ) {
    return { ok: false, reason: 'wrong_permission' };
  }
  return { ok: true, grantId: grant.id };
}

const MACHINE_TOKEN = /^oren_rpt_[A-Za-z0-9_-]{40,}$/;

export function isMachineToken(token: string): boolean {
  return MACHINE_TOKEN.test(token);
}

/** A browser Origin is not a report client. The bot calls the API from its own server. */
export function browserReportRequest(origin: string | undefined): boolean {
  return typeof origin === 'string' && origin.length > 0;
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
