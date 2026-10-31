"use client";

import { financialExecutionEnabled } from "@/services/environment";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Loading03Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button, Modal, Toast, formatCurrency, formatNumber } from "@/components/ui";
import type { ExecutionStatus, QuoteResponse } from "@/types";
import { useApprovalReview } from "@/hooks/use-approval-review";
import { PriceMovedReview } from "./price-moved-review";

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
  /** Sign the approval; `quote` is the one it was prepared for. */
  onSign: (approvalId: string, quote: QuoteResponse) => Promise<void>;
  /**
   * The user accepted the alternative offered with PRICE_MOVED. Callers that
   * own the quote (e.g. the store) swap it in; otherwise the modal reviews
   * the alternative itself. Either way a new approval is prepared for it.
   */
  onAcceptAlternative?: (quote: QuoteResponse) => void;
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

export function QuoteReviewModal({
  open,
  quote: requestedQuote,
  status,
  confirmation,
  error,
  secondsLeft: quoteSecondsLeft,
  isRefreshingQuote = false,
  refreshFailed = false,
  onRefreshQuote,
  onClose,
  onSign,
  onAcceptAlternative,
}: QuoteReviewModalProps) {
  const [accepted, setAccepted] = useState<{ forId: string; quote: QuoteResponse }>();
  // An accepted alternative replaces the requested quote until that changes.
  const reviewQuote =
    accepted && accepted.forId === requestedQuote?.id ? accepted.quote : requestedQuote;
  const review = useApprovalReview('swap', reviewQuote?.id, open);
  const quote = review.approval?.details.quote ?? reviewQuote;
  const acceptAlternative = (alternative: QuoteResponse) => {
    if (onAcceptAlternative) onAcceptAlternative(alternative);
    else if (requestedQuote) setAccepted({ forId: requestedQuote.id, quote: alternative });
  };
  const secondsLeft = quoteSecondsLeft ?? review.secondsLeft;
  const expired = Boolean(quote && secondsLeft <= 0);
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const signed = status === "confirming" || status === "submitted" || status === "confirmed";
  const confirmed = status === "confirmed";
  const submitted = status === "submitted";
  const waitingOnRefresh = expired || isRefreshingQuote;
  const signDisabled = !quote || !review.approval || review.approval.status !== 'prepared' || review.expired || waitingOnRefresh || isBusy || submitted || confirmed || refreshFailed;
  const minimumReceived = quote
    ? quote.outputAmount * (1 - quote.slippageBps / 10_000)
    : 0;
  const warnings = [
    quote && quote.priceImpactPercent >= 1 ? `Price impact is ${formatNumber(quote.priceImpactPercent, 2)}%. Review before signing.` : null,
    refreshFailed ? "Could not refresh this quote. Retry to keep signing." : null,
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <Modal open={open} onClose={onClose} side="right" title={quote ? `Review ${quote.side} · ${quote.ticker}` : "Review trade"}>
      {!quote ? (
        <Toast title="No quote loaded" description="Request a fresh quote from the trade ticket." tone="error" />
      ) : review.priceMoved ? (
        <PriceMovedReview
          details={review.priceMoved}
          disabled={!financialExecutionEnabled || isBusy}
          onAccept={acceptAlternative}
          onCancel={onClose}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3 rounded-[24px] border border-border p-4">
            <Row label="You pay" value={`${formatNumber(quote.inputAmount, 6)} ${quote.inputSymbol}`} />
            <Row label="You receive" value={`${formatNumber(quote.outputAmount, 6)} ${quote.outputSymbol}`} />
            <Row label="Minimum received" value={`${formatNumber(minimumReceived, 6)} ${quote.outputSymbol}`} />
            <Row label="Estimated price" value={formatCurrency(quote.estimatedPriceUsd)} />
            <Row label="Price impact" value={`${formatNumber(quote.priceImpactPercent, 2)}%`} />
            <Row label="Slippage" value={`${formatNumber(quote.slippageBps / 100, 2)}%`} />
            <Row label="Estimated network fee" value={review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : "Preparing…"} />
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
          {review.error ? <Toast title="Unable to prepare trade" description={review.error} tone="error" /> : null}
          {review.error ? <Button onClick={() => void review.prepare()} disabled={!financialExecutionEnabled || isBusy} variant="secondary">Retry preparation</Button> : null}
          {review.expired && !signed ? <Toast title="Approval expired" description="Request a fresh quote before confirming." tone="info" /> : null}

          {confirmation ? (
            <div className="rounded-[18px] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-start gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">Tracking transaction</p>
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
            <Button className="h-12 w-full rounded-[16px]" disabled={!financialExecutionEnabled || signDisabled} onClick={() => review.approval && reviewQuote && void onSign(review.approval.id, reviewQuote)} variant="primary">
              {isBusy ? (
                <>
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                  {status === "preparing" ? "Preparing" : status === "signing" ? "Approving trade…" : "Confirming"}
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
                  {review.loading ? "Preparing trade…" : quote.side === "buy" ? "Confirm buy" : "Confirm sell"}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
