import { Temporal } from '@js-temporal/polyfill';

export const MINUTE_MS = 60_000;
export const BRIEF_GRACE_MS = 120 * MINUTE_MS;
/** Due preferences read per scheduler pass. Not the whole opted-in population. */
export const BRIEF_SCHEDULE_BATCH = 100;

/**
 * Email slots a Morning Brief may consume in one minute.
 * Matches delivery: when alerts are also on and the budget is larger than one,
 * briefs keep 80% and leave the rest for alert mail.
 */
export function briefEmailSlots(emailPerMinute: number, alertsOn: boolean) {
  if (emailPerMinute < 1) return 0;
  if (alertsOn && emailPerMinute > 1) return Math.floor(emailPerMinute * 0.8);
  return emailPerMinute;
}

/**
 * Tokens.xyz snapshot calls a brief may start each minute.
 * Price scans share `tokens-snapshots`, so an alert-enabled worker leaves the
 * other half of the budget for those scans (at least one call when the budget
 * is a single shared slot).
 */
export function briefSnapshotSlots(tokensPerMinute: number, alertsOn: boolean) {
  if (tokensPerMinute < 1) return 0;
  if (!alertsOn) return tokensPerMinute;
  return Math.max(1, Math.floor(tokensPerMinute / 2));
}

/** New brief jobs admitted per minute so a shared clock time can finish inside BRIEF_GRACE_MS. */
export function briefAdmitPerMinute(config: {
  alerts: boolean;
  tokensPerMinute: number;
  emailPerMinute: number;
}) {
  return Math.min(
    briefEmailSlots(config.emailPerMinute, config.alerts),
    briefSnapshotSlots(config.tokensPerMinute, config.alerts),
  );
}

export function localDate(at: Date, zone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}

export function nextBrief(after: Date, time: string, zone: string): Date {
  const initial = Temporal.PlainDate.from(localDate(after, zone));
  for (let day = 0; day < 3; day++) {
    const date = initial.add({ days: day });
    const requested = date.toPlainDateTime(time);
    let wall = requested;
    // The earlier offset is the first occurrence for repeated times. For a
    // gap, walk to the first real wall-clock minute (rather than shifting by
    // the length of the gap, e.g. 02:30 -> 03:30).
    for (
      let minute = 0;
      minute <= 1440 && wall.toPlainDate().equals(date);
      minute++
    ) {
      const zoned = wall.toZonedDateTime(zone, { disambiguation: 'earlier' });
      if (zoned.toPlainDateTime().equals(wall)) {
        if (zoned.epochMilliseconds > after.getTime())
          return new Date(zoned.epochMilliseconds);
        break;
      }
      wall = wall.add({ minutes: 1 });
    }
  }
  throw new Error('Unable to calculate next brief schedule');
}
