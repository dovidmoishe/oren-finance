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
      summary: {
        calls: 2,
        bullish: 1,
        bearish: 1,
        byAction: { ADD: 1, EXIT: 1 },
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
});
