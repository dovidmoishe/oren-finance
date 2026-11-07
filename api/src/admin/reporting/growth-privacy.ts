import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const FORBIDDEN_KEY =
  /^(user_?id|email|wallet|walletaddress|client_?ip|remote_?ip|ip|authorization|cookie|visitorid|useragent|rawua|prompt|payload|privy)$/i;

/** Peppered one-way id. Reports never return the hash or the source id. */
export function digest(pepper: string, ...parts: string[]): string {
  return createHash('sha256')
    .update([pepper, ...parts].join('|'))
    .digest('hex');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newMachineToken(): string {
  return `oren_rpt_${randomBytes(32).toString('base64url')}`;
}

export function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function referrerHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).host.toLowerCase();
    return host.length > 0 && host.length <= 200 ? host : null;
  } catch {
    return null;
  }
}

export function assertPublicReport(value: unknown): void {
  walk(value, '$');
}

function walk(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && looksPersonal(value)) {
      throw new Error(`report leak at ${path}`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`report leak ${path}.${key}`);
    walk(nested, `${path}.${key}`);
  }
}

function looksPersonal(value: string): boolean {
  return (
    value.includes('did:privy:') ||
    value.includes('oren_rpt_') ||
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
  );
}
