import type { MacroEventKind, MarketEvent } from '../../types/market-calendar';
import {
  isOfficialAgencyId,
  officialAttribution,
} from '../market/calendar/market-calendar.copy';

/** Minutes before the release that the reminder email goes out. */
export const REMINDER_LEAD_MINUTES = 15;

/** What a queued reminder email needs, taken from the event when it was queued. */
export type ReminderEmailFacts = Pick<
  MarketEvent,
  | 'kind'
  | 'title'
  | 'agencyId'
  | 'agency'
  | 'scheduledAt'
  | 'dateEt'
  | 'timeBasis'
  | 'referenceLabel'
  | 'sourceUrl'
> & { reminderId: string; eventId: string };

/** The same names the Calendar shows, with the verb each one takes. */
const RELEASE_NAMES: Record<MacroEventKind, { name: string; verb: string }> = {
  fomc_decision: { name: 'The Fed rate decision', verb: 'is announced' },
  cpi: { name: 'CPI inflation', verb: 'is released' },
  employment_situation: { name: 'The jobs report', verb: 'is released' },
  gdp: { name: 'GDP', verb: 'is released' },
  pce: { name: 'PCE inflation', verb: 'is released' },
  ppi: { name: 'PPI inflation', verb: 'is released' },
  retail_sales: { name: 'Retail sales', verb: 'are released' },
  jobless_claims: { name: 'Jobless claims', verb: 'are released' },
};

const NEW_YORK = 'America/New_York';
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK,
  hour: 'numeric',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

// Newer ICU data puts a narrow no-break space before AM/PM.
const plain = (value: string) => value.replace(/[\u202f\u00a0]/g, ' ');

function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    return undefined;
  }
}

/** Plain-text reminder. Calm copy, New York time, and the agency's own notice. */
export function reminderEmail(
  facts: ReminderEmailFacts,
  app: string,
  stop: string,
) {
  const at = new Date(facts.scheduledAt);
  const time = `${plain(clock.format(at))} ET`;
  const release = RELEASE_NAMES[facts.kind] ?? {
    name: facts.title,
    verb: 'is released',
  };
  const [verb, participle] = release.verb.split(' ');
  const usually = facts.timeBasis === 'customary' ? 'usually ' : '';
  const lead = `${release.name} ${verb} ${usually}${participle} at ${time}.`;
  const what = [facts.title, facts.referenceLabel].filter(Boolean).join(', ');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(facts.dateEt) ? facts.dateEt : '';
  const calendar = `${app}/app/calendar${date ? `?date=${date}` : ''}`;
  const schedule = httpsUrl(facts.sourceUrl);
  const notices = isOfficialAgencyId(facts.agencyId)
    ? officialAttribution([facts.agencyId]).notices
    : [];
  return {
    subject: `Oren reminder · ${release.name} at ${time}`,
    text: [
      lead,
      `${what}. From the ${facts.agency.replace(/^the /i, '')} on ${plain(day.format(at))}.`,
      `See the day in Oren: ${calendar}`,
      schedule ? `Agency schedule: ${schedule}` : '',
      ...notices,
      `Stop release reminder emails: ${stop}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
