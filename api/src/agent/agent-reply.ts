import type { StockAnalysis } from '../../types/analysis';
import type { StockResearch } from '../../types/research';
import type {
  DripCitation,
  DripOpinionResult,
  DripOpinions,
  DripPicksResult,
} from '../drip/drip.types';
import { plainTechnicalRead, speechName } from '../intelligence/ta/plain-read';

export const AGENT_REPLY_INSTRUCTION =
  'Use speak for the answer: one plain sentence, then those bullets, then stop. At most one follow-up question, never a menu of options. Keep markdown links. Put details only inside a :::details fence and do not repeat those numbers above it. Do not write a disclaimer.';

export function analysisModelOutput(analysis: StockAnalysis) {
  const display = speechName(analysis.name, analysis.ticker);
  if (!analysis.technicalBrief) {
    return {
      ticker: analysis.ticker,
      name: analysis.name,
      instruction: AGENT_REPLY_INSTRUCTION,
      speak: {
        lead: `${display} doesn't have a technical read yet.`,
        bullets: [] as string[],
      },
    };
  }
  const read = plainTechnicalRead({
    ticker: analysis.ticker,
    name: analysis.name,
    opportunityScore: analysis.opportunityScore,
    riskLabel: analysis.riskLabel,
    technicalBrief: analysis.technicalBrief,
  });
  return {
    ticker: analysis.ticker,
    name: analysis.name,
    instruction: AGENT_REPLY_INSTRUCTION,
    speak: { lead: read.lead, bullets: read.bullets },
    details: read.details,
  };
}

export function dripOpinionsModelOutput(result: DripOpinionResult) {
  if (!result.available) {
    return {
      available: false as const,
      reason: result.reason,
      message: result.message,
      instruction:
        'Say writer opinions could not be fetched, in one sentence, then continue with Oren data. Do not invent authors, quotes, or links. Do not write a disclaimer.',
    };
  }
  const spoken = speakOpinions(result);
  const summary = result.summary ?? {
    calls: result.opinions?.length ?? 0,
    analysts: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    byAction: {},
  };
  return {
    available: true as const,
    ticker: result.ticker,
    queried: result.queried,
    mappedFrom: result.mappedFrom,
    window: result.window,
    windowComplete: result.windowComplete ?? !result.truncated,
    countsNote: spoken.countsNote,
    instruction: `${AGENT_REPLY_INSTRUCTION} Use each item's source label (X post, Substack, Podcast, or whatever the tool says). Never describe the whole feed as Substack or podcast opinions. Counts are already deduped; do not re-add them or say results were truncated when windowComplete is true.`,
    speak: spoken.speak,
    counts: {
      opinions: summary.calls,
      writers: summary.analysts,
      positive: summary.bullish,
      negative: summary.bearish,
      mixed: summary.neutral,
      unstated: summary.unstated,
      byAction: summary.byAction,
      bySource: summary.bySource,
    },
    details: spoken.details,
  };
}

export function dripPicksModelOutput(result: DripPicksResult) {
  if (!result.available) {
    return {
      available: false as const,
      reason: result.reason,
      message: result.message,
      instruction:
        'Say the writer feed could not be fetched, in one sentence. Do not invent picks. Do not write a disclaimer.',
    };
  }
  const complete = result.windowComplete ?? !result.truncated;
  const highlights = (result.picks ?? []).slice(0, 4);
  return {
    available: true as const,
    window: result.window,
    windowComplete: complete,
    instruction: `${AGENT_REPLY_INSTRUCTION} Label each pick with its source label. Never call the feed Substack or podcast opinions unless that is the item's source label.`,
    speak: {
      lead: complete
        ? 'A few fresh ideas writers just posted.'
        : 'A few of the latest writer posts. This is not the whole feed.',
      bullets: highlights.map((item) => opinionBullet(item, item.ticker)),
    },
    details: sourceDetail(result.picks ?? [], complete),
  };
}

export function researchModelOutput(report: StockResearch) {
  const analysis = report.analysis?.data;
  const read = analysis?.technicalBrief
    ? plainTechnicalRead({
        ticker: report.ticker,
        name: report.name,
        opportunityScore: analysis.opportunityScore,
        riskLabel: analysis.riskLabel,
        technicalBrief: analysis.technicalBrief,
      })
    : undefined;
  const opinions = report.opinions?.data;
  const bullets = [...(read?.bullets ?? [])];
  if (opinions && opinions.mentionCount > 0) {
    const { bullish, bearish } = opinions.stanceByAuthor;
    bullets.push(
      `${bullish} of ${opinions.distinctAuthors} writers are positive and ${bearish} are negative.`,
    );
  }
  if (report.portfolio?.available) {
    bullets.push(
      report.portfolio.data
        ? `It's about ${Math.round(report.portfolio.data.allocationPercent)}% of the portfolio.`
        : "It isn't in the portfolio right now.",
    );
  }
  const headline = report.news?.data?.find((item) => item.headline);
  if (headline) {
    bullets.push(
      headline.url
        ? `Recent headline: [${headline.headline}](${headline.url}).`
        : `Recent headline: ${headline.headline}.`,
    );
  }
  return {
    ticker: report.ticker,
    name: report.name,
    instruction: AGENT_REPLY_INSTRUCTION,
    speak: {
      lead:
        read?.lead ??
        `${speechName(report.name, report.ticker)} only has a partial research read right now.`,
      bullets: bullets.slice(0, 5),
    },
    details: [read?.details, opinions ? opinionOverlayDetail(opinions) : '']
      .filter(Boolean)
      .join('\n\n'),
  };
}

function speakOpinions(result: DripOpinions) {
  const summary = result.summary ?? {
    calls: result.opinions?.length ?? 0,
    analysts: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    byAction: {},
  };
  const opinions = result.opinions ?? [];
  const display = result.ticker;
  const total = summary.calls;
  const noun = total > 0 && summary.analysts === total ? 'writers' : 'opinions';
  const complete = result.windowComplete ?? !result.truncated;
  const scope = complete ? 'recent' : 'fetched';
  let lead: string;
  if (total === 0) {
    lead = `No recent opinions on ${display} turned up.`;
  } else if (
    summary.bullish >= summary.bearish &&
    summary.bullish / total >= 0.55
  ) {
    lead = `Mostly bullish: ${summary.bullish} of ${total} ${scope} ${noun} are positive on ${display}.`;
  } else if (
    summary.bearish > summary.bullish &&
    summary.bearish / total >= 0.55
  ) {
    lead = `Mostly bearish: ${summary.bearish} of ${total} ${scope} ${noun} are negative on ${display}.`;
  } else {
    lead = `Views are split: ${summary.bullish} of ${total} ${scope} ${noun} are positive on ${display} and ${summary.bearish} are negative.`;
  }
  if (!complete && total > 0) {
    lead += ' More opinions exist in this window, so this is a sample.';
  }
  const highlights = (
    result.highlights?.length ? result.highlights : opinions
  ).slice(0, 4);
  const countsNote = complete
    ? 'Counts cover the full deduped window.'
    : `Counts cover the ${total} opinions fetched, not every post in the window.`;
  return {
    speak: { lead, bullets: highlights.map((item) => opinionBullet(item)) },
    countsNote,
    details: [
      countsNote,
      `${summary.calls} opinions from ${summary.analysts} writers after removing duplicate posts.`,
      `Positive ${summary.bullish}, negative ${summary.bearish}, mixed ${summary.neutral}.`,
      `Actions: ${formatCounts(summary.byAction)}`,
      `Sources: ${formatCounts(summary.bySource ?? {})}`,
      result.window
        ? `Window: ${result.window.from ?? '?'} to ${result.window.to ?? '?'}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function opinionBullet(item: DripCitation, ticker?: string): string {
  const label = item.linkLabel || item.author;
  const who = item.url ? `[${label}](${item.url})` : label;
  const bits = [
    item.sourceLabel,
    stanceWord(item.stance),
    actionWord(item.action),
    ticker ? `on ${ticker}` : undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return `${who} — ${bits.join(', ')}.`;
}

function stanceWord(stance: DripCitation['stance']): string | undefined {
  if (stance === 'BULLISH') return 'positive';
  if (stance === 'BEARISH') return 'negative';
  if (stance === 'NEUTRAL') return 'mixed';
  return undefined;
}

function actionWord(action: string | undefined): string | undefined {
  switch (action?.toUpperCase()) {
    case 'ADD':
      return 'adding';
    case 'HOLD':
      return 'holding';
    case 'EXIT':
      return 'already out';
    case 'REDUCE':
      return 'trimming';
    case 'NEW_POSITION':
      return 'starting a position';
    case 'RECOMMENDATION':
      return 'recommending it';
    case 'OPINION':
      return 'sharing a view';
    default:
      return undefined;
  }
}

function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, value]) => value > 0);
  if (!parts.length) return 'none';
  return parts.map(([key, value]) => `${key} ${value}`).join(', ');
}

function sourceDetail(items: DripCitation[], complete: boolean): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const label = item.sourceLabel ?? 'Post';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return [
    complete ? 'Latest fetched posts.' : 'Latest page only; more posts exist.',
    `Sources: ${formatCounts(counts)}`,
  ].join('\n');
}

function opinionOverlayDetail(
  overlay: NonNullable<StockResearch['opinions']['data']>,
): string {
  return `${overlay.distinctAuthors} writers, ${overlay.mentionCount} mentions. Positive ${overlay.stanceByAuthor.bullish}, negative ${overlay.stanceByAuthor.bearish}, mixed ${overlay.stanceByAuthor.neutral}.`;
}
