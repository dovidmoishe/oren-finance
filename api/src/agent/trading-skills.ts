// Reviewed Oren adaptations of the HFT directory's research, validation and journal guidance.
export const tradingSkills = {
  'factor-research': {
    guidance:
      'Identify a testable setup from completed observations. Compare the latest close with prior trend, breakout and pullback levels. Distinguish a hypothesis from an observed outcome.',
    chatTools: ['getStockChart', 'analyzeStock', 'getSignals'],
    paperTools: ['inspectSignals', 'inspectBars'],
  },
  'data-validation': {
    guidance:
      'Check the instrument, timestamp, sample coverage and missing sessions before interpreting a signal. Use only data available at decision time. Record uncertainty when the evidence is sparse.',
    chatTools: ['getStock', 'getStockChart', 'getBitgetMarketContext'],
    paperTools: ['inspectBars'],
  },
  'risk-journal': {
    guidance:
      'Inspect available cash, position and recent drawdown. Compare the opportunity with holding cash. Explain the observation behind the action. Quote costs, liquidity and the sizing policy determine whether a paper signal can fill.',
    chatTools: ['getPortfolio', 'analyzeStock', 'getSwapQuote'],
    paperTools: ['inspectRisk'],
  },
} as const;
export const tradingSkillVersion = 'swing-research-v1';
export const tradingSkillSource = 'https://hft.md/prompts/';
