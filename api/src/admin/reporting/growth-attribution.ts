export type AttributionModel = 'first' | 'last';

export interface UtmTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  at: string;
  path?: string;
}

export interface AttributionState {
  first?: UtmTouch;
  last?: UtmTouch;
  visitorId?: string;
}

const FIELD = /^[A-Za-z0-9._~-]{1,80}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cleanUtm(input: {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}): Omit<UtmTouch, 'at' | 'path'> | null {
  const touch = {
    source: clean(input.source ?? input.utm_source),
    medium: clean(input.medium ?? input.utm_medium),
    campaign: clean(input.campaign ?? input.utm_campaign),
    content: clean(input.content ?? input.utm_content),
    term: clean(input.term ?? input.utm_term),
  };
  if (
    !touch.source &&
    !touch.medium &&
    !touch.campaign &&
    !touch.content &&
    !touch.term
  ) {
    return null;
  }
  return touch;
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!FIELD.test(trimmed)) return undefined;
  if (/oren_rpt_|did:privy|bearer\s/i.test(trimmed)) return undefined;
  return trimmed;
}

/** First touch sticks. Last touch moves. Empty visits do not erase a touch. */
export function applyTouch(
  state: AttributionState,
  touch: Omit<UtmTouch, 'at'> & { at: string },
): AttributionState {
  return {
    first: state.first ?? touch,
    last: touch,
  };
}

export function touchInWindow(
  touch: UtmTouch | undefined,
  at: Date,
  windowDays: number,
): UtmTouch | undefined {
  if (!touch) return undefined;
  const touched = Date.parse(touch.at);
  if (Number.isNaN(touched)) return undefined;
  const age = at.getTime() - touched;
  if (age < 0 || age > windowDays * 24 * 60 * 60 * 1000) return undefined;
  return touch;
}

export function chosenTouch(
  state: AttributionState,
  model: AttributionModel,
  at: Date,
  windowDays: number,
): UtmTouch | undefined {
  const preferred = model === 'first' ? state.first : state.last;
  return (
    touchInWindow(preferred, at, windowDays) ??
    touchInWindow(model === 'first' ? state.last : state.first, at, windowDays)
  );
}

export function encodeAttribution(state: AttributionState): string | null {
  if (!state.first && !state.last) return null;
  return Buffer.from(
    JSON.stringify({
      v: 1,
      first: state.first,
      last: state.last,
      visitorId: state.visitorId,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeAttribution(
  header: string | undefined,
): AttributionState {
  if (!header || header.length > 1500) return {};
  try {
    const parsed = JSON.parse(
      Buffer.from(header, 'base64url').toString('utf8'),
    ) as { v?: number; first?: UtmTouch; last?: UtmTouch; visitorId?: string };
    if (parsed.v !== 1) return {};
    return {
      first: validTouch(parsed.first),
      last: validTouch(parsed.last),
      visitorId: UUID.test(parsed.visitorId ?? '')
        ? parsed.visitorId
        : undefined,
    };
  } catch {
    return {};
  }
}

function validTouch(touch: UtmTouch | undefined): UtmTouch | undefined {
  if (!touch || typeof touch.at !== 'string') return undefined;
  const cleaned = cleanUtm(touch);
  if (!cleaned || Number.isNaN(Date.parse(touch.at))) return undefined;
  return { ...cleaned, at: new Date(touch.at).toISOString(), path: touch.path };
}
