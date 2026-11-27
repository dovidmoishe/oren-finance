import type {
  MarketEventDateBasis,
  MarketEventStatus,
  MarketEventTimeBasis,
  MarketEventTimePrecision,
  OfficialAgencyId,
} from '../../types/market-calendar';
import { officialAttribution } from '../market/calendar/market-calendar.copy';

/** An official US release, already formatted by the market calendar. */
export type BriefMarketEvent = {
  title: string;
  agencyId: OfficialAgencyId;
  agency: string;
  scheduledAt: string;
  timePrecision: MarketEventTimePrecision;
  timeBasis: MarketEventTimeBasis;
  dateBasis?: MarketEventDateBasis;
  status: MarketEventStatus;
  actualText: string | null;
  previousText: string | null;
  sourceUrl: string;
  /** When Oren retrieved the published value; BLS asks that it be cited. */
  retrievedAt?: string | null;
};

export type BriefEmailFacts = {
  date: string;
  zone?: string;
  value?: number;
  valueVerified?: boolean;
  pnl?: number | null;
  narrative?: string | null;
  hasHoldings?: boolean;
  moves: { ticker: string; usd: number }[];
  stories: {
    headline: string;
    url: string;
    source?: string;
    summary?: string;
    ticker?: string;
  }[];
  events?: BriefMarketEvent[];
};

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const money = (amount: number) => currency.format(amount);
const change = (amount: number) =>
  amount > 0 ? '+' + money(amount) : money(amount);
const dateLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

function eventClock(zone: string | undefined) {
  const options = (timeZone: string) => ({
    day: new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  });
  try {
    return options(zone || 'America/New_York');
  } catch {
    return options('America/New_York');
  }
}

function storyLink(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    return undefined;
  }
}

export function renderBriefEmail(
  facts: BriefEmailFacts,
  settings: string,
  stop: string,
) {
  const date = dateLabel.format(new Date(facts.date + 'T00:00:00Z'));
  const logo = new URL('/oren-email-mark.png', settings).href;
  const { pnl, value } = facts;
  const lead = facts.moves[0];
  const stories = facts.stories.flatMap((story) => {
    const url = storyLink(story.url);
    return url ? [{ ...story, url }] : [];
  });
  const leadStory = stories[0];
  const clock = eventClock(facts.zone);
  const events = (facts.events ?? []).flatMap((event) => {
    const url = storyLink(event.sourceUrl);
    const at = new Date(event.scheduledAt);
    if (!url || Number.isNaN(at.getTime())) return [];
    const day = clock.day.format(at);
    const usually =
      event.timeBasis === 'customary' || event.dateBasis === 'computed';
    const when =
      event.timePrecision === 'date'
        ? day
        : `${day}, ${usually ? 'usually ' : ''}${clock.time.format(at)}`;
    const result = [
      event.actualText ? `Actual ${event.actualText}` : '',
      event.previousText ? `Previous ${event.previousText}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return [{ ...event, url, when, result }];
  });
  const retrieved = events
    .flatMap((event) =>
      event.actualText && event.retrievedAt
        ? [new Date(event.retrievedAt)]
        : [],
    )
    .filter((at) => !Number.isNaN(at.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  // Each agency's required notice, plus the retrieval date BLS asks for.
  const eventCredit = [
    ...officialAttribution(events.map((event) => event.agencyId)).notices,
    retrieved
      ? `Published values retrieved from the agencies on ${clock.day.format(retrieved)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const marketRead = !leadStory
    ? ''
    : leadStory.ticker
      ? `On my radar this morning: ${leadStory.ticker}.`
      : facts.hasHoldings
        ? 'I pulled the stories most relevant to the stocks you hold.'
        : 'I pulled a few headlines from the sectors you follow.';
  const performanceRead =
    pnl == null
      ? facts.hasHoldings
        ? 'I’m still waiting on the data I need to verify your daily performance.'
        : ''
      : pnl === 0
        ? 'Your tracked portfolio was flat after accounting for deposits and withdrawals.'
        : `Your tracked portfolio was ${pnl > 0 ? 'up' : 'down'} ${money(Math.abs(pnl))} after accounting for deposits and withdrawals.`;
  const moveRead = lead
    ? `${lead.ticker} made the biggest move in your starting holdings, with a ${change(lead.usd)} price impact.`
    : '';
  const newsFirst =
    facts.narrative === 'holdings-news' || facts.narrative === 'sector-news';
  const portfolioRead = [performanceRead, moveRead].filter(Boolean).join(' ');
  const note =
    (newsFirst ? [marketRead, portfolioRead] : [portfolioRead, marketRead])
      .filter(Boolean)
      .join(' ') || 'Here’s your Oren wallet snapshot for this morning.';
  const subject =
    pnl != null && pnl !== 0
      ? `Morning Brief · Portfolio ${pnl > 0 ? 'up' : 'down'} ${money(Math.abs(pnl))}`
      : 'Morning Brief from Oren';
  const snapshot = [
    ...(value == null
      ? []
      : [
          {
            label: facts.valueVerified
              ? 'Tracked wallet value'
              : 'Estimated wallet value',
            amount: money(value),
            color: '#1c1921',
          },
        ]),
    ...(pnl == null
      ? []
      : [
          {
            label: 'Daily P&L',
            amount: change(pnl),
            color: pnl < 0 ? '#9f313d' : pnl > 0 ? '#176044' : '#1c1921',
          },
        ]),
  ];
  const snapshotDetail = [
    value == null ? '' : 'Includes tracked stocks and USDC.',
    pnl == null && (facts.hasHoldings || value != null)
      ? 'Daily P&L is unavailable.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const signoff = 'Oren · Your investment copilot';
  const storyContext = (story: (typeof stories)[number]) =>
    [story.ticker, story.source].filter(Boolean).join(' · ');
  const text = [
    date,
    'Good morning,',
    note,
    snapshot.length
      ? [
          ...snapshot.map(({ label, amount }) => label + ' — ' + amount),
          snapshotDetail,
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    facts.moves.length
      ? [
          'What moved your portfolio',
          ...facts.moves.map(({ ticker, usd }) => ticker + '  ' + change(usd)),
        ].join('\n')
      : '',
    stories.length
      ? [
          'On my radar',
          ...stories.map((story) =>
            [storyContext(story), story.headline, story.summary, story.url]
              .filter(Boolean)
              .join('\n'),
          ),
        ].join('\n\n')
      : '',
    events.length
      ? [
          'Official US data: today and the next 48 hours',
          ...events.map((event) =>
            [
              `${event.when} · ${event.title}`,
              [event.agency, event.result].filter(Boolean).join(' · '),
              event.url,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
          eventCredit,
        ]
          .filter(Boolean)
          .join('\n\n')
      : '',
    signoff,
    `Open Oren: ${new URL('/app', settings).href}\nEmail preferences: ${settings}\nUnsubscribe: ${stop}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Layout tables and inline styles keep the layout intact in email clients.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1f5;color:#1c1921;font-family:Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(note)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e9e2eb;border-radius:18px">
<tr><td style="padding:29px 26px 32px;background:#221b2a;color:#ffffff;border-radius:17px 17px 0 0">
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px"><tr><td style="padding-right:9px"><img src="${escape(logo)}" alt="" width="34" height="34" style="display:block;border:0"></td><td style="font-size:20px;font-weight:700;letter-spacing:-0.5px;color:#f6c2f1">oren.</td></tr></table>
<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:#e8cde7">${escape(date)}</p>
<h1 style="margin:0;font:normal 46px/1.02 Georgia,serif;letter-spacing:-1.8px">Morning Brief</h1>
</td></tr>
<tr><td style="padding:27px 26px 28px">
<p style="margin:0 0 8px;font-weight:700;font-size:16px">Good morning,</p>
<p style="margin:0;font-size:16px;line-height:1.6;color:#3e3643">${escape(note)}</p>
${snapshot.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background:#fbf0fa;border-radius:12px"><tr>${snapshot.map(({ label, amount, color }) => `<td valign="top" style="padding:16px 12px"><p style="margin:0 0 6px;font-size:12px;color:#5c4b60">${label}</p><p style="margin:0;font:bold 22px/1.2 Arial,sans-serif;word-break:break-word;color:${color}">${escape(amount)}</p></td>`).join('')}</tr></table>` : ''}
${snapshotDetail ? `<p style="margin:8px 0 0;color:#615865;font-size:12px;line-height:1.45">${snapshotDetail}</p>` : ''}
${facts.moves.length ? `<h2 style="margin:26px 0 6px;font:normal 24px Georgia,serif">What moved your portfolio</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${facts.moves.map(({ ticker, usd }) => `<tr><td style="padding:9px 0;border-bottom:1px solid #eee9ef;font-size:14px;font-weight:700">${escape(ticker)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #eee9ef;font-size:14px;color:${usd < 0 ? '#9f313d' : '#176044'}">${escape(change(usd))}</td></tr>`).join('')}</table>` : ''}
${stories.length ? `<h2 style="margin:26px 0 5px;font:normal 24px Georgia,serif">On my radar</h2>${stories.map((story) => `<div style="padding:12px 0;border-bottom:1px solid #eee9ef">${storyContext(story) ? `<p style="margin:0 0 4px;color:#615865;font-size:12px">${escape(storyContext(story))}</p>` : ''}<a href="${escape(story.url)}" style="color:#412b53;font-size:15px;line-height:1.4;font-weight:700;text-decoration:underline;overflow-wrap:anywhere">${escape(story.headline)}</a>${story.summary ? `<p style="margin:5px 0 0;color:#49414c;font-size:14px;line-height:1.5;overflow-wrap:anywhere">${escape(story.summary)}</p>` : ''}</div>`).join('')}` : ''}
${events.length ? `<h2 style="margin:26px 0 5px;font:normal 24px Georgia,serif">Official US data: today and the next 48 hours</h2>${events.map((event) => `<div style="padding:12px 0;border-bottom:1px solid #eee9ef"><p style="margin:0 0 4px;color:#615865;font-size:12px">${escape(event.when)}</p><a href="${escape(event.url)}" style="color:#412b53;font-size:15px;line-height:1.4;font-weight:700;text-decoration:underline;overflow-wrap:anywhere">${escape(event.title)}</a><p style="margin:5px 0 0;color:#49414c;font-size:14px;line-height:1.5">${escape([event.agency, event.result].filter(Boolean).join(' · '))}</p></div>`).join('')}${eventCredit ? `<p style="margin:10px 0 0;color:#615865;font-size:11px;line-height:1.5">${escape(eventCredit)}</p>` : ''}` : ''}
<p style="margin:24px 0 18px;font-size:14px;color:#4f4053"><strong>Oren</strong> · Your investment copilot</p>
<a href="${escape(new URL('/app', settings).href)}" style="display:inline-block;background:#221b2a;color:#ffffff;border-radius:8px;padding:12px 17px;font-size:14px;font-weight:700;text-decoration:none">Open Oren</a>
</td></tr>
<tr><td style="padding:16px 26px;border-top:1px solid #eee9ef;font-size:12px;line-height:1.6;color:#615865"><a href="${escape(settings)}" style="color:#615865">Email preferences</a> &nbsp;·&nbsp; <a href="${escape(stop)}" style="color:#615865">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
