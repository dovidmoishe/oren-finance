import postgres from 'postgres';
import { deploymentCapabilities } from '../../config/deployment';
import type { AppEnv } from '../../config/env.schema';
import { secUserAgent } from './sec-client';

/** Session lock so only one production process on this database calls EDGAR. */
export const SEC_WORKER_LOCK_KEY = 87261001;

const CONTACT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type SecAccess =
  | { enabled: true; userAgent: string }
  | {
      enabled: false;
      reason:
        | 'sec_not_configured'
        | 'sec_preview_disabled'
        | 'sec_worker_unavailable';
    };

export function secContact(value: string | undefined): string | undefined {
  const email = value?.trim() ?? '';
  if (!email || email.length > 254 || !CONTACT.test(email)) return undefined;
  return email;
}

/**
 * Live EDGAR fetches run only from one production process with an operator
 * supplied contact. Previews share the production IP and do not fetch.
 * An invalid or missing contact disables fetches rather than inventing one.
 */
export function secEdgarAccess(
  env: Pick<AppEnv, 'DEPLOYMENT_ENV' | 'SEC_CONTACT_EMAIL'> & {
    NODE_ENV?: string;
    NODE_APP_INSTANCE?: string;
    WEB_CONCURRENCY?: string;
  },
): SecAccess {
  const deployment = deploymentCapabilities(env);
  if (deployment.environment === 'preview') {
    return { enabled: false, reason: 'sec_preview_disabled' };
  }
  if (deployment.environment !== 'production') {
    return { enabled: false, reason: 'sec_not_configured' };
  }
  const email = secContact(env.SEC_CONTACT_EMAIL);
  if (!email) return { enabled: false, reason: 'sec_not_configured' };
  if (env.NODE_APP_INSTANCE && env.NODE_APP_INSTANCE !== '0') {
    return { enabled: false, reason: 'sec_worker_unavailable' };
  }
  const workers = Number(env.WEB_CONCURRENCY ?? '1');
  if (!Number.isInteger(workers) || workers !== 1) {
    return { enabled: false, reason: 'sec_worker_unavailable' };
  }
  return { enabled: true, userAgent: secUserAgent(email) };
}

export async function tryHoldSecWorkerLock(
  databaseUrl: string,
  connect: (url: string) => Promise<{
    locked: boolean;
    close: () => Promise<void>;
  }> = connectPostgres,
): Promise<boolean> {
  const session = await connect(databaseUrl);
  if (!session.locked) {
    await session.close();
    return false;
  }
  return true;
}

async function connectPostgres(
  url: string,
): Promise<{ locked: boolean; close: () => Promise<void> }> {
  const sql = postgres(url, { max: 1 });
  const rows = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SEC_WORKER_LOCK_KEY}) AS locked
  `;
  const locked = rows[0]?.locked === true;
  if (!locked) await sql.end({ timeout: 5 });
  return { locked, close: () => sql.end({ timeout: 5 }) };
}
