"use client";

import { Search as SearchIcon } from "lucide-react";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Skeleton, cn, formatCompactCurrency, formatCurrency, formatPercent } from "@/components/ui";
import { useMarketStore } from "@/store/market-store";
import { useElementVisible } from "@/hooks/use-element-visible";
import { createSparklineReader } from "@/services/sparkline-read-cache";
import type { MarketCandle, StockSummary } from "@/types";
import { useI18n, useT } from "@/i18n/i18n";
import { MarketForYou } from "./market-for-you";
import { MarketStockLogo } from "./market-stock-logo";

const readSparkline = createSparklineReader();

const marketColumns = "grid grid-cols-[minmax(0,1fr)_4.75rem_4.25rem] items-center gap-2.5 px-3 @lg:grid-cols-[minmax(0,1fr)_minmax(5.5rem,0.55fr)_minmax(4rem,0.5fr)_minmax(5rem,0.55fr)] @3xl:grid-cols-[minmax(0,1fr)_minmax(5.5rem,0.55fr)_minmax(4rem,0.5fr)_minmax(6rem,0.65fr)_minmax(5rem,0.55fr)] @lg:gap-4 @lg:px-4";

const FeedbackModal = dynamic(() => import("@/components/feedback/feedback-modal").then(module => module.FeedbackModal), { ssr: false });

function buildSparklinePoints(candles: MarketCandle[]) {
  const closes = candles
    .map((candle) => candle.close)
    .filter((value) => Number.isFinite(value));

  if (closes.length < 2) return undefined;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const spread = max - min;
  const points = closes.map((value, index) => ({
    x: 4 + (index / (closes.length - 1)) * 120,
    y: spread === 0 ? 18 : 5 + ((max - value) / spread) * 26,
  }));
  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x));
  // Monotone cubic interpolation rounds the joins without inventing new highs/lows.
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes.at(-1)!;
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  });
  let line = `M ${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const third = (end.x - start.x) / 3;
    line += ` C ${start.x + third},${start.y + tangents[index - 1] * third} ${end.x - third},${end.y - tangents[index] * third} ${end.x},${end.y}`;
  }
  return { line, area: `${line} L 124,40 L 4,40 Z`, last: points.at(-1)! };
}

function Sparkline({ stock }: { stock: StockSummary }) {
  const t = useT();
  const gradientId = useId();
  const cacheKey = `${stock.assetId}:1D`;
  const cell = useRef<HTMLSpanElement>(null);
  const visible = useElementVisible(cell);
  const [result, setResult] = useState<{ key: string; candles: MarketCandle[] }>();
  const candles = result?.key === cacheKey ? result.candles : undefined;

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void readSparkline(stock.assetId, controller.signal)
      .then((chart) => {
        if (!controller.signal.aborted) setResult({ key: cacheKey, candles: chart });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: cacheKey, candles: [] });
      });
    return () => controller.abort();
  }, [cacheKey, stock.assetId, visible]);

  return <span className="block w-full" ref={cell}><SparklineGraphic candles={candles} gradientId={gradientId} label={t("markets.sparklineLabel", { ticker: stock.ticker })} emptyLabel={t("markets.noData24h")} /></span>;
}

function SparklineGraphic({ candles, gradientId, label, emptyLabel }: { candles?: MarketCandle[]; gradientId: string; label: string; emptyLabel: string }) {

  if (!candles) {
    return <Skeleton className="h-7 w-full max-w-28 rounded-full" />;
  }

  const points = buildSparklinePoints(candles);
  if (!points) {
    return <span className="text-xs text-muted">{emptyLabel}</span>;
  }

  const first = candles.find((candle) => Number.isFinite(candle.close))?.close ?? 0;
  const last = [...candles].reverse().find((candle) => Number.isFinite(candle.close))?.close ?? first;
  const positive = last >= first;

  return (
    <svg
      aria-label={label}
      className={cn("h-9 w-full max-w-28", positive ? "text-positive" : "text-negative")}
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 128 40"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={points.area} fill={`url(#${gradientId})`} />
      <path
        d={points.line}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={points.last.x} cy={points.last.y} fill="currentColor" r="3" />
    </svg>
  );
}

function StockRow({ stock }: { stock: StockSummary }) {
  const { locale } = useI18n();
  const change = stock.change24hPct;

  return (
    <Link
      className={cn(marketColumns, "min-h-16 rounded-lg border-b border-border/75 py-2.5 text-xs hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus @lg:text-sm")}
      href={"/app/stocks/" + encodeURIComponent(stock.assetId)}
      prefetch={false}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MarketStockLogo stock={stock} />
        <div className="min-w-0">
          <span className="block truncate font-semibold" title={stock.name}>{stock.name}</span>
          <span className="block truncate text-xs text-muted">{stock.ticker}</span>
        </div>
      </div>
      <span className="text-end font-medium font-money tabular-nums">{stock.priceUsd === undefined ? "—" : formatCurrency(stock.priceUsd, locale)}</span>
      <span className={cn("text-end font-medium font-money tabular-nums", change === undefined || change === 0 ? "text-muted" : change > 0 ? "text-positive" : "text-negative")}>
        {change === undefined ? "—" : formatPercent(change, locale, change !== 0)}
      </span>
      <span className="hidden w-full max-w-28 justify-self-end @3xl:block"><Sparkline stock={stock} /></span>
      <span className="hidden text-end text-muted font-money tabular-nums @lg:block">{stock.liquidityUsd === undefined ? "—" : formatCompactCurrency(stock.liquidityUsd, locale)}</span>
    </Link>
  );
}

function TableSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className={cn(marketColumns, "min-h-16 border-b border-border/75 py-2.5")} key={index}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-full max-w-28" />
          </div>
          <Skeleton className="h-4 w-12 justify-self-end" />
          <Skeleton className="h-4 w-10 justify-self-end" />
          <Skeleton className="hidden h-6 w-16 justify-self-end @3xl:block" />
          <Skeleton className="hidden h-4 w-12 justify-self-end @lg:block" />
        </div>
      ))}
    </div>
  );
}

export function MarketsOverview() {
  const stocks = useMarketStore((state) => state.stocks);
  const trending = useMarketStore((state) => state.trending);
  const opportunities = useMarketStore((state) => state.opportunities);
  const searchResults = useMarketStore((state) => state.searchResults);
  const isLoading = useMarketStore((state) => state.isLoading);
  const isLoadingMore = useMarketStore((state) => state.isLoadingMore);
  const loadMoreError = useMarketStore((state) => state.loadMoreError);
  const isSearching = useMarketStore((state) => state.isSearching);
  const hasMore = useMarketStore((state) => state.hasMore);
  const error = useMarketStore((state) => state.error);
  const loadMarkets = useMarketStore((state) => state.loadMarkets);
  const loadNextStocks = useMarketStore((state) => state.loadNextStocks);
  const search = useMarketStore((state) => state.search);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [requestedStock, setRequestedStock] = useState<string>();
  const t = useT();

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      void search("");
      return;
    }

    const timeout = window.setTimeout(() => void search(normalized), 300);
    return () => window.clearTimeout(timeout);
  }, [query, search]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || isLoading || isLoadingMore || loadMoreError || query.trim()) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void loadNextStocks();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, loadMoreError, loadNextStocks, query, stocks.length]);

  const searching = Boolean(query.trim());
  const rows = useMemo(
    () => (searching ? searchResults : stocks),
    [searchResults, searching, stocks],
  );
  const featured = [
    { label: t("markets.trending"), stock: trending[0] },
    { label: t("markets.opportunity"), stock: opportunities[0] },
  ];

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-panel px-3.5 focus-within:border-border-strong @lg:max-w-80">
          <SearchIcon aria-hidden="true" className="shrink-0 text-muted" size={17} strokeWidth={1.8} />
          <span className="sr-only">{t("markets.searchLabel")}</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("markets.searchPlaceholder")}
            type="search"
            value={query}
          />
        </label>
        {!searching && featured.some(({ stock }) => stock) && (
          <div className="flex flex-wrap items-center gap-2">
            {featured.map(({ label, stock }) => stock && (
              <Link className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus" href={"/app/stocks/" + encodeURIComponent(stock.assetId)} key={label} prefetch={false}>
                <span className="text-muted">{label}</span>
                <span className="font-semibold">{stock.ticker}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {!searching && (
        process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "preview" ||
        process.env.NODE_ENV === "development"
      ) && <MarketForYou />}

      <section aria-label={t("nav.markets")} aria-busy={isLoading || isSearching}>
        <div className={cn(marketColumns, "rounded-xl bg-panel-subtle py-2.5 text-xs font-medium text-muted")}>
          <span>{t("portfolio.colAsset")}</span>
          <span className="text-end">{t("markets.colPrice")}</span>
          <span className="text-end">{t("portfolio.col24h")}</span>
          <span className="hidden text-end @3xl:block">{t("markets.colLast24h")}</span>
          <span className="hidden text-end @lg:block">{t("markets.colLiquidity")}</span>
        </div>
        {(isLoading || isSearching) && rows.length === 0 ? <TableSkeleton /> : null}
        {rows.length && !(isSearching && searchResults.length === 0)
          ? rows.map((stock) => <StockRow key={stock.assetId} stock={stock} />)
          : null}
        {rows.length && !searching ? (
          <div aria-live="polite" ref={loadMoreRef}>
            {hasMore ? (
              <>
                {isLoadingMore ? <TableSkeleton count={4} /> : (
                  <div className="border-t border-border px-4 py-5 text-center">
                    {loadMoreError && <p className="mb-3 text-sm text-muted" role="alert">{t("markets.loadMoreError")}</p>}
                    <Button disabled={isLoading} onClick={() => void loadNextStocks()} size="sm" variant="secondary">{loadMoreError ? t("markets.retryLoad") : t("markets.loadMore")}</Button>
                  </div>
                )}
              </>
            ) : (
              <div className="border-t border-border px-4 py-4 text-center text-xs text-muted">
                {t("markets.allLoaded", { count: rows.length })}
              </div>
            )}
          </div>
        ) : null}
        {!isLoading && !isSearching && rows.length === 0 ? (
          <div className="border-t border-border px-4 py-12 text-center text-sm text-muted">
            {error
              ? t("markets.unavailable")
              : searching
                ? t("markets.noResults", { query: query.trim() })
                : t("markets.empty")}
            {searching && !error ? <div className="mx-auto mt-3 max-w-md"><p className="text-xs leading-5">{t("markets.coverageNote")}</p><Button className="mt-4" size="sm" variant="secondary" onClick={() => setRequestedStock(query.trim())}>{t("markets.requestStock")}</Button></div> : null}
          </div>
        ) : null}
      </section>
      {requestedStock ? <FeedbackModal onClose={() => setRequestedStock(undefined)} initialSubject={t("markets.stockRequestSubject", { query: requestedStock }).slice(0, 120)} initialMessage={t("markets.stockRequestMessage", { query: requestedStock })} /> : null}
    </div>
  );
}
