import {
  compactPicks,
  compactTickerCoverage,
  presentOpinions,
} from './drip.mapper';

describe('Drip response mapping', () => {
  it('keeps a short cited opinion and the stance summary', () => {
    const compact = compactTickerCoverage({
      meta: {
        ticker: 'nvda',
        from: '2026-10-01',
        to: '2026-10-31',
        asOf: '2026-11-01T00:00:00.000Z',
        truncated: false,
      },
      summary: {
        calls: 2,
        analysts: 1,
        bullish: 1,
        bearish: 1,
        neutral: 0,
        byAction: { ADD: 1, EXIT: 1 },
      },
      authors: [
        {
          author: 'Example Analyst',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              evidenceQuote: 'Adding to NVDA on the pullback.',
              articleTitle: 'Example Finance Newsletter',
              articleUrl:
                'https://dripstack.com/api/v2/sources/example/nvda-review',
              publishedAt: '2026-10-30T11:24:07.000Z',
              thesis:
                'The author adds after a drawdown, citing datacenter demand.',
              speakerIsGuest: false,
            },
            {
              sentiment: null,
              action: 'OPINION',
              evidenceQuote: '   ',
              thesis: '',
              articleUrl: 'javascript:alert(1)',
            },
          ],
        },
      ],
    });

    expect(compact?.ticker).toBe('NVDA');
    expect(compact?.opinions).toEqual([
      {
        author: 'Example Analyst',
        source: 'Example Finance Newsletter',
        sourceKind: 'other',
        sourceLabel: 'Post',
        linkLabel: 'Example Analyst',
        date: '2026-10-30T11:24:07.000Z',
        stance: 'BULLISH',
        action: 'ADD',
        summary: 'The author adds after a drawdown, citing datacenter demand.',
        quote: 'Adding to NVDA on the pullback.',
        url: 'https://dripstack.com/api/v2/sources/example/nvda-review',
      },
    ]);
    const presented = presentOpinions(compact!, 'NVDAx', 'NVDAx', 8);
    expect(presented).toMatchObject({
      available: true,
      queried: 'NVDAx',
      ticker: 'NVDA',
      mappedFrom: 'NVDAx',
      windowComplete: true,
      summary: {
        calls: 1,
        analysts: 1,
        bullish: 1,
        bearish: 0,
        byAction: { ADD: 1 },
        bySource: { Post: 1 },
      },
    });
    expect(presented.disclaimer).toContain('not financial advice');
  });

  it('compacts picks to author, source, date, stance, quote, and link', () => {
    const compact = compactPicks({
      meta: {
        plan: 'PRO',
        appliedRange: { from: '2026-10-30', to: '2026-10-31' },
        asOf: '2026-11-01T00:00:00.000Z',
      },
      pagination: { count: 1, nextCursor: null },
      picks: [
        {
          ticker: 'tsla',
          action: 'NEW_POSITION',
          author: 'Podcast Host',
          publicationTitle: 'The Daily Tape',
          articleUrl: 'https://example.com/tsla',
          sentiment: 'BEARISH',
          evidenceQuote: 'A'.repeat(400),
          thesis: null,
          publishedAt: '2026-10-31T09:00:00.000Z',
          speakerIsGuest: true,
        },
      ],
    });

    expect(compact?.picks).toHaveLength(1);
    expect(compact?.picks[0]).toMatchObject({
      ticker: 'TSLA',
      author: 'Podcast Host',
      source: 'The Daily Tape',
      stance: 'BEARISH',
      action: 'NEW_POSITION',
      guest: true,
      url: 'https://example.com/tsla',
    });
    expect(compact?.picks[0].quote?.endsWith('…')).toBe(true);
    expect(compact?.picks[0].quote?.length).toBeLessThanOrEqual(180);
  });

  it('rejects a payload that is not the documented envelope', () => {
    expect(compactTickerCoverage({ picks: [] })).toBeNull();
    expect(compactPicks({ authors: [] })).toBeNull();
  });

  it('drops uncitable and duplicate opinions before selecting the visible sample', () => {
    const mention = {
      thesis: 'Same thesis',
      articleUrl: 'https://example.com/a',
      publishedAt: '2026-11-01',
      sentiment: 'BULLISH',
    };
    const result = compactTickerCoverage({
      meta: { ticker: 'NVDA' },
      summary: { calls: 4 },
      authors: [
        {
          author: 'Alice',
          mentions: [
            mention,
            { ...mention, articleUrl: 'https://example.com/b' },
            { ...mention, thesis: 'No link', articleUrl: undefined },
            { ...mention, thesis: 'Bad date', publishedAt: 'not a date' },
          ],
        },
      ],
    });
    expect(result?.summary.calls).toBe(1);
    expect(result?.summary.bullish).toBe(1);
    expect(result?.summary.byAction).toEqual({ UNSTATED: 1 });
    expect(result?.opinions).toHaveLength(1);
  });

  it('labels X posts, Substack, and podcasts from the payload', () => {
    const result = compactTickerCoverage({
      meta: { ticker: 'TSLA', truncated: false },
      authors: [
        {
          author: 'BowTied Bull',
          platform: 'TWITTER',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              thesis: 'Still adding on weakness.',
              articleUrl: 'https://x.com/BowTiedBull/status/10',
              publishedAt: '2026-11-01T12:00:00.000Z',
            },
          ],
        },
        {
          author: 'TheLongInvest',
          mentions: [
            {
              sentiment: 'BEARISH',
              action: 'OPINION',
              thesis: 'Too extended for me.',
              articleUrl: 'https://x.com/TheLongInvest/status/11',
              publishedAt: '2026-11-01T13:00:00.000Z',
            },
          ],
        },
        {
          author: 'Letter Writer',
          mentions: [
            {
              platform: 'SUBSTACK',
              sentiment: 'BULLISH',
              thesis: 'The letter stays long.',
              articleUrl: 'https://example.substack.com/p/tsla',
              publishedAt: '2026-11-01T14:00:00.000Z',
            },
          ],
        },
        {
          author: 'Podcast Host',
          mentions: [
            {
              sentiment: 'NEUTRAL',
              thesis: 'Waiting for the next print.',
              articleUrl: 'https://example.com/episode',
              publishedAt: '2026-11-01T15:00:00.000Z',
              speakerIsGuest: true,
            },
          ],
        },
      ],
    });

    expect(
      result?.opinions.map((item) => [item.linkLabel, item.sourceKind]),
    ).toEqual([
      ['Podcast Host', 'podcast'],
      ['Letter Writer', 'substack'],
      ['@TheLongInvest', 'x_post'],
      ['BowTied Bull', 'x_post'],
    ]);
    expect(result?.summary.bySource).toEqual({
      'X post': 2,
      Substack: 1,
      Podcast: 1,
    });
  });

  it('drops near-duplicate posts and keeps action and stance counts on that set', () => {
    const result = compactTickerCoverage({
      meta: { ticker: 'TSLA', truncated: true },
      summary: {
        calls: 4,
        analysts: 2,
        bullish: 3,
        bearish: 1,
        neutral: 0,
        byAction: { OPINION: 3, EXIT: 1 },
      },
      authors: [
        {
          author: 'cantonmeow',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'OPINION',
              thesis: 'TSLA robotaxi timeline still looks intact to me',
              articleUrl: 'https://x.com/cantonmeow/status/2117284934335553894',
              publishedAt: '2026-11-01T16:00:36.000Z',
            },
            {
              sentiment: 'BULLISH',
              action: 'OPINION',
              thesis: 'TSLA robotaxi timeline still looks intact to me!',
              articleUrl: 'https://x.com/cantonmeow/status/2117284781243388167',
              publishedAt: '2026-11-01T16:00:00.000Z',
            },
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              thesis: 'Adding a little after the delivery miss.',
              articleUrl: 'https://x.com/cantonmeow/status/99',
              publishedAt: '2026-10-20T12:00:00.000Z',
            },
          ],
        },
        {
          author: 'Other Writer',
          mentions: [
            {
              sentiment: 'BEARISH',
              action: 'EXIT',
              thesis: 'Closed the long.',
              articleUrl: 'https://x.com/other/status/5',
              publishedAt: '2026-11-01T10:00:00.000Z',
            },
          ],
        },
      ],
    });

    expect(result?.opinions).toHaveLength(3);
    expect(result?.summary).toMatchObject({
      calls: 3,
      analysts: 2,
      bullish: 2,
      bearish: 1,
      neutral: 0,
      byAction: { OPINION: 1, ADD: 1, EXIT: 1 },
    });
    const summary = result?.summary;
    expect(
      (summary?.bullish ?? 0) +
        (summary?.bearish ?? 0) +
        (summary?.neutral ?? 0),
    ).toBe(summary?.calls);
    expect(
      Object.values(result!.summary.byAction).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(result?.summary.calls);
    expect(result?.truncated).toBe(true);
    const presented = presentOpinions(result!, 'TSLA', undefined, 1);
    expect(presented.opinions).toHaveLength(1);
    expect(presented.summary.calls).toBe(3);
    expect(presented.windowComplete).toBe(false);
    expect(presented.truncated).toBe(true);
    expect(presented.highlights?.length).toBeGreaterThan(1);
  });
});
