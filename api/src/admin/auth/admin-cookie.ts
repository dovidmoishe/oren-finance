import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'oren_admin_session';
export const ADMIN_HEADER = 'x-oren-admin';
export const CSRF_HEADER = 'x-csrf-token';

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function secretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=') || undefined;
  }
  return undefined;
}

export function sessionCookie(
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${ADMIN_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/admin',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie('', 0, secure);
}
