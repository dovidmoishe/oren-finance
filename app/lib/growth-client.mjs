const IDLE_MS = 30 * 60 * 1000;
const FIELD = /^[A-Za-z0-9._~-]{1,80}$/;

export function readUtms(params) {
  const touch = {
    source: clean(params.get('utm_source')),
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
    content: clean(params.get('utm_content')),
    term: clean(params.get('utm_term')),
  };
  return Object.values(touch).some(Boolean) ? touch : null;
}

export function nextSession(state, now, idleMs = IDLE_MS) {
  const fresh = !state?.sessionId || now - state.sessionSeenAt > idleMs;
  const sessionId = fresh ? cryptoRandom() : state.sessionId;
  return { sessionId, sessionSeenAt: now, fresh };
}

export function nextAttribution(state, utm, nowIso, path) {
  if (!utm) return state ?? {};
  const touch = { ...utm, at: nowIso, path };
  return { ...state, first: state?.first ?? touch, last: touch };
}

export function attributionHeader(state) {
  if (!state?.first && !state?.last) return null;
  const json = JSON.stringify({
    v: 1,
    first: state.first,
    last: state.last,
    visitorId: state.visitorId,
  });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function clean(value) {
  return value && FIELD.test(value) ? value : undefined;
}

function cryptoRandom() {
  return globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000';
}
