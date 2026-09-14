"use client";

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  CoinsSwapIcon,
  Loading03Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePortfolioRefresh } from "@/hooks/use-portfolio-refresh";
import { Button, Card, cn, formatCurrency, formatNumber } from "@/components/ui";
import { useExecutionStore, usePortfolioStore } from "@/store";
import type { StockDetail, TradeSide } from "@/types";
import { QuoteReviewModal } from "./quote-review-modal";

type TradeFlowStatus = "idle" | "quoted" | "preparing" | "signing" | "confirming" | "confirmed" | "failed";

interface StockTradeTicketProps {
  stock: StockDetail;
  onConfirmed?: () => Promise<void> | void;
}

function normalizeLogoUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function decodeBase64Transaction(transaction: string) {
  const binary = atob(transaction);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return VersionedTransaction.deserialize(bytes);
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

export function StockTradeTicket({ stock, onConfirmed }: StockTradeTicketProps) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58();
  const refreshPortfolio = usePortfolioRefresh();
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const quote = useExecutionStore((state) => state.quote);
  const prepared = useExecutionStore((state) => state.prepared);
  const confirmation = useExecutionStore((state) => state.status);
  const storeError = useExecutionStore((state) => state.error);
  const isLoading = useExecutionStore((state) => state.isLoading);
  const quoteTrade = useExecutionStore((state) => state.quoteTrade);
  const prepareTrade = useExecutionStore((state) => state.prepareTrade);
  const confirmTrade = useExecutionStore((state) => state.confirmTrade);
  const resetTrade = useExecutionStore((state) => state.resetTrade);
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("100");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [flowStatus, setFlowStatus] = useState<TradeFlowStatus>("idle");
  const [localError, setLocalError] = useState<string>();
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
  const displayedError = localError ?? storeError;
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
    resetTrade();
    return resetTrade;
  }, [resetTrade]);

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
    [blockingError, connected, parsedAmount, quoteTrade, setVisible, side, stock.assetId, stock.ticker, wallet],
  );

  useEffect(() => {
    if (!connected || !wallet || blockingError || activeQuote || isLoading) {
      return;
    }

    const quoteKey = `${wallet}:${stock.assetId}:${side}:${parsedAmount}`;
    if (autoQuoteKeyRef.current === quoteKey) {
      return;
    }

    const timeout = window.setTimeout(() => {
      autoQuoteKeyRef.current = quoteKey;
      void requestQuote({ openReview: false });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [activeQuote, blockingError, connected, isLoading, parsedAmount, requestQuote, side, stock.assetId, wallet]);

  const handleSideChange = (nextSide: TradeSide) => {
    setSide(nextSide);
    autoQuoteKeyRef.current = undefined;
    resetTrade();
    setFlowStatus("idle");
    setLocalError(undefined);
    setReviewOpen(false);
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
    const activeQuote = useExecutionStore.getState().quote;
    setLocalError(undefined);

    if (!wallet || !connected) {
      setVisible(true);
      return;
    }

    if (!activeQuote) {
      setLocalError("Request a fresh quote before signing.");
      setFlowStatus("failed");
      return;
    }

    if (new Date(activeQuote.expiresAt).getTime() <= Date.now()) {
      setLocalError("This quote expired. Request a fresh quote before signing.");
      setFlowStatus("failed");
      return;
    }

    try {
      setFlowStatus("preparing");
      await prepareTrade({ quoteId: activeQuote.id, wallet });
      const nextPrepared = useExecutionStore.getState().prepared;
      if (!nextPrepared) {
        throw new Error(useExecutionStore.getState().error ?? "Unable to prepare transaction");
      }

      setFlowStatus("signing");
      const transaction = decodeBase64Transaction(nextPrepared.transaction);
      const signature = await sendTransaction(transaction, connection);

      setFlowStatus("confirming");
      await confirmTrade(wallet, nextPrepared.quoteId, signature);
      const nextStatus = useExecutionStore.getState().status;
      if (!nextStatus) {
        throw new Error(useExecutionStore.getState().error ?? "Unable to confirm transaction");
      }

      setFlowStatus("confirmed");
      await Promise.all([refreshPortfolio(), onConfirmed?.()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction failed";
      setFlowStatus("failed");
      setLocalError(message);
    }
  };

  const ctaLabel = !connected ? "Connect wallet" : activeQuote ? "Review quote" : "Get quote";
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
              <p className="min-w-0 flex-1 truncate text-right font-display text-4xl font-semibold">{activeQuote ? formatNumber(activeQuote.outputAmount, 4) : amountIsValid ? formatNumber(estimatedReceive, side === "buy" ? 4 : 2) : "0"}</p>
            </div>
            <p className="mt-4 text-right text-xs text-muted">
              {side === "buy" ? `~ ${formatCurrency(parsedAmount || 0)}` : `~ ${formatNumber(parsedAmount || 0, 6)} ${stock.ticker}`}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <RouteRow label="Route" value={routeValue} />
          <RouteRow label="Minimum received" value={minimumReceivedValue} />
          <RouteRow label="Rate" value={activeQuote ? `1 ${activeQuote.outputSymbol} ~ ${formatCurrency(activeQuote.estimatedPriceUsd)}` : stock.priceUsd ? formatCurrency(stock.priceUsd) : "Unavailable"} />
          <RouteRow label="Network fee" value={activeQuote?.networkFeeUsd ? formatCurrency(activeQuote.networkFeeUsd, 4) : "Estimated by wallet"} />
        </div>

        {blockingError || displayedError ? (
          <div className="mt-4 flex gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={14} strokeWidth={1.8} />
            <span>
              {liveRouteUnavailable
                ? `No live Jupiter route is available for ${stock.ticker} at this amount. Try a smaller amount or another stock with deeper liquidity.`
                : (localError ?? blockingError ?? storeError)}
            </span>
          </div>
        ) : null}

        <Button
          className="mt-5 h-12 w-full rounded-[16px]"
          disabled={connected ? Boolean(blockingError) || isLoading : false}
          onClick={activeQuote ? () => setReviewOpen(true) : () => void handleQuote()}
          variant="primary"
        >
          {isLoading ? (
            <>
              <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
              Loading quote
            </>
          ) : !connected ? (
            <>
              <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
              {ctaLabel}
            </>
          ) : activeQuote ? (
            <>
              <HugeiconsIcon color="currentColor" icon={CoinsSwapIcon} size={16} strokeWidth={1.8} />
              {ctaLabel}
            </>
          ) : (
            ctaLabel
          )}
        </Button>
      </Card>

      <QuoteReviewModal
        confirmation={confirmation}
        error={localError ?? storeError}
        onClose={() => setReviewOpen(false)}
        onSign={handlePrepareSignConfirm}
        open={reviewOpen}
        quote={activeQuote}
        status={flowStatus}
      />
    </>
  );
}
