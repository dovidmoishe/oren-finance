import { Temporal } from '@js-temporal/polyfill';

export const MINUTE_MS = 60_000;
export const BRIEF_GRACE_MS = 120 * MINUTE_MS;

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
