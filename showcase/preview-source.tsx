"use client";

import { useEffect, useState } from "react";
import { WalletContext, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { AuthContext, type OrenAuth } from "@/components/auth/auth-context";
import { AppShell } from "@/components/shell";
import { PortfolioDashboard } from "@/components/portfolio";
import { MarketsOverview } from "@/components/markets/markets-overview";
import { StockDetail } from "@/components/stock/stock-detail";
import { usePortfolioStore, useWalletStore, useStockStore, useMarketStore, useAgentStore, useExecutionStore } from "@/store";
import type { StockSummary, MarketCandle } from "@/types";

const wallet = "11111111111111111111111111111111";
const noop = async () => {};
const rows = [
  ["NVDA", "NVIDIA", 186.42, 3.28, 24800000, 84],
  ["AAPL", "Apple", 268.75, 1.46, 18200000, 78],
  ["MSFT", "Microsoft", 528.36, 2.17, 15400000, 81],
  ["TSLA", "Tesla", 324.85, -0.84, 21600000, 72],
];
const stocks: StockSummary[] = rows.map(([ticker, name, price, change, volume, score]) => ({
  assetId: String(ticker).toLowerCase(), ticker: String(ticker), name: String(name), priceUsd: Number(price), change24hPct: Number(change), volume24hUsd: Number(volume), liquidityUsd: Number(volume) * .21, opportunityScore: Number(score), logoUrl: `/showcase-assets/${ticker}.png`,
}));
function candles(price: number): MarketCandle[] {
  return Array.from({length: 90}, (_, i) => {
    const close = price * (.82 + i / 89 * .18 + Math.sin(i * .47) * .012 + Math.sin(i * 1.7) * .005);
    return {timestamp: new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString(), open: close * .997, high: close * 1.009, low: close * .991, close, volume: 800000 + i * 900};
  });
}
const total = 128450.68;
const positions = stocks.map((stock, i) => {
  const quantity = [240, 100, 50, 40][i]; const value = quantity * stock.priceUsd!;
  return {...stock, quantity, availableQuantity: quantity, lockedQuantity: 0, priceUsd: stock.priceUsd!, valueUsd: value, availableValueUsd: value, lockedValueUsd: 0, allocationPct: value / total * 100};
});
const available = positions.reduce((sum, p) => sum + p.valueUsd, 0);
const portfolio = {wallet, totalValueUsd: total, availableValueUsd: available, lockedValueUsd: 0, cashValueUsd: total - available, changeUsd: 8420.36, changePct: 7.02, positions, updatedAt: "2026-10-29T12:00:00Z"};
const history = Array.from({length: 84}, (_, i) => ({ timestamp: new Date(Date.UTC(2026,9,22) + i * 7200000).toISOString(), totalValueUsd: total - 8420.36 + i / 83 * 8420.36 + Math.sin(i * .48) * 430 + Math.sin(i * 1.4) * 120, availableValueUsd: available, lockedValueUsd: 0 }));
const analysis = { assetId: "nvda", ticker: "NVDA", opportunityScore: 84, signals: {assetId: "nvda", ticker: "NVDA", momentum7d: 6.84, momentum30d: 14.2, volatility30d: 3.12, rsi14: 62.4, opportunityScore: 84, calculatedAt: portfolio.updatedAt}, highlights: ["Price holds above its 20-day and 50-day moving averages.", "Positive weekly momentum with healthy trading activity."], riskLabel: "moderate" as const, analyzedAt: portfolio.updatedAt, technicalBrief: {regime: "uptrend" as const, setup: "continuation" as const, primaryTimeframe: {timeframe: "daily" as const, rsi14: 62.4, sma20: 179.82, sma50: 173.26, macd: {line: 2.38, signal: 1.92, histogram: .46}, atr14: 4.12, bollinger: {upper: 192.3, middle: 179.82, lower: 167.34, bandwidth: 13.88}}, levels: [{price: 179.82, label: "support" as const, distancePct: -3.54}, {price: 192.3, label: "resistance" as const, distancePct: 3.15}], risks: ["A break below support could weaken the current trend."], limitedHistory: false}};
const auth: OrenAuth = { configured: true, ready: true, authenticated: true, address: wallet, wallets: [], busy: false, walletPreparing: false, email: "oren-demo@example.com", depositOpen: false, openDeposit() {}, closeDeposit() {}, open() {}, signOut: noop, selectWallet() {}, createWallet: noop, async getAccessToken() {return null;}, async authorizeTrade() {throw new Error("Showcase only");} };

function Preview() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("markets");
  const base = useWallet();
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/stocks/") && url.includes("/chart")) {
        const stock = stocks.find(s => url.includes(s.assetId)) ?? stocks[0];
        return Response.json({candles: candles(stock.priceUsd!)});
      }
      if (url.includes("/api/") || url.includes("/execution/") || url.includes("/portfolio/")) return Response.json([]);
      return original(input, init);
    };
    useExecutionStore.setState({quoteTrade: async () => undefined, isLoading: false}); useWalletStore.setState({address: wallet, connected: true}); useAgentStore.setState({walletAddress: wallet, panelOpen: false, hydrated: true, initialize: noop});
    usePortfolioStore.setState({portfolio, history, activity: [], isLoading: false, loadPortfolio: noop, loadHistory: noop, loadActivity: noop});
    useMarketStore.setState({stocks, trending: [stocks[0]], opportunities: [stocks[0]], hasMore: false, isLoading: false, loadMarkets: noop});
    useStockStore.setState({selected: {...stocks[0], sector: "Technology", variants: [{mint: wallet, symbol: "NVDAx", name: "NVIDIA xStock", issuer: "xStocks", tradable: true, liquidity: 5200000}]}, chart: candles(186.42), analysis, news: [], isLoading: false, loadStock: noop, loadChart: noop, reset() {}});
    setView(new URLSearchParams(location.search).get("view") ?? "markets");
    setReady(true);
    return () => {window.fetch = original;};
  }, []);
  if (!ready) return null;
  return <WalletContext.Provider value={{...base, publicKey: new PublicKey(wallet), connected: true}}><AuthContext.Provider value={auth}><div className="oren-app min-h-screen"><style>{`nextjs-portal {display:none} div[class*="xl:grid-cols-"] {grid-template-columns:minmax(0,1fr) 340px}`}</style><AppShell>{view === "portfolio" ? <PortfolioDashboard /> : view === "token" ? <StockDetail assetId="nvda" /> : <MarketsOverview />}</AppShell></div></AuthContext.Provider></WalletContext.Provider>;
}
export default function Page() {return <WalletProvider wallets={[]} autoConnect={false}><Preview /></WalletProvider>;}
