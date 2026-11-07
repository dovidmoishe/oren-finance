export function readUtms(
  params: URLSearchParams,
): { source?: string; medium?: string; campaign?: string; content?: string; term?: string } | null;
export function nextSession(
  state: { sessionId?: string; sessionSeenAt?: number } | undefined,
  now: number,
  idleMs?: number,
): { sessionId: string; sessionSeenAt: number; fresh: boolean };
export function nextAttribution(
  state: Record<string, unknown> | undefined,
  utm: Record<string, string | undefined> | null,
  nowIso: string,
  path: string,
): Record<string, unknown>;
export function attributionHeader(state: {
  first?: unknown;
  last?: unknown;
  visitorId?: string;
}): string | null;
