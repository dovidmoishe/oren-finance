import { FOMC_MEETINGS, RELEASES } from '../market/calendar/macro-catalog';
import {
  BEA_NOTICE,
  BLS_NOTICE,
  CENSUS_NOTICE,
} from '../market/calendar/market-calendar.copy';
import { fomcRow, releaseRow } from '../market/calendar/market-events.sync';
import { MorningBrief } from './brief';
import { renderBriefEmail, type BriefMarketEvent } from './brief-email';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const settings = 'https://oren.example/app/settings';
const stop = 'https://api.oren.example/stop';

const cpi: BriefMarketEvent = {
  title: 'Consumer Price Index (CPI)',
  agencyId: 'bls',
  agency: 'U.S. Bureau of Labor Statistics',
  scheduledAt: '2026-12-10T13:30:00.000Z',
  timePrecision: 'datetime',
  timeBasis: 'published',
  dateBasis: 'published',
  status: 'released',
  actualText: '+0.3%',
  previousText: '+0.2%',
  sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
  retrievedAt: '2026-12-10T15:15:00.000Z',
};
const fomc: BriefMarketEvent = {
  title: 'FOMC rate decision',
  agencyId: 'frb',
  agency: 'Federal Reserve Board',
  scheduledAt: '2026-12-09T19:00:00.000Z',
  timePrecision: 'datetime',
  timeBasis: 'customary',
  dateBasis: 'published',
  status: 'scheduled',
  actualText: null,
  previousText: null,
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  retrievedAt: null,
};
const claims: BriefMarketEvent = {
  title: 'Initial jobless claims',
  agencyId: 'dol',
  agency: 'U.S. Department of Labor',
  scheduledAt: '2026-12-10T13:30:00.000Z',
  timePrecision: 'datetime',
  timeBasis: 'customary',
  dateBasis: 'computed',
  status: 'scheduled',
  actualText: null,
  previousText: null,
  sourceUrl: 'https://oui.doleta.gov/unemploy/claims.asp',
  retrievedAt: null,
};

describe('morning brief official US data', () => {
  it('lists official prints in the reader zone with the agency notices', () => {
    const email = renderBriefEmail(
      {
        date: '2026-12-09',
        zone: 'America/New_York',
        moves: [],
        stories: [],
        events: [fomc, cpi],
      },
      settings,
      stop,
    );
    expect(email.text).toContain(
      'Official US data: today and the next 48 hours',
    );
    expect(email.text).toContain(
      'Wed, Dec 9, usually 2:00 PM EST · FOMC rate decision',
    );
    expect(email.text).toContain(
      'Thu, Dec 10, 8:30 AM EST · Consumer Price Index (CPI)',
    );
    expect(email.text).toContain(
      'U.S. Bureau of Labor Statistics · Actual +0.3% · Previous +0.2%',
    );
    expect(email.text).toContain(BLS_NOTICE);
    expect(email.text).toContain(
      'Published values retrieved from the agencies on Thu, Dec 10.',
    );
    expect(email.html).toContain(
      'Official US data: today and the next 48 hours',
    );
    expect(email.html).toContain(
      'href="https://www.bls.gov/schedule/news_release/cpi.htm"',
    );
    expect(email.html).toContain(BLS_NOTICE);
    for (const body of [email.text, email.html]) {
      expect(body).not.toMatch(/consensus|forecast|FRED/i);
      expect(body).not.toContain(BEA_NOTICE);
      expect(body).not.toContain(CENSUS_NOTICE);
    }

    const lagos = renderBriefEmail(
      {
        date: '2026-12-10',
        zone: 'Africa/Lagos',
        moves: [],
        stories: [],
        events: [cpi],
      },
      settings,
      stop,
    );
    expect(lagos.text).toContain('Thu, Dec 10, 2:30 PM GMT+1');
  });

  it('credits only the agencies in the block and says "usually" for computed dates', () => {
    const email = renderBriefEmail(
      {
        date: '2026-12-09',
        zone: 'America/New_York',
        moves: [],
        stories: [],
        events: [fomc, claims],
      },
      settings,
      stop,
    );
    expect(email.text).toContain(
      'Thu, Dec 10, usually 8:30 AM EST · Initial jobless claims',
    );
    expect(email.text).not.toContain(BLS_NOTICE);
    expect(email.text).not.toMatch(/retrieved|not endorsed or certified/);
  });

  it('leaves the block and the notices out when there is nothing official', () => {
    for (const events of [
      undefined,
      [],
      [{ ...cpi, sourceUrl: 'http://insecure.example' }],
    ]) {
      const email = renderBriefEmail(
        { date: '2026-12-10', moves: [], stories: [], events },
        settings,
        stop,
      );
      expect(email.text).not.toContain('Official US data');
      expect(email.text).not.toContain(BLS_NOTICE);
      expect(email.html).not.toContain(BLS_NOTICE);
    }
  });

  it('passes the next 48 hours of stored releases into the queued email', async () => {
    // 08:00 in New York on FOMC decision day. Only the clock is faked.
    jest.useFakeTimers({
      now: new Date('2026-12-09T13:00:00Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
      ],
    });
    const saved = { ...process.env };
    Object.assign(process.env, {
      DEPLOYMENT_ENV: 'development',
      NOTIFICATION_FIXTURE_MODE: 'false',
      NOTIFICATION_APP_ORIGIN: 'https://oren.example',
      NOTIFICATION_API_ORIGIN: 'https://api.oren.example',
      NOTIFICATION_UNSUBSCRIBE_SECRET: 's'.repeat(32),
      MORNING_BRIEF_ENABLED: 'true',
      NOTIFICATION_PILOT_USERS: '',
    });
    const cpiRelease = RELEASES.find((release) => release.kind === 'cpi')!;
    const stored = (row: ReturnType<typeof releaseRow>, status: string) => ({
      ...row,
      id: row.sourceEventId,
      family: 'macro',
      country: 'US',
      dateStatus: status,
      actual: null,
      previous: null,
      unit: null,
      fetchedAt: new Date(),
      updatedAt: new Date(),
    });
    const listRange = jest.fn().mockResolvedValue([
      stored(
        fomcRow(FOMC_MEETINGS.find((m) => m.end === '2026-12-09')!),
        'scheduled',
      ),
      stored(
        releaseRow(cpiRelease, '2026-12-10', {
          period: '2026-11',
          label: 'November 2026',
        }),
        'cancelled',
      ),
    ]);
    const queueBriefEmail = jest.fn().mockResolvedValue(undefined);
    const brief = new MorningBrief(
      {
        scheduleFor: jest.fn().mockResolvedValue({
          brief_time: '08:00',
          time_zone: 'America/New_York',
          brief_wallet: null,
          brief_wallet_since: null,
        }),
        update: jest.fn().mockResolvedValue(undefined),
        queueBriefEmail,
      } as never,
      {
        getNotificationIdentity: jest
          .fn()
          .mockResolvedValue({ email: 'person@example.com', wallet: null }),
      } as never,
      {} as never,
      {} as never,
      {
        findSectorCandidates: jest.fn().mockResolvedValue({
          items: [
            {
              id: 'nvidia',
              sortRank: 0,
              sectorId: 'semiconductors',
              interestId: 'semiconductors',
            },
          ],
        }),
      } as never,
      { getSectors: jest.fn().mockResolvedValue(['semiconductors']) } as never,
      {
        getRecentNews: jest.fn().mockResolvedValue([
          {
            headline: 'Chipmakers rally',
            url: 'https://news.example/chips',
            publishedAt: new Date(),
            source: 'Wire',
            ticker: 'NVDA',
          },
        ]),
      } as never,
      null,
      { OPENAI_MODEL: 'gpt-5-mini' } as never,
      { listRange } as never,
    );
    try {
      await brief.build({
        id: 'c1bdb5a5-22d1-43ac-b125-c30466655829',
        user_id: 'reader',
        kind: 'brief',
        attempts: 1,
        lease_token: 'lease',
        logical_key: 'brief-reader-2026-12-09',
        payload: {
          date: '2026-12-09',
          time: '08:00',
          zone: 'America/New_York',
          scheduled: new Date().toISOString(),
        },
      });
      const [from, to] = listRange.mock.calls[0] as [Date, Date];
      expect(from.toISOString()).toBe('2026-12-09T05:00:00.000Z');
      expect(to.getTime() - Date.now()).toBeLessThanOrEqual(48 * 3_600_000);
      const body = (queueBriefEmail.mock.calls as unknown[][])[0][1] as {
        events: BriefMarketEvent[];
      };
      expect(body.events).toEqual([
        {
          title: 'FOMC rate decision',
          agencyId: 'frb',
          agency: 'Federal Reserve Board',
          scheduledAt: '2026-12-09T19:00:00.000Z',
          timePrecision: 'datetime',
          timeBasis: 'customary',
          dateBasis: 'published',
          status: 'scheduled',
          actualText: null,
          previousText: null,
          sourceUrl:
            'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
          retrievedAt: null,
        },
      ]);
    } finally {
      process.env = saved;
      jest.useRealTimers();
    }
  });
});
