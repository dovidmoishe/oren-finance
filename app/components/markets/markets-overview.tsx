"use client";

import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, cn, formatCurrency, formatPercent } from "@/components/ui";
import { useMarketStore } from "@/store";
import type { StockSummary } from "@/types";

function SortIcon() {
  return (
    <span className="inline-flex flex-col text-muted">
      <HugeiconsIcon color="currentColor" icon={ArrowUp01Icon} size={10} strokeWidth={2} />
      <HugeiconsIcon className="-mt-1.5" color="currentColor" icon={ArrowDown01Icon} size={10} strokeWidth={2} />
    </span>
  );
}

function StockLogo({ stock }: { stock: StockSummary }) {
  const [failed, setFailed] = useState(false);

  if (stock.logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${stock.name} logo`}
        className="h-7 w-7 rounded-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
        src={normalizeLogoUrl(stock.logoUrl)}
      />
    );
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-panel-subtle font-mono text-[10px] font-semibold">
      {stock.ticker.slice(0, 2)}
    </div>
  );
}

function Sparkline({ positive }: { positive: boolean }) {
  const points = positive
    ? "2,25 11,23 20,24 29,18 38,20 47,14 56,16 65,12 74,15 83,9 92,11 101,7 110,9 126,4"
    : "2,7 11,9 20,8 29,14 38,12 47,18 56,16 65,20 74,17 83,23 92,21 101,26 110,23 126,28";

  return (
    <svg
      aria-hidden="true"
      className={cn("h-8 w-32", positive ? "text-positive" : "text-negative")}
      preserveAspectRatio="none"
      viewBox="0 0 128 32"
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="126" cy={positive ? "4" : "28"} fill="currentColor" r="3" />
    </svg>
  );
}

function normalizeLogoUrl(url: string) {
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return url;
}

function formatCompactCurrency(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "$0";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function StockRow({ stock }: { stock: StockSummary }) {
  const positive = (stock.change24hPct ?? 0) >= 0;

  return (
    <Link
      className="grid min-w-[820px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px_150px] items-center border-t border-border px-4 py-4 text-sm transition-colors hover:bg-panel-subtle"
      href={`/stocks/${stock.assetId}`}
      prefetch={false}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StockLogo stock={stock} />
        <div className="min-w-0">
          <span className="font-medium">{stock.name}</span>
          <span className="ml-2 font-mono text-muted">${stock.ticker}</span>
        </div>
      </div>
      <div className="font-mono">{formatCurrency(stock.priceUsd)}</div>
      <div className={cn("font-mono", positive ? "text-positive" : "text-negative")}>
        {positive ? "▲" : "▼"} {formatPercent(Math.abs(stock.change24hPct ?? 0), false)}
      </div>
      <Sparkline positive={positive} />
      <div className="font-mono">{formatCompactCurrency(stock.volume24hUsd)}</div>
      <div className="font-mono">{formatCompactCurrency(stock.liquidityUsd)}</div>
    </Link>
  );
}

function TableSkeleton({ count = 10 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          className="grid min-w-[820px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px_150px] items-center gap-4 border-t border-border px-4 py-4"
          key={index}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </>
  );
}

export function MarketsOverview() {
  const stocks = useMarketStore((state) => state.stocks);
  const trending = useMarketStore((state) => state.trending);
  const opportunities = useMarketStore((state) => state.opportunities);
  const searchResults = useMarketStore((state) => state.searchResults);
  const isLoading = useMarketStore((state) => state.isLoading);
  const isLoadingMore = useMarketStore((state) => state.isLoadingMore);
  const isSearching = useMarketStore((state) => state.isSearching);
  const hasMore = useMarketStore((state) => state.hasMore);
  const error = useMarketStore((state) => state.error);
  const loadMarkets = useMarketStore((state) => state.loadMarkets);
  const loadNextStocks = useMarketStore((state) => state.loadNextStocks);
  const search = useMarketStore((state) => state.search);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

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
    if (!target || !hasMore || query.trim()) return;

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
  }, [hasMore, loadNextStocks, query]);

  const searching = Boolean(query.trim());
  const rows = useMemo(
    () => (searching ? searchResults : stocks),
    [searchResults, searching, stocks],
  );
  const featured = [
    {
      title: "Trending",
      detail: "High activity equities",
      stock: trending[0] ?? stocks[0],
      className: "bg-accent-yellow",
    },
    {
      title: "Oren Opportunity",
      detail: "Highest deterministic score",
      stock: opportunities[0] ?? stocks[1],
      className: "bg-accent-pink",
    },
    {
      title: "Market Coverage",
      detail: `${stocks.length} canonical equities loaded`,
      stock: stocks[2],
      className: "bg-accent-lavender",
    },
  ];

  return (
    <div className="mx-auto max-w-[1540px] space-y-7 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Explore</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">Market</h1>
          <p className="mt-1 text-sm text-muted">Browse and research canonical tokenized equities without issuer clutter.</p>
        </div>
        <label className="flex h-11 w-full items-center gap-2 rounded-[14px] border border-border bg-panel px-4 shadow-sm focus-within:border-border-strong sm:w-[360px]">
          <HugeiconsIcon className="text-muted" color="currentColor" icon={Search01Icon} size={17} strokeWidth={1.8} />
          <span className="sr-only">Search stocks</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-2"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company or ticker"
            type="search"
            value={query}
          />
          {isSearching ? <span className="text-xs text-muted">Searching…</span> : null}
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {featured.map((item) => (
          <section className={cn("rounded-[24px] p-6 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", item.className)} key={item.title}>
            <p className="text-base font-semibold">{item.title}</p>
            <p className="mt-1 text-xs text-foreground/65">{item.detail}</p>
            {item.stock ? (
              <Link className="mt-6 flex items-end justify-between gap-4" href={`/stocks/${item.stock.assetId}`} prefetch={false}>
                <div>
                  <p className="font-display text-3xl font-semibold">{item.stock.ticker}</p>
                  <p className="mt-1 line-clamp-1 text-sm text-foreground/70">{item.stock.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">{formatCurrency(item.stock.priceUsd)}</p>
                  <ChangePill positive={(item.stock.change24hPct ?? 0) >= 0} value={item.stock.change24hPct} />
                </div>
              </Link>
            ) : (
              <div className="mt-6 text-sm text-foreground/60">Loading market data</div>
            )}
          </section>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[24px] border border-border bg-panel shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
        <div className="grid min-w-[820px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px_150px] bg-panel-subtle/70 px-4 py-3 text-xs font-semibold text-foreground">
          <div className="flex items-center gap-1">Token Name <SortIcon /></div>
          <div className="flex items-center gap-1">Price <SortIcon /></div>
          <div className="flex items-center gap-1">1D <SortIcon /></div>
          <div>Last 24h</div>
          <div className="flex items-center gap-1">24h Volume <SortIcon /></div>
          <div className="flex items-center gap-1">Liquidity <SortIcon /></div>
        </div>
        {(isLoading || isSearching) && rows.length === 0 ? <TableSkeleton /> : null}
        {!isLoading && !isSearching && rows.length
          ? rows.map((stock) => <StockRow key={stock.assetId} stock={stock} />)
          : null}
        {rows.length && !searching ? (
          <div aria-live="polite" ref={loadMoreRef}>
            {isLoadingMore ? (
              <TableSkeleton count={10} />
            ) : (
              <div className="border-t border-border px-4 py-4 text-center text-xs text-muted">
                {hasMore ? "Scroll for more stocks" : `All ${rows.length} stocks loaded`}
              </div>
            )}
          </div>
        ) : null}
        {!isLoading && !isSearching && rows.length === 0 ? (
          <div className="border-t border-border px-4 py-12 text-center text-sm text-muted">
            {error
              ? "Market data is unavailable right now."
              : searching
                ? `No stocks found for “${query.trim()}”.`
                : "No stocks yet."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChangePill({ positive, value }: { positive: boolean; value?: number }) {
  return (
    <span className={cn("mt-2 inline-flex rounded-full bg-panel px-2 py-1 text-xs font-semibold", positive ? "text-foreground" : "text-negative")}>
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(value ?? 0), false)}
    </span>
  );
}
