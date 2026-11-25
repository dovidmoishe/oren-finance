/**
 * Analytics consent. Essential storage (sign-in, theme, language and this
 * choice itself) never waits for it; visit analytics and performance timings do.
 */
export type ConsentChoice = "granted" | "denied";

export const CONSENT_COOKIE = "oren-consent";
const VERSION = "1";
/** Ask again after about six months. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 182;
/** Analytics state that a refusal removes from this browser. */
export const ANALYTICS_STORAGE_KEYS = ["oren.growth.v1"] as const;
/** Fired when someone reopens the choice, so the notice can take focus. */
export const CONSENT_OPEN_EVENT = "oren-consent-open";

type PrivacyNavigator = { globalPrivacyControl?: boolean; doNotTrack?: string | null };

export function parseConsent(value: string | null | undefined): ConsentChoice | undefined {
  if (value === `${VERSION}.granted`) return "granted";
  if (value === `${VERSION}.denied`) return "denied";
  return undefined;
}

/** Reads the saved choice from a `document.cookie` string. */
export function consentFromCookie(cookie: string): ConsentChoice | undefined {
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== CONSENT_COOKIE) continue;
    return parseConsent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** Global Privacy Control and Do Not Track count as a refusal, without asking. */
export function hasPrivacySignal(nav: PrivacyNavigator | undefined): boolean {
  return nav?.globalPrivacyControl === true || nav?.doNotTrack === "1";
}

// Runs in <head> before paint: marks the page so the server-rendered notice
// shows with the first frame (no pop-in after hydration, no layout shift).
// Keep the cookie format in step with parseConsent.
export const consentBootScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)/),v=m&&m[1],n=navigator;if(v!=="${VERSION}.granted"&&v!=="${VERSION}.denied"&&!(n.globalPrivacyControl===true||n.doNotTrack==="1"))document.documentElement.dataset.consent="pending"}catch(e){}})();`;

let snapshot: ConsentChoice | undefined | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

function readDocument(): ConsentChoice | undefined {
  try {
    const saved = consentFromCookie(document.cookie);
    if (saved) return saved;
  } catch {
    // Cookies can be blocked; fall through to the browser signal.
  }
  return hasPrivacySignal(typeof navigator === "undefined" ? undefined : navigator) ? "denied" : undefined;
}

function notify() {
  for (const listener of listeners) listener();
}

/** Tabs that share the cookie hear each other's choice without storing anything new. */
function connect() {
  if (channel !== undefined) return;
  channel = null;
  try {
    channel = new BroadcastChannel("oren-consent");
    channel.onmessage = () => {
      snapshot = null;
      if (currentConsent()) delete document.documentElement.dataset.consent;
      notify();
    };
  } catch {
    // Older browsers keep the choice per tab until reload.
  }
}

/** The saved choice, a refusal from a browser privacy signal, or undecided. */
export function currentConsent(): ConsentChoice | undefined {
  if (typeof document === "undefined") return undefined;
  if (snapshot === null) snapshot = readDocument();
  return snapshot;
}

export function analyticsAllowed(): boolean {
  return currentConsent() === "granted";
}

export function subscribeConsent(listener: () => void): () => void {
  connect();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function forgetAnalytics() {
  try {
    for (const key of ANALYTICS_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; nothing was saved then.
  }
}

export function setConsent(choice: ConsentChoice) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${CONSENT_COOKIE}=${VERSION}.${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // Blocked cookies: the choice still applies until this page closes.
  }
  if (choice === "denied") forgetAnalytics();
  delete document.documentElement.dataset.consent;
  snapshot = choice;
  notify();
  try {
    channel?.postMessage(choice);
  } catch {
    // Another tab will read the cookie on its next load.
  }
}

/** Shows the notice again so a choice can be changed or withdrawn. */
export function openConsentSettings() {
  document.documentElement.dataset.consent = "pending";
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}
