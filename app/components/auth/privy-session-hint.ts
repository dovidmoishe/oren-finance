/**
 * Whether this browser may hold a Privy session, read without loading Privy.
 *
 * Privy (react-auth 3.51) restores a session only from its access/refresh
 * tokens in web storage (`privy:token`, `privy:refresh_token`, optionally
 * scoped as `privy:<id>:token`) or, with server cookies, its `privy-session` /
 * `privy-token` cookies. No match means Privy would report signed out, so the
 * app can show Sign in at once instead of downloading the wallet SDK first.
 * Recheck these names after every Privy upgrade. Unknown state counts as a
 * session, which keeps the previous behavior (restore on load).
 */
export const PRIVY_ORIGIN = "https://auth.privy.io";

const TOKEN_KEY = /^privy:(?:[^:]+:)?(?:token|refresh_token|pat|id_token|id-token)$/;
const SESSION_COOKIES = ["privy-session", "privy-token", "privy-refresh-token"];

type KeyedStorage = Pick<Storage, "length" | "key">;

function storageHasToken(storage: KeyedStorage | null | undefined): boolean {
  if (!storage) return false;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && TOKEN_KEY.test(key)) return true;
  }
  return false;
}

function cookieNames(cookie: string): string[] {
  return cookie.split(";").map((part) => part.split("=", 1)[0].trim()).filter(Boolean);
}

export function hasPrivySession(sources: { cookie: string; local?: KeyedStorage | null; session?: KeyedStorage | null }): boolean {
  if (cookieNames(sources.cookie).some((name) => SESSION_COOKIES.includes(name))) return true;
  return storageHasToken(sources.local) || storageHasToken(sources.session);
}

/** Reads the current browser. Blocked or missing storage counts as a possible session. */
export function browserHasPrivySession(): boolean {
  try {
    return hasPrivySession({ cookie: document.cookie, local: window.localStorage, session: window.sessionStorage });
  } catch {
    return true;
  }
}

/** True when a storage event from another tab added or removed a Privy token. */
export function isPrivyTokenKey(key: string | null): boolean {
  return key === null || TOKEN_KEY.test(key);
}
