"use client";

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  CoinsSwapIcon,
  Loading03Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuoteExecution } from "@/hooks/use-quote-execution";
import { useQuoteRefresh } from "@/hooks/use-quote-refresh";
import { useLimitOrderExecution } from "@/hooks/use-limit-order-execution";
import { listLimitOrders, proposeLimitOrder } from "@/services";
import { Button, Card, cn, formatCurrency, formatNumber } from "@/components/ui";
import { useExecutionStore, usePortfolioStore } from "@/store";
import type { LimitOrderProposal, LimitOrderRecord, LimitZone, StockDetail, TradeSide } from "@/types";
import { QuoteReviewModal } from "./quote-review-modal";
import { LimitOrderReviewModal } from "./limit-order-review-modal";

type OrderMode = "market" | "limit";

interface StockTradeTicketProps {
  stock: StockDetail;
  limitZones?: LimitZone[];
  onConfirmed?: () => Promise<void> | void;
}

function normalizeLogoUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function TokenBadge({
  symbol,
  name,
  logoUrl,
  tone = "stock",
}: {
  symbol: string;
  name: string;
  logoUrl?: string;
  tone?: "stock" | "cash";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`${name} logo`} className="h-8 w-8 rounded-full border border-border bg-white object-contain p-1" src={logoUrl} />
      ) : (
        <div
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
            tone === "cash" ? "bg-accent-yellow text-foreground" : "bg-accent-pink text-foreground",
          )}
        >
          {symbol.slice(0, 2)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-semibold">{symbol}</p>
        <p className="truncate text-xs text-muted">{name}</p>
      </div>
    </div>
  );
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

function roughlyEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.000001;
}

function isNoRouteError(message?: string) {
  return Boolean(message?.toLowerCase().includes("no jupiter routes"));
}

export function StockTradeTicket({ stock, limitZones, onConfirmed }: StockTradeTicketProps) {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58();
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const quote = useExecutionStore((state) => state.quote);
  const prepared = useExecutionStore((state) => state.prepared);
  const isLoading = useExecutionStore((state) => state.isLoading);
  const isRefreshingQuote = useExecutionStore((state) => state.isRefreshingQuote);
  const quoteTrade = useExecutionStore((state) => state.quoteTrade);
  const resetTrade = useExecutionStore((state) => state.resetTrade);
  const [openOrders, setOpenOrders] = useState<LimitOrderRecord[]>([]);
  const refreshOpenOrders = useCallback(async () => {
    if (!wallet) {
      setOpenOrders([]);
      return;
    }
    try {
      const orders = await listLimitOrders(wallet);
      setOpenOrders(
        orders.filter(
          (order) =>
            order.status === "open" &&
            (order.assetId === stock.assetId || order.ticker === stock.ticker),
        ),
      );
    } catch {
      // Keep last known list; listing is best-effort.
    }
  }, [stock.assetId, stock.ticker, wallet]);
  const {
    confirmation,
    error: executionError,
    executeQuote,
    flowStatus,
    resetFeedback,
    setError: setLocalError,
    setFlowStatus,
  } = useQuoteExecution(onConfirmed);
  const {
    confirmation: limitConfirmation,
    error: limitError,
    executeLimitOrder,
    cancelLimitOrder,
    flowStatus: limitFlowStatus,
    resetFeedback: resetLimitFeedback,
  } = useLimitOrderExecution(useCallback(async () => {
    await refreshOpenOrders();
    await onConfirmed?.();
  }, [onConfirmed, refreshOpenOrders]));
  const {
    secondsLeft,
    refreshFailed,
    refreshQuote,
  } = useQuoteRefresh({
    enabled: Boolean(connected && wallet),
    flowStatus,
  });
  const [orderMode, setOrderMode] = useState<OrderMode>("market");
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("100");
  const [limitPrice, setLimitPrice] = useState(() => {
    const buyZone = limitZones?.find((zone) => zone.side === "buy");
    return buyZone ? String(buyZone.preferredUsd) : "";
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [limitProposal, setLimitProposal] = useState<LimitOrderProposal>();
  const [limitReviewOpen, setLimitReviewOpen] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const autoQuoteKeyRef = useRef<string | undefined>(undefined);
  const tradableRoutes = stock.variants.filter((variant) => variant.tradable).length;
  const position = useMemo(
    () => portfolio?.positions.find((item) => item.assetId === stock.assetId || item.ticker === stock.ticker),
    [portfolio?.positions, stock.assetId, stock.ticker],
  );
  const cashBalance = portfolio?.cashValueUsd;
  const stockBalance = position?.availableQuantity ?? 0;
  const parsedAmount = Number(amount);
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const parsedLimitPrice = Number(limitPrice);
  const limitPriceIsValid = Number.isFinite(parsedLimitPrice) && parsedLimitPrice > 0;
  const sideZone = limitZones?.find((zone) => zone.side === side);
  const buyAmountUsd = side === "buy" && amountIsValid ? parsedAmount : 0;
  const sellQuantity = side === "sell" && amountIsValid ? parsedAmount : 0;
  const activeQuote =
    quote &&
    quote.assetId === stock.assetId &&
    quote.side === side &&
    (side === "buy" ? roughlyEqual(quote.amountUsd, parsedAmount) : roughlyEqual(quote.inputAmount, parsedAmount))
      ? quote
      : undefined;
  const estimatedReceive =
    activeQuote
      ? activeQuote.outputAmount
      : side === "buy"
        ? stock.priceUsd
          ? buyAmountUsd / stock.priceUsd
          : 0
        : sellQuantity * (stock.priceUsd ?? 0);
  const formattedOutput =
    side === "buy"
      ? `${formatNumber(estimatedReceive, 6)} ${stock.ticker}`
      : formatCurrency(estimatedReceive);
  const blockingError =
    tradableRoutes === 0
      ? "No tradable route is available for this stock yet."
      : !amountIsValid
        ? "Enter an amount greater than zero."
        : side === "buy" && typeof cashBalance === "number" && parsedAmount > cashBalance
          ? "Insufficient USDC cash balance."
          : side === "sell" && parsedAmount > stockBalance
            ? "Insufficient stock balance."
            : undefined;
  const logoUrl = normalizeLogoUrl(stock.logoUrl);
  const displayedError = executionError;
  const liveRouteUnavailable = isNoRouteError(displayedError);
  const routeValue = activeQuote
    ? `${activeQuote.provider} · ${activeQuote.variant.symbol}`
    : isLoading
      ? "Fetching quote"
      : liveRouteUnavailable
        ? "No live Jupiter route"
        : tradableRoutes
          ? `${tradableRoutes} catalog route${tradableRoutes === 1 ? "" : "s"}`
          : "No route";
  const minimumReceivedValue = activeQuote
    ? `${formatNumber(activeQuote.outputAmount * (1 - activeQuote.slippageBps / 10_000), 6)} ${activeQuote.outputSymbol}`
    : isLoading
      ? "Fetching quote"
      : liveRouteUnavailable
        ? "Unavailable"
        : "Waiting for quote";

  useEffect(() => {
    if (wallet && (!portfolio || portfolio.wallet !== wallet)) {
      void loadPortfolio(wallet);
    }
  }, [loadPortfolio, portfolio, wallet]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshOpenOrders();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshOpenOrders]);

  useEffect(() => {
    resetTrade();
    resetFeedback();
    resetLimitFeedback();
    return resetTrade;
  }, [resetFeedback, resetLimitFeedback, resetTrade]);

  const requestQuote = useCallback(
    async ({ openReview }: { openReview: boolean }) => {
      setLocalError(undefined);

      if (!connected || !wallet) {
        if (openReview) setVisible(true);
        return;
      }

      if (blockingError) {
        setLocalError(blockingError);
        return;
      }

      setFlowStatus("idle");
      await quoteTrade({
        wallet,
        assetId: stock.assetId,
        ticker: stock.ticker,
        side,
        amountUsd: side === "buy" ? parsedAmount : undefined,
        amount: side === "sell" ? parsedAmount : undefined,
        slippageBps: 50,
      });

      const nextQuote = useExecutionStore.getState().quote;
      const nextError = useExecutionStore.getState().error;
      if (nextQuote) {
        setFlowStatus("quoted");
        if (openReview) setReviewOpen(true);
      } else if (nextError) {
        setFlowStatus("failed");
        setLocalError(nextError);
      }
    },
    [
      blockingError,
      connected,
      parsedAmount,
      quoteTrade,
      setFlowStatus,
      setLocalError,
      setVisible,
      side,
      stock.assetId,
      stock.ticker,
      wallet,
    ],
  );

  useEffect(() => {
    if (orderMode !== "market") return;
    if (!connected || !wallet || blockingError || isLoading || isRefreshingQuote) {
      return;
    }

    const quoteKey = `${wallet}:${stock.assetId}:${side}:${parsedAmount}`;
    const hasMatchingLiveQuote =
      activeQuote && new Date(activeQuote.expiresAt).getTime() > Date.now();
    if (hasMatchingLiveQuote) {
      autoQuoteKeyRef.current = quoteKey;
      return;
    }

    if (autoQuoteKeyRef.current === quoteKey && activeQuote) {
      return;
    }

    const timeout = window.setTimeout(() => {
      autoQuoteKeyRef.current = quoteKey;
      void requestQuote({ openReview: false });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [
    activeQuote,
    blockingError,
    connected,
    isLoading,
    isRefreshingQuote,
    orderMode,
    parsedAmount,
    requestQuote,
    side,
    stock.assetId,
    wallet,
  ]);

  const handleModeChange = (nextMode: OrderMode) => {
    setOrderMode(nextMode);
    setReviewOpen(false);
    setLimitReviewOpen(false);
    setLimitProposal(undefined);
    setLocalError(undefined);
    resetLimitFeedback();
    if (nextMode === "market") {
      autoQuoteKeyRef.current = undefined;
    }
  };

  const handleSideChange = (nextSide: TradeSide) => {
    setSide(nextSide);
    autoQuoteKeyRef.current = undefined;
    resetTrade();
    setFlowStatus("idle");
    setLocalError(undefined);
    setReviewOpen(false);
    setLimitProposal(undefined);
    setLimitReviewOpen(false);
    const zone = limitZones?.find((item) => item.side === nextSide);
    setLimitPrice(zone ? String(zone.preferredUsd) : "");
  };

  const handleAmountChange = (nextAmount: string) => {
    setAmount(nextAmount);
    autoQuoteKeyRef.current = undefined;
    if (quote || prepared || confirmation) {
      resetTrade();
      setFlowStatus("idle");
      setLocalError(undefined);
    }
  };

  const handleQuote = async () => {
    await requestQuote({ openReview: true });
  };

  const handlePrepareSignConfirm = async () => {
    await executeQuote();
  };

  const handleProposeLimit = async () => {
    setLocalError(undefined);
    if (!connected || !wallet) {
      setVisible(true);
      return;
    }
    if (blockingError) {
      setLocalError(blockingError);
      return;
    }
    if (!limitPriceIsValid) {
      setLocalError("Enter a valid limit price.");
      return;
    }

    setLimitBusy(true);
    try {
      const proposal = await proposeLimitOrder({
        wallet,
        assetId: stock.assetId,
        ticker: stock.ticker,
        side,
        amountUsd: side === "buy" ? parsedAmount : undefined,
        amount: side === "sell" ? parsedAmount : undefined,
        limitPriceUsd: parsedLimitPrice,
        basis: sideZone?.basis,
        slippageBps: 0,
      });
      setLimitProposal(proposal);
      setLimitReviewOpen(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Unable to propose limit order");
    } finally {
      setLimitBusy(false);
    }
  };

  const ctaLabel = !connected
    ? "Connect wallet"
    : orderMode === "limit"
      ? "Review limit order"
      : isRefreshingQuote
        ? "Updating quote…"
        : activeQuote
          ? "Review quote"
          : "Get quote";

  const limitEstimatedReceive =
    orderMode === "limit" && amountIsValid && limitPriceIsValid
      ? side === "buy"
        ? parsedAmount / parsedLimitPrice
        : parsedAmount * parsedLimitPrice
      : 0;
  const inputSymbol = side === "buy" ? "USDC" : stock.ticker;
  const outputSymbol = side === "buy" ? stock.ticker : "USDC";
  const inputName = side === "buy" ? "USD Coin" : stock.name;
  const outputName = side === "buy" ? stock.name : "USD Coin";
  const inputBalance =
    side === "buy"
      ? typeof cashBalance === "number"
        ? formatCurrency(cashBalance)
        : "Connect to load"
      : `${formatNumber(stockBalance, 6)} ${stock.ticker}`;
  const outputEstimate = activeQuote ? `${formatNumber(activeQuote.outputAmount, 6)} ${activeQuote.outputSymbol}` : formattedOutput;

  return (
    <>
      <Card className="overflow-hidden p-4">
        <div className="mb-3 flex justify-center">
          <div className="inline-flex rounded-[16px] bg-panel-subtle p-1 text-sm font-semibold">
            {([
              ["market", "Market"],
              ["limit", "Limit"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={orderMode === value}
                className={cn(
                  "h-9 min-w-20 rounded-[12px] px-4 transition-colors",
                  orderMode === value ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground",
                )}
                key={value}
                onClick={() => handleModeChange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-[16px] bg-panel-subtle p-1 text-sm font-semibold">
            {(["buy", "sell"] as TradeSide[]).map((item) => (
              <button
                aria-pressed={side === item}
                className={cn(
                  "h-9 min-w-20 rounded-[12px] px-4 capitalize transition-colors",
                  side === item ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground",
                )}
                key={item}
                onClick={() => handleSideChange(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {orderMode === "limit" ? (
          <div className="mb-3 space-y-2">
            <div className="rounded-[18px] border border-border bg-panel-subtle px-4 py-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
                <span>Limit price (USD)</span>
                {stock.priceUsd ? <span>Mkt {formatCurrency(stock.priceUsd)}</span> : null}
              </div>
              <input
                aria-label="Limit price in USD"
                className="mt-2 w-full bg-transparent font-display text-3xl font-semibold outline-none placeholder:text-muted-2"
                inputMode="decimal"
                onChange={(event) => setLimitPrice(event.target.value)}
                placeholder="0.00"
                value={limitPrice}
              />
            </div>
            {limitZones?.length ? (
              <div className="flex flex-wrap gap-2">
                {limitZones
                  .filter((zone) => zone.side === side)
                  .map((zone) => (
                    <button
                      className="rounded-full bg-panel px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-border"
                      key={`${zone.side}-${zone.preferredUsd}`}
                      onClick={() => setLimitPrice(String(zone.preferredUsd))}
                      type="button"
                    >
                      TA {formatCurrency(zone.preferredUsd)}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative space-y-3">
          <div className="rounded-[24px] border border-border bg-panel-subtle p-5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
              <span>{side === "buy" ? "Pay" : "Sell"}</span>
              <span>{inputBalance}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <TokenBadge logoUrl={side === "buy" ? "/usdc.svg" : logoUrl} name={inputName} symbol={inputSymbol} tone={side === "buy" ? "cash" : "stock"} />
              <input
                aria-label={`${side === "buy" ? "USDC" : stock.ticker} amount`}
                className="min-w-0 flex-1 bg-transparent text-right font-display text-4xl font-semibold outline-none placeholder:text-muted-2"
                inputMode="decimal"
                onChange={(event) => handleAmountChange(event.target.value)}
                placeholder="0"
                value={amount}
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <button
                className="rounded-full bg-panel px-3 py-1 font-semibold text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                disabled={side !== "sell" || stockBalance <= 0}
                onClick={() => handleAmountChange(String(stockBalance))}
                type="button"
              >
                MAX
              </button>
              <span>{side === "buy" ? formatCurrency(parsedAmount || 0) : `~ ${formatCurrency((parsedAmount || 0) * (stock.priceUsd ?? 0))}`}</span>
            </div>
          </div>

          <div className="absolute left-1/2 top-[calc(50%-19px)] z-10 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full border-4 border-background bg-panel shadow-sm">
            <HugeiconsIcon color="currentColor" icon={ArrowDown01Icon} size={20} strokeWidth={2} />
          </div>

          <div className="rounded-[24px] border border-border bg-panel-subtle p-5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
              <span>{side === "buy" ? "Buy" : "Receive"}</span>
              <span>{outputEstimate}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <TokenBadge logoUrl={side === "buy" ? logoUrl : "/usdc.svg"} name={outputName} symbol={outputSymbol} tone={side === "buy" ? "stock" : "cash"} />
              <p className="min-w-0 flex-1 truncate text-right font-display text-4xl font-semibold">
                {orderMode === "limit"
                  ? amountIsValid && limitPriceIsValid
                    ? formatNumber(limitEstimatedReceive, side === "buy" ? 4 : 2)
                    : "0"
                  : activeQuote
                    ? formatNumber(activeQuote.outputAmount, 4)
                    : amountIsValid
                      ? formatNumber(estimatedReceive, side === "buy" ? 4 : 2)
                      : "0"}
              </p>
            </div>
            <p className="mt-4 text-right text-xs text-muted">
              {side === "buy" ? `~ ${formatCurrency(parsedAmount || 0)}` : `~ ${formatNumber(parsedAmount || 0, 6)} ${stock.ticker}`}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {orderMode === "market" ? (
            <>
              <RouteRow label="Route" value={routeValue} />
              <RouteRow label="Minimum received" value={minimumReceivedValue} />
              <RouteRow label="Rate" value={activeQuote ? `1 ${activeQuote.outputSymbol} ~ ${formatCurrency(activeQuote.estimatedPriceUsd)}` : stock.priceUsd ? formatCurrency(stock.priceUsd) : "Unavailable"} />
              <RouteRow label="Network fee" value={activeQuote?.networkFeeUsd ? formatCurrency(activeQuote.networkFeeUsd, 4) : "Estimated by wallet"} />
            </>
          ) : (
            <>
              <RouteRow label="Order type" value="Jupiter Trigger limit" />
              <RouteRow
                label="Limit price"
                value={limitPriceIsValid ? formatCurrency(parsedLimitPrice) : "Enter a price"}
              />
              <RouteRow
                label="If filled"
                value={
                  amountIsValid && limitPriceIsValid
                    ? side === "buy"
                      ? `${formatNumber(limitEstimatedReceive, 6)} ${stock.ticker}`
                      : formatCurrency(limitEstimatedReceive)
                    : "—"
                }
              />
            </>
          )}
        </div>

        {blockingError || displayedError || limitError ? (
          <div className="mt-4 flex gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={14} strokeWidth={1.8} />
            <span>
              {liveRouteUnavailable && orderMode === "market"
                ? `No live Jupiter route is available for ${stock.ticker} at this amount. Try a smaller amount or another stock with deeper liquidity.`
                : (limitError ?? executionError ?? blockingError)}
            </span>
          </div>
        ) : null}

        {openOrders.length ? (
          <div className="mt-4 space-y-2 rounded-[18px] border border-border p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Open limit orders
            </p>
            {openOrders.map((order) => (
              <div className="flex items-center justify-between gap-3 text-xs" key={order.orderKey}>
                <div>
                  <p className="font-semibold capitalize">
                    {order.side} @ {formatCurrency(order.limitPriceUsd)}
                  </p>
                  <p className="text-muted">{formatCurrency(order.amountUsd ?? 0)}</p>
                </div>
                <Button
                  disabled={limitFlowStatus === "preparing" || limitFlowStatus === "signing"}
                  onClick={() => void cancelLimitOrder(order.orderKey)}
                  size="sm"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <Button
          className="mt-5 h-12 w-full rounded-[16px]"
          disabled={
            connected
              ? Boolean(blockingError) ||
                isLoading ||
                isRefreshingQuote ||
                limitBusy ||
                (orderMode === "limit" && !limitPriceIsValid)
              : false
          }
          onClick={() => {
            if (orderMode === "limit") {
              void handleProposeLimit();
              return;
            }
            if (activeQuote && !isRefreshingQuote) {
              setReviewOpen(true);
              return;
            }
            void handleQuote();
          }}
          variant="primary"
        >
          {isLoading || isRefreshingQuote || limitBusy ? (
            <>
              <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
              {limitBusy ? "Building limit order" : isRefreshingQuote ? "Updating quote…" : "Loading quote"}
            </>
          ) : !connected ? (
            <>
              <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
              {ctaLabel}
            </>
          ) : (
            <>
              <HugeiconsIcon color="currentColor" icon={CoinsSwapIcon} size={16} strokeWidth={1.8} />
              {ctaLabel}
            </>
          )}
        </Button>
      </Card>

      <QuoteReviewModal
        confirmation={confirmation}
        error={executionError}
        isRefreshingQuote={isRefreshingQuote}
        onClose={() => setReviewOpen(false)}
        onRefreshQuote={() => void refreshQuote()}
        onSign={handlePrepareSignConfirm}
        open={reviewOpen}
        quote={activeQuote}
        refreshFailed={refreshFailed}
        secondsLeft={secondsLeft}
        status={flowStatus}
      />

      <LimitOrderReviewModal
        confirmation={limitConfirmation}
        error={limitError}
        onClose={() => setLimitReviewOpen(false)}
        onSign={async () => {
          if (!limitProposal) return;
          await executeLimitOrder(limitProposal);
        }}
        open={limitReviewOpen}
        proposal={limitProposal}
        status={limitFlowStatus === "idle" ? "quoted" : limitFlowStatus}
      />
    </>
  );
}
