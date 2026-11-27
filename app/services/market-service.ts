import { apiRequest } from "./api-client";
import type { InterestId, SectorId } from "./preferences-service";
import type { ChartInterval, ChartRange, MarketCandle, NewsItem, StockAnalysis, StockCharts, StockDetail, StockSummary, StocksPage } from "@/types";

interface ApiStockSummary {
  id?: string;
  assetId?: string;
  ticker: string;
  name: string;
  logo?: string;
  logoUrl?: string;
  category?: "equity" | "etf" | "index";
  price?: number;
  priceUsd?: number;
  priceChange24h?: number;
  change24hPct?: number;
  volume24h?: number;
  volume24hUsd?: number;
  liquidity?: number;
  liquidityUsd?: number;
  opportunityScore?: number;
}

interface ApiStocksPage {
  items: ApiStockSummary[];
  pagination: StocksPage["pagination"];
}

interface ApiStockDetail extends ApiStockSummary {
  sector?: string;
  marketData?: StockDetail['marketData'];
  variants: StockDetail["variants"];
}

interface ApiStockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  summary?: string;
  technicalBrief?: StockAnalysis["technicalBrief"];
  signals: StockAnalysis["signals"];
  highlights: string[];
  riskLabel?: StockAnalysis["riskLabel"];
  analyzedAt: string;
}

interface ApiNewsFeed {
  items: Array<Omit<NewsItem, "id"> & { id?: string }>;
}

export function getStocks(page = 1, limit = 20) {
  return apiRequest<ApiStocksPage>("/stocks", {
    query: { page, limit },
  }).then((response): StocksPage => ({
    items: response.items.map(mapStockSummary),
    pagination: response.pagination,
  }));
}

export function searchStocks(query: string, signal?: AbortSignal) {
  return apiRequest<ApiStockSummary[]>("/stocks/search", {
    query: { q: query },
    signal,
  }).then((stocks) => stocks.map(mapStockSummary));
}

export function getStock(assetId: string, signal?: AbortSignal) {
  return apiRequest<ApiStockDetail>(`/stocks/${assetId}`, { signal }).then(mapStockDetail);
}

export interface LandingSnapshot {
  retrievedAt: string;
  stale: boolean;
  data: {
    source: string;
    stocks: { assetId: string; ticker: string; name: string; price: number; priceChange24h: number }[];
    candles: MarketCandle[];
    analysis: StockAnalysis;
  };
}

let landingRequest: Promise<LandingSnapshot> | undefined;
let landingSnapshot: LandingSnapshot | undefined;
let landingFetchedAt = 0;
export function getLandingSnapshot(): Promise<LandingSnapshot> {
  if (landingSnapshot && Date.now() - landingFetchedAt < 60_000) return Promise.resolve(landingSnapshot);
  if (landingRequest) return landingRequest;
  landingRequest = apiRequest<LandingSnapshot>('/markets/landing-snapshot', { signal: AbortSignal.timeout(12_000) }).then(value => {
    landingSnapshot = value; landingFetchedAt = Date.now(); return value;
  }).finally(() => { landingRequest = undefined; });
  return landingRequest;
}


export function getStockChart(assetId: string, range: ChartRange, signal?: AbortSignal, interval?: ChartInterval) {
  return apiRequest<{ candles: MarketCandle[] }>(`/stocks/${assetId}/chart`, {
    query: { range, interval },
    signal,
  }).then((series) => series.candles);
}

export function getStockCharts(ids: string[], range: ChartRange, signal?: AbortSignal, interval?: ChartInterval) {
  return apiRequest<StockCharts>("/stocks/charts", {
    query: { ids: ids.join(","), range, interval },
    signal,
  });
}

export function getStockAnalysis(assetId: string, signal?: AbortSignal) {
  return apiRequest<ApiStockAnalysis>(`/stocks/${assetId}/analysis`, { signal }).then(
    (analysis): StockAnalysis => analysis,
  );
}

export function getStockNews(assetId: string, signal?: AbortSignal) {
  return apiRequest<ApiNewsFeed>(`/stocks/${assetId}/news`, { signal }).then((feed) =>
    feed.items.map((item, index) => ({
      ...item,
      id: item.id ?? `${assetId}-${item.publishedAt}-${index}`,
    })),
  );
}

type ForYouState = "no_preferences" | "no_matches" | "ready";
export type MarketForYouResult = {
  state: ForYouState;
  items: Array<StockSummary & { sectorId: SectorId | null; interestId?: InterestId }>;
};

export async function getMarketForYou(getAccessToken: () => Promise<string | null>, signal: AbortSignal): Promise<MarketForYouResult> {
  const token = await getAccessToken();
  signal.throwIfAborted();
  if (!token) throw new Error("Sign in to see personalized stocks");
  const result = await apiRequest<{ state: ForYouState; items: Array<ApiStockSummary & { sectorId: SectorId | null; interestId?: InterestId }> }>("/markets/for-you", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  return {
    state: result.state,
    items: result.items.map((stock) => ({ ...mapStockSummary(stock), sectorId: stock.sectorId, interestId: stock.interestId })),
  };
}

export function getTrendingStocks() {
  return apiRequest<ApiStockSummary[]>("/markets/trending").then((stocks) => stocks.map(mapStockSummary));
}

export function getMarketOpportunities() {
  return apiRequest<ApiStockSummary[]>("/markets/opportunities").then((stocks) => stocks.map(mapStockSummary));
}

export function mapStockSummary(stock: ApiStockSummary): StockSummary {
  return {
    assetId: stock.assetId ?? stock.id ?? stock.ticker,
    ticker: stock.ticker,
    name: stock.name,
    logoUrl: stock.logoUrl ?? stock.logo,
    category: stock.category,
    priceUsd: stock.priceUsd ?? stock.price,
    change24hPct: stock.change24hPct ?? stock.priceChange24h,
    volume24hUsd: stock.volume24hUsd ?? stock.volume24h,
    liquidityUsd: stock.liquidityUsd ?? stock.liquidity,
    opportunityScore: stock.opportunityScore,
  };
}

export function mapStockDetail(stock: ApiStockDetail): StockDetail {
  return {
    ...mapStockSummary(stock),
    sector: stock.sector,
    marketData: stock.marketData,
    variants: stock.variants ?? [],
  };
}
