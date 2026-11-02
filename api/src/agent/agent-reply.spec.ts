import type { DripOpinions } from '../drip/drip.types';
import { dripOpinionsModelOutput } from './agent-reply';
import { plainTechnicalRead } from '../intelligence/ta/plain-read';
import type { TechnicalBrief } from '../../types/analysis';

describe('agent reply shaping', () => {
  it('turns a deduped Drip window into a short linked answer', () => {
    const opinions: DripOpinions = {
      available: true,
      source: 'drip',
      queried: 'TSLAx',
      ticker: 'TSLA',
      window: { from: '2026-10-01', to: '2026-10-31' },
      windowComplete: true,
      truncated: false,
      summary: {
        calls: 39,
        analysts: 39,
        bullish: 30,
        bearish: 8,
        neutral: 1,
        byAction: {
          HOLD: 7,
          OPINION: 23,
          ADD: 4,
          RECOMMENDATION: 2,
          EXIT: 2,
          REDUCE: 1,
        },
        bySource: { 'X post': 31, Substack: 5, Podcast: 3 },
      },
      highlights: [
        {
          author: 'BowTied Bull',
          linkLabel: 'BowTied Bull',
          sourceLabel: 'X post',
          sourceKind: 'x_post',
          stance: 'BULLISH',
          action: 'ADD',
          url: 'https://x.com/BowTiedBull/status/1',
          date: '2026-10-30T00:00:00.000Z',
        },
        {
          author: 'TheLongInvest',
          linkLabel: '@TheLongInvest',
          sourceLabel: 'X post',
          sourceKind: 'x_post',
          stance: 'BEARISH',
          action: 'OPINION',
          url: 'https://x.com/TheLongInvest/status/2',
          date: '2026-10-29T00:00:00.000Z',
        },
      ],
      opinions: [],
      disclaimer: 'Opinions, not facts, and not financial advice.',
    };

    const shaped = dripOpinionsModelOutput(opinions);
    if (!shaped.available) throw new Error('expected opinions');
    expect(shaped).toMatchObject({
      windowComplete: true,
      speak: {
        lead: 'Mostly bullish: 30 of 39 recent writers are positive on TSLA.',
      },
    });
    expect(shaped.speak.bullets).toEqual([
      '[BowTied Bull](https://x.com/BowTiedBull/status/1) — X post, positive, adding.',
      '[@TheLongInvest](https://x.com/TheLongInvest/status/2) — X post, negative, sharing a view.',
    ]);
    expect(JSON.stringify(shaped)).not.toContain('Substack writers');
    expect(JSON.stringify(shaped)).not.toContain('not financial advice');
    expect(shaped.details).toContain('X post 31');
    expect(
      shaped.counts.positive + shaped.counts.negative + shaped.counts.mixed,
    ).toBe(shaped.counts.opinions);
  });

  it('says when the Drip window was only a sample', () => {
    const shaped = dripOpinionsModelOutput({
      available: true,
      source: 'drip',
      queried: 'TSLA',
      ticker: 'TSLA',
      truncated: true,
      windowComplete: false,
      summary: {
        calls: 20,
        analysts: 18,
        bullish: 10,
        bearish: 8,
        neutral: 2,
        byAction: { OPINION: 20 },
      },
      opinions: [],
      disclaimer: 'Opinions, not facts, and not financial advice.',
    });
    if (!shaped.available) throw new Error('expected opinions');
    expect(shaped.speak.lead).toContain('fetched opinions');
    expect(shaped.speak.lead).toContain('sample');
    expect(shaped.countsNote).toContain('not every post');
  });
});

describe('plain technical sample', () => {
  it('keeps the Tesla stall read free of indicator names', () => {
    const technicalBrief = {
      regime: 'uptrend',
      setup: 'continuation',
      primaryTimeframe: {
        timeframe: 'daily',
        rsi14: 60.27,
        sma20: 379.63,
        sma50: 369.2,
        macd: { line: 8.59, signal: 5.67, histogram: 2.93 },
        atr14: 16.91,
        bollinger: {
          upper: 407.17,
          middle: 379.63,
          lower: 352.1,
          bandwidth: 14.51,
        },
        volumeTrend: 1.39,
      },
      weeklyTimeframe: {
        timeframe: 'weekly',
        rsi14: 72.63,
        sma20: 340,
        sma50: 300,
        macd: { line: 1, signal: 1, histogram: 0 },
        atr14: 20,
        bollinger: { upper: 400, middle: 340, lower: 280, bandwidth: 8 },
      },
      levels: [
        { price: 400.52, label: 'support', distancePct: -2.44 },
        { price: 411.19, label: 'resistance', distancePct: 0.16 },
      ],
      limitZones: [
        {
          side: 'buy',
          preferredUsd: 400.52,
          conservativeUsd: 396.29,
          aggressiveUsd: 404.75,
          basis: 'swing_support',
          distancePct: -2.44,
        },
        {
          side: 'sell',
          preferredUsd: 411.19,
          conservativeUsd: 415.42,
          basis: 'swing_resistance',
          distancePct: 0.16,
        },
      ],
      risks: [],
      limitedHistory: false,
    } satisfies TechnicalBrief;
    const read = plainTechnicalRead({
      ticker: 'TSLA',
      name: 'Tesla',
      opportunityScore: 80,
      technicalBrief,
    });
    expect(read.lead).toContain('stalls');
    expect(read.lead).toContain('better entry');
    expect(`${read.lead} ${read.bullets.join(' ')}`).not.toMatch(
      /breakout|RSI|MACD/,
    );
  });
});
