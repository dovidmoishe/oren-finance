"use client";

import { ArrowLeft01Icon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketChart, type MarketChartMode, type MarketChartRange } from "@/components/charts";
import { TechnicalBriefPanel } from "@/components/stock/technical-brief-panel";
import { StockTradeTicket } from "@/components/trading";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/components/ui";
import { useStockStore } from "@/store";
import type { ChartRange, StockDetail as StockDetailType, StockSignals } from "@/types";

const rangeMap: Record<MarketChartRange, ChartRange> = {
  "24H": "1D",
  "7D": "1W",
  "30D": "1M",
  "90D": "3M",
  "1Y": "1Y",
};

function normalizeLogoUrl(url: string) {
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function StockLogo({ stock }: { stock: StockDetailType }) {
  const [failed, setFailed] = useState(false);

  if (stock.logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${stock.name} logo`}
        className="h-12 w-12 rounded-full border border-border bg-panel object-contain p-1"
        onError={() => setFailed(true)}
        src={normalizeLogoUrl(stock.logoUrl)}
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground font-mono text-sm font-semibold text-white">
      {stock.ticker.slice(0, 2)}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
      <Skeleton className="h-24" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function Signal({ label, value, suffix = "" }: { label: string; value?: number; suffix?: string }) {
  return (
    <div className="rounded-[18px] border border-border bg-background p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-sm font-medium">
        {typeof value === "number" ? `${formatNumber(value, 2)}${suffix}` : "—"}
      </p>
    </div>
  );
}

function SignalsGrid({ signals }: { signals: StockSignals }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Signal label="7D momentum" suffix="%" value={signals.momentum7d} />
      <Signal label="30D momentum" suffix="%" value={signals.momentum30d} />
      <Signal label="RSI (14)" value={signals.rsi14} />
      <Signal label="Volatility" suffix="%" value={signals.volatility30d} />
      <Signal label="Volume trend" suffix="%" value={signals.volumeTrend} />
      <Signal label="Liquidity" suffix=" / 100" value={signals.liquidityScore} />
    </div>
  );
}

function ScorePanel({ score, riskLabel }: { score: number; riskLabel?: string }) {
  const normalized = Math.min(100, Math.max(0, score));

  return (
    <Card>
      <CardHeader>
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Oren intelligence</p>
        <h2 className="mt-1 font-display text-xl font-semibold">Opportunity score</h2>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          <div
            className="grid h-28 w-28 shrink-0 place-items-center rounded-full p-2"
            style={{ background: `conic-gradient(#ffe500 ${normalized}%, #f1f1ed 0)` }}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-panel">
              <div className="text-center">
                <p className="font-display text-3xl font-semibold">{Math.round(normalized)}</p>
                <p className="text-[10px] uppercase text-muted">out of 100</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted">Risk profile</p>
            <p className="mt-1 capitalize font-medium">{riskLabel ?? "Not classified"}</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              Deterministic market signals—not an AI-generated price prediction.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketSnapshot({ stock }: { stock: StockDetailType }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-display text-lg font-semibold">Market snapshot</h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between gap-4"><span className="text-muted">Liquidity</span><span className="font-mono">{formatCurrency(stock.liquidityUsd, 0)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted">Tradable routes</span><span className="font-mono">{stock.variants.filter((variant) => variant.tradable).length}</span></div>
      </CardContent>
    </Card>
  );
}

export function StockDetail({ assetId }: { assetId: string }) {
  const stock = useStockStore((state) => state.selected);
  const chart = useStockStore((state) => state.chart);
  const analysis = useStockStore((state) => state.analysis);
  const news = useStockStore((state) => state.news);
  const isLoading = useStockStore((state) => state.isLoading);
  const isChartLoading = useStockStore((state) => state.isChartLoading);
  const error = useStockStore((state) => state.error);
  const chartError = useStockStore((state) => state.chartError);
  const loadStock = useStockStore((state) => state.loadStock);
  const loadChart = useStockStore((state) => state.loadChart);
  const reset = useStockStore((state) => state.reset);
  const [range, setRange] = useState<MarketChartRange>("30D");
  const [mode, setMode] = useState<MarketChartMode>("line");

  useEffect(() => {
    void loadStock(assetId, "1M");
    return reset;
  }, [assetId, loadStock, reset]);

  const lineData = useMemo(
    () => chart.map((point) => ({ timestamp: point.timestamp, value: point.close })),
    [chart],
  );

  if (isLoading && !stock) return <DetailSkeleton />;

  if (!stock) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <ErrorState
          description={error ?? "The requested stock could not be loaded."}
          onRetry={() => void loadStock(assetId, rangeMap[range])}
          title="Stock unavailable"
        />
      </div>
    );
  }

  const positive = (stock.change24hPct ?? 0) >= 0;
  const score = analysis?.opportunityScore ?? 0;

  const handleRangeChange = (nextRange: MarketChartRange) => {
    setRange(nextRange);
    void loadChart(assetId, rangeMap[nextRange]);
  };

  const handleTradeConfirmed = () => loadStock(assetId, rangeMap[range]);

  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
      <Link className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground" href="/app">
        <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={16} strokeWidth={1.8} />
        Back to stocks
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-5 rounded-[24px] border border-border bg-panel p-6 shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
        <div className="flex min-w-0 items-center gap-4">
          <StockLogo stock={stock} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-3xl font-semibold">{stock.name}</h1>
              <span className="rounded-[10px] bg-panel-subtle px-2 py-1 font-mono text-xs text-muted">
                ${stock.ticker}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {[stock.sector, stock.category].filter(Boolean).join(" · ") || "Tokenized equity"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="font-display text-3xl font-semibold">{formatCurrency(stock.priceUsd)}</p>
            <p className={cn("mt-1 font-mono text-sm", positive ? "text-positive" : "text-negative")}>
              {positive ? "▲" : "▼"} {formatPercent(Math.abs(stock.change24hPct ?? 0), false)} today
            </p>
          </div>
          <Button
            aria-label="Refresh stock"
            disabled={isLoading}
            onClick={() => void loadStock(assetId, rangeMap[range])}
            size="icon"
            variant="ghost"
          >
            <HugeiconsIcon
              className={cn(isLoading && "animate-spin")}
              color="currentColor"
              icon={RefreshCwIcon}
              size={17}
              strokeWidth={1.8}
            />
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <MarketChart
          activeRange={range}
          candleData={chart}
          changePct={stock.change24hPct}
          className="min-w-0 rounded-[24px]"
          emptyDescription="No historical market candles were returned for this stock and range."
          error={chartError}
          lineData={lineData}
          loading={isChartLoading}
          mode={mode}
          onModeChange={setMode}
          onRangeChange={handleRangeChange}
          value={stock.priceUsd ?? chart.at(-1)?.close}
        />
        <StockTradeTicket
          key={stock.assetId}
          limitZones={analysis?.technicalBrief?.limitZones}
          onConfirmed={handleTradeConfirmed}
          stock={stock}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ScorePanel riskLabel={analysis?.riskLabel} score={score} />
        <MarketSnapshot stock={stock} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card>
          <CardHeader>
            <h2 className="font-display text-xl font-semibold">Signals &amp; rationale</h2>
            <p className="mt-1 text-sm text-muted">
              {analysis?.summary ?? "Transparent factors behind Oren’s current score."}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {analysis ? (
              <>
                {analysis.technicalBrief ? (
                  <TechnicalBriefPanel brief={analysis.technicalBrief} />
                ) : null}
                <SignalsGrid signals={analysis.signals} />
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-muted">What stands out</p>
                  <ul className="mt-3 space-y-2">
                    {analysis.highlights.map((highlight) => (
                      <li className="flex gap-3 text-sm leading-6" key={highlight}>
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-[20px] border border-border bg-accent-pink-soft p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted">Risk context</p>
                  <p className="mt-2 text-sm leading-6">
                    Current volatility is {formatPercent(analysis.signals.volatility30d, false)} with a {analysis.riskLabel ?? "pending"} risk classification. Review liquidity and price movement before acting.
                  </p>
                </div>
                <p className="text-xs text-muted">Analyzed {formatRelativeTime(analysis.analyzedAt)}</p>
              </>
            ) : (
              <EmptyState
                description="The stock is available, but its deterministic analysis could not be loaded."
                title="Analysis unavailable"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-display text-xl font-semibold">Latest news</h2>
            <p className="mt-1 text-sm text-muted">Relevant coverage for {stock.ticker}.</p>
          </CardHeader>
          <CardContent className="p-0">
            {news.length ? (
              <div>
                {news.slice(0, 8).map((item) => {
                  const content = (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted">
                        <span>{item.source ?? "Market news"}</span>
                        <span>{formatRelativeTime(item.publishedAt)}</span>
                      </div>
                      <h3 className="mt-2 text-sm font-medium leading-5">{item.headline}</h3>
                      {item.summary ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p> : null}
                    </>
                  );

                  return item.url ? (
                    <a
                      className="block border-t border-border px-6 py-5 first:border-t-0 hover:bg-panel-subtle"
                      href={item.url}
                      key={item.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {content}
                    </a>
                  ) : (
                    <article className="border-t border-border px-6 py-5 first:border-t-0" key={item.id}>
                      {content}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="p-5">
                <EmptyState
                  description="No asset-specific stories are cached for this stock right now."
                  title="No asset-specific news"
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
