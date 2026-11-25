'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { buildApiUrl } from '@/services/api-client';
import { analyticsAllowed } from '@/lib/consent';
import { useConsent } from '@/lib/use-consent';
import { nextAttribution, nextSession, readUtms, attributionHeader, referrerOrigin } from '@/lib/growth-client.mjs';

const KEY = 'oren.growth.v1';

// document.referrer belongs to the page load, and client-side navigations keep it.
// Only the load's first pageview reports where the visitor came from.
let landingReferrerSent = false;
function landingReferrer() {
  if (landingReferrerSent) return undefined;
  landingReferrerSent = true;
  return referrerOrigin(document.referrer);
}

/**
 * Anonymous page and setup collection. Failures stay on the page. Nothing is
 * stored or sent until the visitor accepts analytics; accepting counts the
 * current page, and refusing deletes the saved visitor state.
 */
export function GrowthCollector() {
  const pathname = usePathname();
  const consent = useConsent();
  useEffect(() => {
    if (consent !== 'granted') return;
    const state = load();
    const now = Date.now();
    const session = nextSession(state, now);
    const utm = readUtms(new URLSearchParams(window.location.search));
    const next = nextAttribution(
      { ...state, sessionId: session.sessionId, sessionSeenAt: session.sessionSeenAt, visitorId: state.visitorId ?? crypto.randomUUID() },
      utm,
      new Date(now).toISOString(),
      pathname,
    );
    save({ ...next, sessionId: session.sessionId, sessionSeenAt: session.sessionSeenAt });
    void send({
      eventId: crypto.randomUUID(),
      event: 'pageview',
      occurredAt: new Date(now).toISOString(),
      path: pathname,
      visitorId: next.visitorId,
      sessionId: session.sessionId,
      host: window.location.host,
      referrer: landingReferrer(),
      userAgent: navigator.userAgent,
      utm: utm ?? undefined,
    });
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href="#setup"]');
      if (!link || window.location.pathname !== '/agents') return;
      const current = load();
      void send({
        eventId: crypto.randomUUID(),
        event: 'setup_cta',
        occurredAt: new Date().toISOString(),
        path: '/agents',
        visitorId: current.visitorId,
        sessionId: current.sessionId,
        host: window.location.host,
        userAgent: navigator.userAgent,
        action: 'open_setup',
        slot: 'setup',
        utm: current.last,
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [pathname, consent]);
  return null;
}

export function trackSetup(action: string, slot: string) {
  if (!analyticsAllowed()) return;
  const current = load();
  if (!current.visitorId || !current.sessionId) return;
  void send({
    eventId: crypto.randomUUID(),
    event: 'setup_cta',
    occurredAt: new Date().toISOString(),
    path: '/agents',
    visitorId: current.visitorId,
    sessionId: current.sessionId,
    host: window.location.host,
    userAgent: navigator.userAgent,
    action,
    slot,
    utm: current.last,
  });
}

export function consentAttributionHeader(): Record<string, string> {
  if (!analyticsAllowed()) return {};
  const header = attributionHeader(load());
  return header ? { 'X-Oren-Attribution': header } : {};
}

async function send(body: Record<string, unknown>) {
  try {
    await fetch(buildApiUrl('/growth/collect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Collection never blocks the page.
  }
}

interface GrowthState {
  visitorId?: string;
  sessionId?: string;
  sessionSeenAt?: number;
  first?: Record<string, string>;
  last?: Record<string, string>;
}

function load(): GrowthState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as GrowthState;
  } catch {
    return {};
  }
}

function save(state: GrowthState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode can reject storage. The page still works.
  }
}
