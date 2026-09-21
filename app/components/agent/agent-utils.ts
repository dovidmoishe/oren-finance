import type { AgentPageContext } from '@/types';

export function pageContext(pathname: string): AgentPageContext {
  const terminalPath = pathname.startsWith('/app') ? pathname.slice(4) || '/' : pathname;
  if (terminalPath.startsWith('/stocks/')) {
    return { page: 'stock', assetId: decodeURIComponent(terminalPath.split('/')[2] ?? '') };
  }
  if (terminalPath.startsWith('/calendar')) return { page: 'calendar' };
  if (terminalPath.startsWith('/leaderboard')) return { page: 'leaderboard' };
  if (terminalPath.startsWith('/markets')) return { page: 'markets' };
  if (terminalPath.startsWith('/vault')) return { page: 'vault' };
  if (terminalPath.startsWith('/activity')) return { page: 'activity' };
  return { page: 'dashboard' };
}

export function promptSuggestions(context: AgentPageContext, ticker?: string): string[] {
  switch (context.page) {
    case 'stock':
      return [
        `Analyze ${ticker ?? 'this stock'} for me`,
        `What is the latest news on ${ticker ?? 'this stock'}?`,
        `What are the main risks here?`,
      ];
    case 'calendar':
      return [
        'Summarize my month',
        'What were my biggest wins and losses?',
        'Explain my recent drawdowns',
      ];
    case 'leaderboard':
      return [
        'Who is leading right now?',
        'Compare the top traders',
        'Help me copy a public portfolio',
      ];
    case 'markets':
      return [
        'What is standing out in the market?',
        'Find three moderate-risk opportunities',
        'Build me a balanced $200 basket',
      ];
    case 'vault':
      return [
        'How much of my portfolio is locked?',
        "What's unlocking next?",
        'Explain my vault positions',
      ];
    case 'activity':
      return [
        'Explain my recent activity',
        'What changed in my portfolio?',
        'Summarize my latest trades',
      ];
    default:
      return [
        'Review my portfolio',
        'Where am I taking the most risk?',
        'Find opportunities that fit my holdings',
      ];
  }
}

export function contextLabel(context: AgentPageContext, ticker?: string): string {
  switch (context.page) {
    case 'stock':
      return ticker ? `Looking at ${ticker}` : 'Looking at a stock';
    case 'markets':
      return 'Browsing markets';
    case 'vault':
      return 'Vault positions';
    case 'calendar':
      return 'Trading calendar';
    case 'leaderboard':
      return 'Leaderboard';
    case 'activity':
      return 'Portfolio activity';
    default:
      return 'Dashboard overview';
  }
}

export function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    getPortfolio: 'Checking your portfolio',
    getPortfolioActivity: 'Reading portfolio activity',
    getTradingCalendar: 'Reading trading calendar',
    getTradingCalendarDay: 'Opening day drilldown',
    getStock: 'Loading stock data',
    getBitgetMarketContext: 'Checking Bitget live market',
    getStockChart: 'Reading price history',
    getStockNews: 'Reading recent news',
    analyzeStock: 'Running Oren analysis',
    searchStocks: 'Searching stocks',
    findOpportunities: 'Comparing opportunities',
    getSignals: 'Calculating market signals',
    getSwapQuote: 'Requesting a live quote',
    proposeLimitOrder: 'Proposing a limit order',
    getLimitOrders: 'Listing limit orders',
    prepareSwap: 'Preparing an unsigned trade',
    createBasket: 'Building a basket',
    prepareBasketPurchase: 'Preparing basket transactions',
    getVaults: 'Checking vault positions',
    prepareLock: 'Preparing a lock transaction',
    prepareUnlock: 'Preparing an unlock transaction',
    getLeaderboard: 'Reading public leaderboard',
    getTraderProfile: 'Loading public trader profile',
    prepareCopyPortfolio: 'Building copy proposal',
  };
  return labels[toolName] ?? 'Using an Oren tool';
}
