'use client';

import {
  Activity01Icon,
  ArrowUpRight01Icon,
  Briefcase01Icon,
  ChartLineData01Icon,
  Clock01Icon,
  CoinsSwapIcon,
  SafeIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect } from 'react';
import type { AgentArtifact, BasketResponse, LimitOrderProposal, QuoteResponse } from '@/types';
import { TechnicalBriefPanel } from '@/components/stock/technical-brief-panel';
import { Button, cn, formatCurrency, formatNumber } from '@/components/ui';
import { useQuoteRefresh } from '@/hooks/use-quote-refresh';
import { useExecutionStore } from '@/store';

interface AgentArtifactsProps {
  artifacts: AgentArtifact[];
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
}

export function AgentArtifacts({
  artifacts,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
}: AgentArtifactsProps) {
  return (
    <div className="mt-3 space-y-3">
      {artifacts.map((artifact, index) => (
        <AgentArtifactCard
          artifact={artifact}
          key={`${artifact.type}-${index}`}
          onReviewBasket={onReviewBasket}
          onReviewLimitOrder={onReviewLimitOrder}
          onReviewQuote={onReviewQuote}
        />
      ))}
    </div>
  );
}

function AgentArtifactCard({
  artifact,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
}: {
  artifact: AgentArtifact;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
}) {
  switch (artifact.type) {
    case 'portfolio': {
      const portfolio = artifact.data;
      return (
        <ArtifactShell icon={Briefcase01Icon} label="Portfolio" tone="pink">
          <p className="font-display text-2xl font-semibold">
            {formatCurrency(portfolio.totalValueUsd)}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Available" value={formatCurrency(portfolio.availableValueUsd)} />
            <Metric label="Locked" value={formatCurrency(portfolio.lockedValueUsd)} />
          </div>
          {portfolio.positions.length ? (
            <div className="mt-3 space-y-2 border-t border-black/8 pt-3">
              {portfolio.positions.slice(0, 3).map((position) => (
                <div className="flex items-center justify-between text-xs" key={position.assetId}>
                  <span className="font-semibold">{position.ticker}</span>
                  <span className="font-mono">
                    {formatCurrency(position.valueUsd)} ·{' '}
                    {portfolio.totalValueUsd > 0
                      ? `${formatNumber((position.valueUsd / portfolio.totalValueUsd) * 100, 0)}%`
                      : '0%'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </ArtifactShell>
      );
    }
    case 'stock': {
      const stock = artifact.data;
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Stock snapshot" tone="plain">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold">{stock.ticker}</p>
              <p className="text-xs text-muted">{stock.name}</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-semibold">
                {stock.priceUsd === undefined ? '—' : formatCurrency(stock.priceUsd)}
              </p>
              <p className={cn('text-xs', (stock.change24hPct ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
                {stock.change24hPct === undefined
                  ? 'No daily change'
                  : `${stock.change24hPct >= 0 ? '+' : ''}${formatNumber(stock.change24hPct, 2)}%`}
              </p>
            </div>
          </div>
          <Link className="mt-4 inline-flex items-center gap-1 text-xs font-semibold" href={`/stocks/${stock.assetId}`}>
            Open stock <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={1.8} />
          </Link>
        </ArtifactShell>
      );
    }
    case 'analysis': {
      const analysis = artifact.data;
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Oren analysis" tone="lavender">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold">{analysis.ticker}</p>
              <p className="mt-1 text-xs capitalize text-muted">
                {analysis.riskLabel ? `${analysis.riskLabel} risk` : 'Risk profile unavailable'}
              </p>
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-full bg-foreground text-white">
              <span className="font-display text-lg font-semibold">{Math.round(analysis.opportunityScore)}</span>
            </div>
          </div>
          {analysis.summary ? (
            <p className="mt-3 text-xs leading-5 text-muted">{analysis.summary}</p>
          ) : null}
          {analysis.technicalBrief ? (
            <div className="mt-3 border-t border-black/8 pt-3">
              <TechnicalBriefPanel brief={analysis.technicalBrief} compact />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="RSI" value={formatSignal(analysis.signals.rsi14)} />
              <Metric label="30d momentum" value={formatPercentSignal(analysis.signals.momentum30d)} />
              <Metric label="30d volatility" value={formatPercentSignal(analysis.signals.volatility30d)} />
            </div>
          )}
          {analysis.highlights.length ? (
            <div className="mt-3 border-t border-black/8 pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Signals &amp; strengths
              </p>
              <ul className="space-y-1.5 text-xs leading-5">
              {analysis.highlights.slice(0, 3).map((highlight) => (
                <li className="flex gap-2" key={highlight}>
                  <span aria-hidden>•</span><span>{highlight}</span>
                </li>
              ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 rounded-[13px] bg-white/55 px-3 py-2 text-[11px] leading-4 text-muted">
            Risk: {analysis.riskLabel ?? 'unclassified'}. Scores are deterministic signals, not a guarantee of returns.
          </p>
        </ArtifactShell>
      );
    }
    case 'opportunities':
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Top opportunities" tone="yellow">
          <div className="space-y-2">
            {artifact.data.slice(0, 5).map((stock, index) => (
              <Link
                className="flex items-center justify-between rounded-[14px] bg-white/70 px-3 py-2 text-xs hover:bg-white"
                href={`/stocks/${stock.assetId}`}
                key={stock.assetId}
              >
                <span><span className="mr-2 text-muted">{index + 1}</span><strong>{stock.ticker}</strong></span>
                <span className="font-mono font-semibold">{Math.round(stock.opportunityScore ?? 0)}</span>
              </Link>
            ))}
          </div>
        </ArtifactShell>
      );
    case 'quote':
      return <QuoteArtifact key={artifact.data.id} onReview={onReviewQuote} quote={artifact.data} />;
    case 'limit_order':
      return (
        <ArtifactShell icon={CoinsSwapIcon} label="Limit order proposal" tone="lavender">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted capitalize">
                {artifact.data.side} limit
              </p>
              <p className="font-display text-xl font-semibold">{artifact.data.ticker}</p>
            </div>
            <p className="font-mono text-sm font-semibold">
              {formatCurrency(artifact.data.limitPriceUsd)}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-black/8 pt-3 text-xs">
            <span className="text-muted">Notional</span>
            <span className="font-mono">{formatCurrency(artifact.data.amountUsd)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted">If filled</span>
            <span className="font-mono">
              {formatNumber(artifact.data.takingAmount, 6)} {artifact.data.outputSymbol}
            </span>
          </div>
          {artifact.data.wouldFillImmediately ? (
            <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
              This limit is already through market — it may fill right after you sign.
            </p>
          ) : null}
          <Button
            className="mt-4 h-10 w-full rounded-[14px]"
            onClick={() => onReviewLimitOrder(artifact.data)}
            variant="primary"
          >
            Review limit order
          </Button>
        </ArtifactShell>
      );
    case 'limit_orders':
      return (
        <ArtifactShell icon={Clock01Icon} label="Limit orders" tone="plain">
          {artifact.data.length === 0 ? (
            <p className="text-xs text-muted">No open limit orders for this wallet.</p>
          ) : (
            <div className="space-y-2">
              {artifact.data.slice(0, 5).map((order) => (
                <div
                  className="flex items-center justify-between rounded-[14px] bg-white/70 px-3 py-2 text-xs"
                  key={order.orderKey}
                >
                  <span>
                    <strong className="capitalize">{order.side}</strong>{' '}
                    {order.ticker ?? '—'} @ {formatCurrency(order.limitPriceUsd)}
                  </span>
                  <span className="font-mono capitalize text-muted">{order.status}</span>
                </div>
              ))}
            </div>
          )}
        </ArtifactShell>
      );
    case 'basket':
      return (
        <ArtifactShell icon={Briefcase01Icon} label="Basket proposal" tone="pink">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold">{formatCurrency(artifact.data.totalAmountUsd)}</p>
              <p className="text-xs capitalize text-muted">{artifact.data.riskLabel ?? 'Risk pending'}</p>
            </div>
            <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-semibold">
              {artifact.data.allocations.length} stocks
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {artifact.data.allocations.map((allocation) => (
              <span className="rounded-full bg-white/75 px-2 py-1 text-[11px] font-semibold" key={allocation.assetId}>
                {allocation.ticker} {formatNumber(allocation.weightPercent, 0)}%
              </span>
            ))}
          </div>
          {artifact.data.thesis ? (
            <p className="mt-3 text-xs leading-5 text-muted">{artifact.data.thesis}</p>
          ) : null}
          <Button className="mt-4 h-10 w-full rounded-[14px]" onClick={() => onReviewBasket(artifact.data)} variant="primary">
            Review basket
          </Button>
        </ArtifactShell>
      );
    case 'copy_portfolio_proposal':
      return (
        <ArtifactShell icon={Briefcase01Icon} label="Copy portfolio" tone="lavender">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Copying {artifact.data.source.displayName}</p>
              <p className="font-display text-xl font-semibold">{formatCurrency(artifact.data.amountUsd)}</p>
            </div>
            <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-semibold">
              {artifact.data.allocations.length} stocks
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {artifact.data.allocations.map((allocation) => (
              <span className="rounded-full bg-white/75 px-2 py-1 text-[11px] font-semibold" key={allocation.assetId}>
                {allocation.ticker} {formatNumber(allocation.weightPercent, 0)}%
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">{artifact.data.riskCopy}</p>
          <Button className="mt-4 h-10 w-full rounded-[14px]" onClick={() => onReviewBasket(artifact.data.basket)} variant="primary">
            Review copy basket
          </Button>
        </ArtifactShell>
      );
    case 'trading_calendar':
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Trading calendar" tone="yellow">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{artifact.data.range.month ?? `${artifact.data.range.start} to ${artifact.data.range.end}`}</p>
              <p className="font-display text-xl font-semibold">
                {formatCurrency(artifact.data.days.reduce((sum, day) => sum + day.pnlUsd, 0))}
              </p>
            </div>
            <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-semibold">
              {artifact.data.days.filter((day) => day.hasData).length} days
            </span>
          </div>
          <Link className="mt-4 inline-flex items-center gap-1 text-xs font-semibold" href="/calendar">
            Open calendar <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={1.8} />
          </Link>
        </ArtifactShell>
      );
    case 'trading_calendar_day':
      return (
        <ArtifactShell icon={Activity01Icon} label="Calendar day" tone="plain">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{artifact.data.date}</p>
              <p className="font-display text-xl font-semibold">{formatCurrency(artifact.data.summary.pnlUsd)}</p>
            </div>
            <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', artifact.data.summary.pnlUsd >= 0 ? 'bg-accent-yellow' : 'bg-accent-pink')}>
              {formatNumber(artifact.data.summary.returnPct, 2)}%
            </span>
          </div>
          {artifact.data.contributors.length ? (
            <div className="mt-3 space-y-2 border-t border-black/8 pt-3">
              {artifact.data.contributors.slice(0, 3).map((item) => (
                <div className="flex items-center justify-between text-xs" key={item.assetId}>
                  <span className="font-semibold">{item.ticker}</span>
                  <span className="font-mono">{formatCurrency(item.valueChangeUsd)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </ArtifactShell>
      );
    case 'vaults':
      return (
        <ArtifactShell icon={SafeIcon} label="Vault" tone="lavender">
          <p className="font-display text-2xl font-semibold">{formatCurrency(artifact.data.totalLockedValueUsd)}</p>
          <p className="mt-1 text-xs text-muted">{artifact.data.positions.length} locked position{artifact.data.positions.length === 1 ? '' : 's'}</p>
        </ArtifactShell>
      );
    case 'prepared_swap':
    case 'prepared_basket':
    case 'prepared_lock':
    case 'prepared_unlock':
      return (
        <ArtifactShell icon={SafeIcon} label="Prepared action" tone="plain">
          <p className="text-sm font-semibold">Wallet review required</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Oren prepared unsigned transaction data. A fresh review artifact is required before anything can be signed.
          </p>
        </ArtifactShell>
      );
  }
}

function QuoteArtifact({
  quote,
  onReview,
}: {
  quote: QuoteResponse;
  onReview: (quote: QuoteResponse) => void;
}) {
  const seedQuote = useExecutionStore((state) => state.seedQuote);
  const storeQuote = useExecutionStore((state) => state.quote);
  const {
    secondsLeft,
    expired,
    isRefreshingQuote,
    refreshFailed,
    refreshQuote,
  } = useQuoteRefresh({
    enabled: true,
    seedQuote: quote,
  });

  useEffect(() => {
    seedQuote(quote);
  }, [quote, seedQuote]);

  const liveQuote =
    storeQuote?.id === quote.id ||
    (storeQuote?.assetId === quote.assetId &&
      storeQuote?.side === quote.side &&
      storeQuote?.amountUsd === quote.amountUsd)
      ? storeQuote
      : quote;

  return (
    <ArtifactShell icon={CoinsSwapIcon} label="Executable quote" tone="yellow">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-muted">{liveQuote.side}</p>
          <p className="font-display text-xl font-semibold">{liveQuote.ticker}</p>
        </div>
        <p className="font-mono text-sm font-semibold">{formatCurrency(liveQuote.amountUsd)}</p>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-black/8 pt-3 text-xs">
        <span className="text-muted">Estimated receive</span>
        <span className="font-mono">{formatNumber(liveQuote.outputAmount, 6)} {liveQuote.outputSymbol}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted">Price impact</span>
        <span className="font-mono">{formatNumber(liveQuote.priceImpactPercent, 2)}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted">Quote expiry</span>
        <span className="font-mono">
          {isRefreshingQuote
            ? 'Updating…'
            : expired
              ? 'Refreshing…'
              : `${secondsLeft}s left`}
        </span>
      </div>
      <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
        {refreshFailed
          ? 'Could not refresh this quote. Retry to keep it actionable.'
          : isRefreshingQuote || expired
            ? 'Updating the live route so you can still review and sign.'
            : 'Live quotes can move before signing. Review route, expiry, and wallet details before approval.'}
      </p>
      {refreshFailed ? (
        <Button
          className="mt-4 h-10 w-full rounded-[14px]"
          onClick={() => void refreshQuote()}
          variant="secondary"
        >
          <HugeiconsIcon icon={Clock01Icon} size={15} strokeWidth={1.8} />
          Retry quote refresh
        </Button>
      ) : (
        <Button
          className="mt-4 h-10 w-full rounded-[14px]"
          disabled={isRefreshingQuote || expired}
          onClick={() => onReview(liveQuote)}
          variant="primary"
        >
          <HugeiconsIcon
            icon={isRefreshingQuote || expired ? Clock01Icon : CoinsSwapIcon}
            size={15}
            strokeWidth={1.8}
          />
          {isRefreshingQuote || expired ? 'Updating quote…' : 'Review quote'}
        </Button>
      )}
    </ArtifactShell>
  );
}

function ArtifactShell({
  icon,
  label,
  tone,
  children,
}: {
  icon: IconSvgElement;
  label: string;
  tone: 'plain' | 'pink' | 'yellow' | 'lavender';
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-[20px] border border-black/8 p-4 shadow-[0_12px_34px_rgba(23,23,23,0.05)]',
        tone === 'plain' && 'bg-panel',
        tone === 'pink' && 'bg-accent-pink-soft',
        tone === 'yellow' && 'bg-[#fff9c9]',
        tone === 'lavender' && 'bg-[#f1edff]',
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        <HugeiconsIcon icon={icon} size={13} strokeWidth={1.8} />
        {label}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-white/70 p-3">
      <p className="text-muted">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatSignal(value?: number) {
  return value === undefined ? '—' : formatNumber(value, 1);
}

function formatPercentSignal(value?: number) {
  return value === undefined ? '—' : `${value >= 0 ? '+' : ''}${formatNumber(value, 1)}%`;
}
