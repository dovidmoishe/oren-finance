"use client";

import {
  ArrowLeft01Icon,
  Briefcase01Icon,
  CoinsSwapIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketChart, type MarketChartMode, type MarketChartRange } from "@/components/charts";
import { BasketReview } from "@/components/trading";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/components/ui";
import { useExecutionStore, useSocialStore, useWalletStore } from "@/store";
import type { PortfolioPosition } from "@/types";

function TraderAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={`${name} avatar`} className="h-14 w-14 rounded-full border border-border object-cover" src={avatarUrl} />
    );
  }

  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-foreground font-display text-lg font-semibold text-white">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function PositionLogo({ position }: { position: PortfolioPosition }) {
  if (position.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={`${position.name} logo`} className="h-8 w-8 rounded-full border border-border object-contain p-1" src={position.logoUrl} />
    );
  }

  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-subtle font-mono text-[10px] font-semibold">
      {position.ticker.slice(0, 2)}
    </div>
  );
}

function DetailMetric({ label, value, detail, className }: { label: string; value: string; detail: string; className: string }) {
  return (
    <section className={cn("rounded-[24px] p-6 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", className)}>
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-xs text-foreground/65">{detail}</p>
      <p className="mt-7 font-display text-3xl font-semibold tracking-normal">{value}</p>
    </section>
  );
}

function CopyPortfolioDrawer({ slug }: { slug: string }) {
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const proposal = useSocialStore((state) => state.copyProposal);
  const isCopying = useSocialStore((state) => state.isCopying);
  const copyError = useSocialStore((state) => state.copyError);
  const prepareCopy = useSocialStore((state) => state.prepareCopy);
  const clearCopy = useSocialStore((state) => state.clearCopy);
  const preparedBasket = useExecutionStore((state) => state.preparedBasket);
  const executionError = useExecutionStore((state) => state.error);
  const executionLoading = useExecutionStore((state) => state.isLoading);
  const prepareBasketTrades = useExecutionStore((state) => state.prepareBasketTrades);
  const resetAll = useExecutionStore((state) => state.resetAll);
  const [open, setOpen] = useState(false);
  const [amountUsd, setAmountUsd] = useState("100");

  const close = () => {
    setOpen(false);
    clearCopy();
    resetAll();
  };

  const handlePrepareCopy = async () => {
    if (!wallet || !connected) return;
    await prepareCopy({
      sourceSlug: slug,
      wallet,
      amountUsd: Number(amountUsd),
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="primary">
        <HugeiconsIcon color="currentColor" icon={CoinsSwapIcon} size={16} strokeWidth={1.8} />
        Copy portfolio
      </Button>
      <Modal onClose={close} open={open} side="right" title="Copy portfolio">
        <div className="space-y-4">
          <div className="rounded-[18px] border border-border bg-panel-subtle p-4">
            <p className="text-sm font-semibold">Choose allocation amount</p>
            <p className="mt-1 text-xs leading-5 text-muted">Oren will prepare a basket proposal. You review and sign each transaction.</p>
            <label className="mt-4 block text-xs font-semibold text-muted">
              USDC amount
              <input
                className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-mono text-sm text-foreground outline-none focus:border-border-strong"
                min="5"
                onChange={(event) => setAmountUsd(event.target.value)}
                step="1"
                type="number"
                value={amountUsd}
              />
            </label>
            <Button className="mt-4 w-full" disabled={!connected || isCopying} onClick={handlePrepareCopy} variant="primary">
              {isCopying ? "Building proposal..." : "Build copy proposal"}
            </Button>
          </div>

          {copyError ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{copyError}</p> : null}

          {proposal ? (
            <>
              <BasketReview basket={proposal.basket} progress={preparedBasket?.progress} />
              {proposal.skippedAssets.length ? (
                <div className="rounded-[18px] border border-border bg-panel-subtle p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Skipped</p>
                  <div className="mt-2 space-y-2">
                    {proposal.skippedAssets.slice(0, 4).map((asset, index) => (
                      <p className="text-xs text-muted" key={`${asset.assetId}-${index}`}>
                        {asset.ticker ?? "Asset"}: {asset.reason}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              {executionError ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{executionError}</p> : null}
              <Button
                className="w-full"
                disabled={!wallet || executionLoading}
                onClick={() => wallet && void prepareBasketTrades({ basketId: proposal.basket.id, wallet })}
                variant="secondary"
              >
                {executionLoading ? (
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={15} strokeWidth={1.8} />
                ) : null}
                Prepare basket quotes
              </Button>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export function TraderProfile({ slug }: { slug: string }) {
  const trader = useSocialStore((state) => state.selectedTrader);
  const timeframe = useSocialStore((state) => state.timeframe);
  const isLoading = useSocialStore((state) => state.isLoading);
  const error = useSocialStore((state) => state.error);
  const loadTrader = useSocialStore((state) => state.loadTrader);
  const [chartMode, setChartMode] = useState<MarketChartMode>("line");
  const [chartRange, setChartRange] = useState<MarketChartRange>("30D");

  useEffect(() => {
    void loadTrader(slug, "30D");
  }, [loadTrader, slug]);

  const chartData = useMemo(
    () =>
      trader?.history.points.map((point) => ({
        timestamp: point.timestamp,
        value: point.totalValueUsd,
      })) ?? [],
    [trader],
  );

  if (isLoading && !trader) {
    return (
      <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
        <Skeleton className="h-32" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  if (!trader) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <ErrorState description={error ?? "This public trader profile could not be loaded."} onRetry={() => void loadTrader(slug, timeframe)} title="Trader unavailable" />
      </div>
    );
  }

  const positions = trader.portfolio.positions;
  const positive = trader.stats.pnlPct >= 0;

  return (
    <div className="mx-auto max-w-[1540px] space-y-6 pb-20">
      <Link className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground" href="/leaderboard">
        <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={16} strokeWidth={1.8} />
        Back to leaderboard
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-5 rounded-[24px] border border-border bg-panel p-6 shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
        <div className="flex min-w-0 items-center gap-4">
          <TraderAvatar avatarUrl={trader.profile.avatarUrl} name={trader.profile.displayName} />
          <div className="min-w-0">
            <p className="text-sm text-muted">Rank #{trader.stats.rank} · {trader.profile.walletPreview}</p>
            <h1 className="truncate font-display text-4xl font-semibold tracking-normal">{trader.profile.displayName}</h1>
            {trader.profile.bio ? <p className="mt-1 max-w-2xl text-sm text-muted">{trader.profile.bio}</p> : null}
          </div>
        </div>
        <CopyPortfolioDrawer slug={slug} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <DetailMetric className="bg-accent-yellow" detail={`${trader.timeframe} observed return`} label="P&L" value={`${positive ? "+" : ""}${formatPercent(trader.stats.pnlPct, false)}`} />
        <DetailMetric className="bg-accent-pink" detail="Observed portfolio value" label="Portfolio" value={formatCurrency(trader.portfolio.totalValueUsd)} />
        <DetailMetric className="bg-accent-lavender" detail="Oren-observed P&L dollars" label="Net Change" value={formatCurrency(trader.stats.pnlUsd)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <MarketChart
          activeRange={chartRange}
          changePct={trader.stats.pnlPct}
          className="min-w-0 rounded-[24px]"
          dateLabel={formatDate(trader.stats.updatedAt)}
          emptyDescription="This trader needs more Oren snapshots before the public chart fills in."
          lineData={chartData}
          mode={chartMode}
          onModeChange={setChartMode}
          onRangeChange={setChartRange}
          value={trader.portfolio.totalValueUsd}
        />
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">Allocation</h2>
            <p className="mt-1 text-sm text-muted">Largest observed holdings.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {positions.length ? (
              positions.slice(0, 6).map((position) => (
                <div className="space-y-2" key={position.assetId}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{position.ticker}</span>
                    <span className="font-mono">{formatPercent(position.allocationPct, false)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-subtle">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, position.allocationPct))}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState description="This public wallet has no supported tokenized stock positions yet." title="No holdings" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5">
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-xl font-semibold">Holdings</h2>
            <p className="mt-1 text-sm text-muted">Amounts, values, and allocation inside this public wallet.</p>
          </CardHeader>
          {positions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Allocation</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((position) => (
                    <TableRow className="transition-colors hover:bg-panel-subtle/70" key={position.assetId}>
                      <TableCell>
                        <Link className="flex min-w-[220px] items-center gap-3" href={`/stocks/${position.assetId}`}>
                          <PositionLogo position={position} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{position.name}</div>
                            <div className="font-mono text-xs text-muted">{position.ticker}</div>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{formatPercent(position.allocationPct, false)}</TableCell>
                      <TableCell className="font-mono">{formatNumber(position.quantity)}</TableCell>
                      <TableCell>{formatCurrency(position.priceUsd)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(position.valueUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState description="Supported tokenized equities will appear here after Oren observes them." title="No holdings yet" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
