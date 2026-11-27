import type { MessageKey, MessageValues } from '@/i18n/i18n';
import type { AgentPageContext } from '@/types';
import type { StockSummary } from '@/types/stock';

export function pageContext(pathname: string): AgentPageContext | undefined {
  const terminalPath = pathname === '/app' || pathname.startsWith('/app/') ? pathname.slice(4) || '/' : pathname;
  const stock = /^\/stocks\/([^/]+)\/?$/.exec(terminalPath);
  if (stock) {
    try {
      return { page: 'stock', assetId: decodeURIComponent(stock[1]) };
    } catch {
      return undefined;
    }
  }
  if (terminalPath === '/calendar') return { page: 'calendar' };
  if (terminalPath === '/leaderboard' || terminalPath.startsWith('/leaderboard/')) return { page: 'leaderboard' };
  if (terminalPath === '/markets') return { page: 'markets' };
  if (terminalPath === '/explore' || terminalPath === '/news') return { page: 'explore' };
  if (terminalPath === '/vault') return { page: 'vault' };
  if (terminalPath === '/activity') return { page: 'activity' };
  if (['/', '/portfolio', '/overview'].includes(terminalPath)) return { page: 'dashboard' };
  // Settings and other non-investing pages have no supported API page context.
  return undefined;
}

/** The stock store can still contain the previous route while a new one loads. */
export function contextTicker(context: AgentPageContext | undefined, stock?: Pick<StockSummary, 'assetId' | 'ticker'>): string | undefined {
  return context?.page === 'stock' && stock && stock.assetId === context.assetId ? stock.ticker : undefined;
}

export function promptSuggestions(context?: AgentPageContext, ticker?: string): string[] {
  if (!context) return ['What can Oren help me with?', 'Explain how trade approvals work', 'Help me understand portfolio risk'];
  switch (context.page) {
    case 'explore':
      return ['Catch me up on news about my holdings', 'Which recent stories matter most to my portfolio?', 'Explain the latest earnings news'];
    case 'stock':
      return [
        `Research ${ticker ?? 'this stock'} with sources`,
        `Analyze ${ticker ?? 'this stock'} for me`,
        `What is the latest news on ${ticker ?? 'this stock'}?`,
        `What are people saying about ${ticker ?? 'this stock'}?`,
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

/** Translation key (and values) naming the page Oren is looking at. */
export function contextLabelKey(context?: AgentPageContext, ticker?: string): [MessageKey, MessageValues?] {
  if (!context) return ['agent.contextGeneral'];
  switch (context.page) {
    case 'stock':
      return ticker ? ['agent.contextStock', { ticker }] : ['agent.contextStockGeneric'];
    case 'markets':
      return ['agent.contextMarkets'];
    case 'explore':
      return ['news.nav'];
    case 'vault':
      return ['agent.contextVault'];
    case 'calendar':
      return ['agent.contextCalendar'];
    case 'leaderboard':
      return ['agent.contextLeaderboard'];
    case 'activity':
      return ['agent.contextActivity'];
    default:
      return ['agent.contextDashboard'];
  }
}

export function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    getCompanyBrief: 'Checking company filings and recent developments',
    getStockResearch: 'Building cited stock research',
    getPortfolio: 'Checking your portfolio',
    getPortfolioActivity: 'Reading portfolio activity',
    getTradingCalendar: 'Reading trading calendar',
    getTradingCalendarDay: 'Opening day drilldown',
    isMarketOpen: 'Checking US market hours',
    getMarketCalendar: 'Reading the US market calendar',
    getMarketDayRecap: 'Reading the market recap for that day',
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
