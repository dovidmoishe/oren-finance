"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Loading03Icon,
  Route01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Modal, Toast, cn, formatCurrency, formatNumber } from "@/components/ui";
import type { ExecutionStatus, QuoteResponse } from "@/types";

type TradeFlowStatus = "idle" | "quoted" | "preparing" | "signing" | "confirming" | "submitted" | "confirmed" | "failed";

interface QuoteReviewModalProps {
  open: boolean;
  quote?: QuoteResponse;
  status: TradeFlowStatus;
  confirmation?: ExecutionStatus;
  error?: string;
  secondsLeft?: number;
  isRefreshingQuote?: boolean;
  refreshFailed?: boolean;
  onRefreshQuote?: () => void;
  onClose: () => void;
  onSign: () => Promise<void>;
}

function formatExpiryLabel(secondsLeft: number, refreshing: boolean) {
  if (refreshing) return "Updating quote…";
  if (secondsLeft <= 0) return "Refreshing…";
  if (secondsLeft < 60) return `${secondsLeft}s left`;
  return `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s left`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono font-medium">{value}</span>
    </div>
  );
}

function Step({ active, done, label }: { active?: boolean; done?: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-[14px] border px-3 py-2 text-xs", active || done ? "border-foreground bg-foreground text-white" : "border-border bg-panel-subtle text-muted")}>
      <HugeiconsIcon color="currentColor" icon={done ? CheckmarkCircle01Icon : active ? Clock01Icon : Route01Icon} size={14} strokeWidth={1.8} />
      {label}
    </div>
  );
}

export function QuoteReviewModal({
  open,
  quote,
  status,
  confirmation,
  error,
  secondsLeft = 0,
  isRefreshingQuote = false,
  refreshFailed = false,
  onRefreshQuote,
  onClose,
  onSign,
}: QuoteReviewModalProps) {
  const expired = Boolean(quote && secondsLeft <= 0);
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const signed = status === "confirming" || status === "submitted" || status === "confirmed";
  const confirmed = status === "confirmed";
  const submitted = status === "submitted";
  const waitingOnRefresh = expired || isRefreshingQuote;
  const signDisabled = !quote || waitingOnRefresh || isBusy || submitted || confirmed || refreshFailed;
  const minimumReceived = quote
    ? quote.outputAmount * (1 - quote.slippageBps / 10_000)
    : 0;
  const warnings = [
    quote && quote.priceImpactPercent >= 1 ? `Price impact is ${formatNumber(quote.priceImpactPercent, 2)}%. Review before signing.` : null,
    refreshFailed ? "Could not refresh this quote. Retry to keep signing." : null,
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <Modal open={open} onClose={onClose} side="right" title="Review trade">
      {!quote ? (
        <Toast title="No quote loaded" description="Request a fresh quote from the trade ticket." tone="error" />
      ) : (
        <div className="space-y-5">
          <div className="rounded-[24px] border border-border bg-panel-subtle p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted">
                  {quote.side === "buy" ? "Buying" : "Selling"}
                </p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{quote.ticker}</h3>
              </div>
              <div className="rounded-full bg-accent-yellow px-3 py-1 text-xs font-semibold">
                {quote.provider}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Step done label="Quote" />
              <Step active={status === "preparing" || status === "signing"} done={signed || confirmed} label="Sign" />
              <Step active={status === "confirming" || status === "submitted"} done={confirmed} label="Verify" />
            </div>
          </div>

          <div className="space-y-3 rounded-[24px] border border-border p-4">
            <Row label="You pay" value={`${formatNumber(quote.inputAmount, 6)} ${quote.inputSymbol}`} />
            <Row label="You receive" value={`${formatNumber(quote.outputAmount, 6)} ${quote.outputSymbol}`} />
            <Row label="Minimum received" value={`${formatNumber(minimumReceived, 6)} ${quote.outputSymbol}`} />
            <Row label="Estimated price" value={formatCurrency(quote.estimatedPriceUsd)} />
            <Row label="Price impact" value={`${formatNumber(quote.priceImpactPercent, 2)}%`} />
            <Row label="Slippage" value={`${formatNumber(quote.slippageBps / 100, 2)}%`} />
            <Row label="Network fee" value={quote.networkFeeUsd ? formatCurrency(quote.networkFeeUsd, 4) : "Estimated by wallet"} />
            <Row label="Quote expiry" value={formatExpiryLabel(secondsLeft, isRefreshingQuote)} />
          </div>

          {warnings.length ? (
            <div className="space-y-2">
              {warnings.map((warning) => (
                <Toast key={warning} title="Review warning" description={warning} tone="info" />
              ))}
            </div>
          ) : null}

          {error ? <Toast title="Trade error" description={error} tone="error" /> : null}

          {confirmation ? (
            <div className="rounded-[18px] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-start gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">Transaction submitted</p>
                  <p className="mt-1 text-xs opacity-75">Oren is verifying the fill without holding up your trade.</p>
                  <p className="mt-1 break-all text-xs opacity-75">{confirmation.signature}</p>
                </div>
              </div>
            </div>
          ) : null}

          {refreshFailed && onRefreshQuote ? (
            <Button className="h-12 w-full rounded-[16px]" onClick={onRefreshQuote} variant="secondary">
              <HugeiconsIcon color="currentColor" icon={AlertCircleIcon} size={16} strokeWidth={1.8} />
              Retry quote refresh
            </Button>
          ) : (
            <Button className="h-12 w-full rounded-[16px]" disabled={signDisabled} onClick={() => void onSign()} variant="primary">
              {isBusy ? (
                <>
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                  {status === "preparing" ? "Preparing" : status === "signing" ? "Awaiting wallet" : "Confirming"}
                </>
              ) : status === "submitted" ? (
                <>
                  <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                  Submitted · syncing
                </>
              ) : confirmed ? (
                <>
                  <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                  Confirmed
                </>
              ) : waitingOnRefresh ? (
                <>
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
                  Updating quote…
                </>
              ) : (
                <>
                  <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                  Prepare and sign
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
