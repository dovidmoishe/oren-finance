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

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-12">
      <Skeleton className="h-8 w-48" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[400px]" />
        <Skeleton className="h-[400px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function Signal({ label, value, suffix = "" }: { label: string; value?: number; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
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
      <CardHeader style={{ padding: "12px 16px" }}>
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Oren intelligence</p>
        <h2 className="mt-1 font-display text-base font-semibold">Opportunity score</h2>
      </CardHeader>
      <CardContent style={{ padding: 16 }}>
        <div className="flex items-center gap-5">
          <div
            className="grid h-20 w-20 shrink-0 place-items-center rounded-full p-2"
            style={{ background: `conic-gradient(#ffe500 ${normalized}%, #f1f1ed 0)` }}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-panel">
              <div className="text-center">
                <p className="font-display text-2xl font-semibold">{Math.round(normalized)}</p>
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
      <CardHeader style={{ padding: "12px 16px" }}>
        <h2 className="font-display text-base font-semibold">Market snapshot</h2>
      </CardHeader>
      <CardContent className="space-y-2 text-xs" style={{ padding: 16 }}>
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

  const score = analysis?.opportunityScore ?? 0;

  const handleRangeChange = (nextRange: MarketChartRange) => {
    setRange(nextRange);
    void loadChart(assetId, rangeMap[nextRange]);
  };

  const handleTradeConfirmed = () => loadStock(assetId, rangeMap[range]);

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted hover:text-foreground" href="/app/markets">
            <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={14} strokeWidth={1.8} />
            Stocks
          </Link>
          <span aria-hidden className="text-border-strong">/</span>
          <h1 className="truncate font-display text-base font-semibold">{stock.name} <span className="ml-1 font-mono text-xs font-normal text-muted">${stock.ticker}</span></h1>
        </div>
        <Button aria-label="Refresh stock" className="h-8 w-8" disabled={isLoading} onClick={() => void loadStock(assetId, rangeMap[range])} size="icon" variant="ghost">
          <HugeiconsIcon className={cn(isLoading && "animate-spin")} color="currentColor" icon={RefreshCwIcon} size={15} strokeWidth={1.8} />
        </Button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <MarketChart
          compact
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ScorePanel riskLabel={analysis?.riskLabel} score={score} />
        <MarketSnapshot stock={stock} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card>
          <CardHeader style={{ padding: "12px 16px" }}>
            <h2 className="font-display text-base font-semibold">Signals &amp; rationale</h2>
            <p className="mt-1 text-sm text-muted">
              {analysis?.summary ?? "Transparent factors behind Oren’s current score."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4" style={{ padding: 16 }}>
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
          <CardHeader style={{ padding: "12px 16px" }}>
            <h2 className="font-display text-base font-semibold">Latest news</h2>
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
                      className="block border-t border-border px-4 py-3 first:border-t-0 hover:bg-panel-subtle"
                      href={item.url}
                      key={item.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {content}
                    </a>
                  ) : (
                    <article className="border-t border-border px-4 py-3 first:border-t-0" key={item.id}>
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
