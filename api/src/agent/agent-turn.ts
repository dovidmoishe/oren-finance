export type AgentTurnFocus = 'company' | 'sentiment' | 'technical' | 'general';

export interface AgentTurnPlan {
  focus: AgentTurnFocus;
  instruction: string;
  userAskedToTrade: boolean;
}

const NO_TRADE =
  'Do not offer a buy quote, limit order, or basket unless the user asked to buy, sell, swap, or set an order.';

const TRADE_OFFER =
  /(?:^|\n+)\s*(?:want me to|i can|i could|should i|shall i)\b[^\n]{0,240}\b(?:buy quotes?|limit orders?|limit buy|limit sell|swap quote|prepare (?:a |the )?(?:buy|quote|order))\b[^\n]*\?\s*$/i;

type TurnMessage = { role: string; content: string; toolName?: string };

export function planAgentTurn(input: {
  message: string;
  history?: TurnMessage[];
  writerOpinionsEnabled: boolean;
}): AgentTurnPlan {
  const message = input.message ?? '';
  const prior = priorHistory(input.history ?? [], message);
  const userAskedToTrade = asksToTrade(message);
  const focus = classify(normalize(message), prior);
  return {
    focus,
    userAskedToTrade,
    instruction: render(
      focus,
      input.writerOpinionsEnabled,
      prior,
      userAskedToTrade,
    ),
  };
}

/** Drops a trailing offer to trade when this message did not ask for one. */
export function stripUnsolicitedTradeOffer(
  text: string,
  userAskedToTrade: boolean,
): string {
  if (userAskedToTrade || !TRADE_OFFER.test(text)) return text;
  const next = text
    .replace(TRADE_OFFER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return next.length >= 40 ? next : text;
}

function classify(text: string, prior: TurnMessage[]): AgentTurnFocus {
  if (isCompanyCorrection(text)) return 'company';
  if (isTechnicalAsk(text) && !isCompanyAsk(text)) return 'technical';
  if (isSentimentAsk(text) && !isCompanyAsk(text)) return 'sentiment';
  if (isCompanyAsk(text)) return 'company';
  if (isSentimentAsk(text)) return 'sentiment';
  if (refersToPrior(text) && priorTopic(prior) !== 'general') {
    return priorTopic(prior) === 'technical' ? 'technical' : 'company';
  }
  return 'general';
}

function render(
  focus: AgentTurnFocus,
  writerOpinionsEnabled: boolean,
  prior: TurnMessage[],
  userAskedToTrade: boolean,
): string {
  const tradeLine = userAskedToTrade
    ? 'The user asked to trade. You may retrieve a quote or propose a limit order. Do not prepare, sign, or broadcast.'
    : NO_TRADE;
  if (focus === 'company') {
    const lines = [
      'Turn: company',
      'This turn is about the company: a company report, fundamentals, what it does, competition, revenue, risks, or how it relates to a theme.',
      'Call getStockResearch for each company. Do not call analyzeStock to answer it.',
      "Answer from company facts the tool returns. If company facts are unavailable, say the tool's specific reason, such as SEC company facts not being loaded until the server contact is configured, and stop.",
      'Do not substitute a price read, an opportunity score, or an unsupported claim for that gap.',
      'Do not invent what a company does or an AI connection.',
      'Keep price levels out unless the user asked about trading or the chart.',
    ];
    if (lastAssistantIsPrice(prior)) {
      lines.push('The previous answer was a price read. Do not repeat it.');
    }
    lines.push(tradeLine);
    return lines.join('\n');
  }
  if (focus === 'sentiment') {
    const opinions = priorHasOpinions(prior)
      ? 'Writer opinions were already fetched in this conversation. Answer from those items. Do not switch to an opportunity ranking or a price read.'
      : writerOpinionsEnabled
        ? 'Call getDripOpinions for a named stock, or getDripPicks when they want what writers are picking. If that tool is unavailable or empty, say so and stop.'
        : 'Writer opinions are not available on this turn, so you cannot rank names by sentiment. Say that plainly. Do not call findOpportunities and present those names as the sentiment answer.';
    return [
      'Turn: sentiment',
      'This turn asks for market sentiment or what people are saying.',
      'Sentiment means writer opinions. It does not mean opportunityScore.',
      'opportunityScore is momentum, trend, and trading activity. Never call that sentiment.',
      opinions,
      'Do not invent what a company does or an AI link.',
      tradeLine,
    ].join('\n');
  }
  if (focus === 'technical') {
    return [
      'Turn: technical',
      'This turn is a price or technical question. Call analyzeStock. Do not call that read a company report or sentiment.',
      tradeLine,
    ].join('\n');
  }
  return [
    'Turn: general',
    'Answer the question that was asked.',
    'Do not call an opportunity score sentiment. opportunityScore is momentum, trend, and trading activity.',
    tradeLine,
  ].join('\n');
}

function priorHistory(history: TurnMessage[], message: string): TurnMessage[] {
  const copy = history.slice();
  const last = copy.at(-1);
  if (last?.role === 'user' && last.content === message) copy.pop();
  return copy;
}

function priorTopic(prior: TurnMessage[]): AgentTurnFocus {
  const users = prior.filter((message) => message.role === 'user').slice(-3);
  for (const message of [...users].reverse()) {
    const text = normalize(message.content);
    if (isCompanyAsk(text)) return 'company';
    if (isSentimentAsk(text)) return 'sentiment';
    if (isTechnicalAsk(text)) return 'technical';
  }
  return 'general';
}

function priorHasOpinions(prior: TurnMessage[]): boolean {
  return prior.some(
    (message) =>
      message.toolName === 'getDripOpinions' ||
      message.toolName === 'getDripPicks',
  );
}

function lastAssistantIsPrice(prior: TurnMessage[]): boolean {
  const last =
    [...prior].reverse().find((message) => message.role === 'assistant')
      ?.content ?? '';
  return /buyers have stepped|support|resistance|\$\d|falling|climbing/.test(
    last,
  );
}

function asksToTrade(message: string): boolean {
  const text = normalize(message);
  return (
    /\b(buy|sell|swap)\b/.test(text) ||
    /\blimit order\b/.test(text) ||
    /\bdip buy\b/.test(text)
  );
}

function isCompanyCorrection(text: string): boolean {
  if (/\bnot the (price|chart|technical)\b/.test(text)) return true;
  if (!/\bi mean\b/.test(text)) return false;
  return (
    /\bcompan/.test(text) ||
    /\bfundament/.test(text) ||
    text.split(' ').some(looksLikeReport)
  );
}

function isCompanyAsk(text: string): boolean {
  if (isCompanyCorrection(text) || hasCompanyReport(text)) return true;
  if (
    /\bwhat\b/.test(text) &&
    /\b(do|does)\b/.test(text) &&
    /\b(compan|they|these|those|it|each)\b/.test(text)
  ) {
    return true;
  }
  if (/\bhave to do with\b/.test(text)) return true;
  if (
    /\b(business model|revenue drivers?|fundamentals?|fundementals?|competition|competitors)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\bgo over\b/.test(text) &&
    !/\b(portfolio|chart|orders|positions)\b/.test(text)
  ) {
    return true;
  }
  if (
    /\b(brief me|tell me about)\b/.test(text) &&
    !/\b(chart|price|technical)\b/.test(text)
  ) {
    return true;
  }
  return false;
}

function isSentimentAsk(text: string): boolean {
  return (
    /\bsentiment\b/.test(text) ||
    /\bwhat (?:are|is) (?:people|writers|the crowd|everyone) (?:saying|thinking)\b/.test(
      text,
    ) ||
    /\bwriter opinions?\b/.test(text) ||
    /\bthe inference\b/.test(text)
  );
}

function isTechnicalAsk(text: string): boolean {
  if (
    /\b(chart|technical|price action|support|resistance|moving average)\b/.test(
      text,
    )
  ) {
    return true;
  }
  return (
    /\banaly[sz]e\b/.test(text) &&
    !/\b(company|fundamentals|business|report)\b/.test(text)
  );
}

function hasCompanyReport(text: string): boolean {
  const parts = text.split(' ');
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === 'company' && looksLikeReport(parts[index + 1] ?? '')) {
      return true;
    }
  }
  return (
    /\breport on\b/.test(text) ||
    /\bthe report\b/.test(text) ||
    /\ba report\b/.test(text)
  );
}

function looksLikeReport(word: string): boolean {
  if (
    /^reports?$/.test(word) ||
    word === 'repott' ||
    word === 'repot' ||
    word === 'reprot'
  ) {
    return true;
  }
  const collapsed = word.replace(/(.)\1+/g, '$1');
  return collapsed === 'report' || collapsed === 'reports';
}

function refersToPrior(text: string): boolean {
  return /\b(these|they|them|those|each of these)\b/.test(text);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
