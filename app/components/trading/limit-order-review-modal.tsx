"use client";

import { financialExecutionEnabled } from "@/services/environment";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Modal, Toast, formatCurrency, formatNumber } from "@/components/ui";
import type { LimitOrderProposal } from "@/types";
import type { TradeFlowStatus } from "@/hooks/use-quote-execution";
import { useApprovalReview } from "@/hooks/use-approval-review";

interface LimitOrderReviewModalProps {
  open: boolean;
  proposal?: LimitOrderProposal;
  status: TradeFlowStatus;
  confirmation?: { signature: string; orderKey?: string };
  error?: string;
  onClose: () => void;
  onSign: (approvalId: string) => Promise<void>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono font-medium">{value}</span>
    </div>
  );
}

export function LimitOrderReviewModal({
  open,
  proposal: requestedProposal,
  status,
  confirmation,
  error,
  onClose,
  onSign,
}: LimitOrderReviewModalProps) {
  const review = useApprovalReview('limit', requestedProposal?.id, open);
  const proposal = review.approval?.details.proposal ?? requestedProposal;
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const confirmed = status === "confirmed";
  const signDisabled = !proposal || !review.approval || review.approval.status !== 'prepared' || review.expired || isBusy || confirmed || status === 'submitted';
  const expiresLabel = proposal
    ? new Date(proposal.expiredAt * 1000).toLocaleDateString()
    : "—";

  return (
    <Modal open={open} onClose={onClose} side="right" title={proposal ? `Review ${proposal.side} limit · ${proposal.ticker}` : "Review limit order"}>
      {!proposal ? (
        <Toast title="No limit order loaded" description="Propose a limit order first." tone="error" />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3 rounded-[24px] border border-border p-4">
            <Row label="Limit price" value={formatCurrency(proposal.limitPriceUsd)} />
            <Row label="You lock" value={`${formatNumber(proposal.makingAmount, 6)} ${proposal.inputSymbol}`} />
            <Row label="You receive if filled" value={`${formatNumber(proposal.takingAmount, 6)} ${proposal.outputSymbol}`} />
            <Row label="Notional" value={formatCurrency(proposal.amountUsd)} />
            {proposal.marketPriceUsd !== undefined ? (
              <Row label="Market price" value={formatCurrency(proposal.marketPriceUsd)} />
            ) : null}
            <Row label="Expires" value={expiresLabel} />
            {proposal.basis ? (
              <Row label="TA basis" value={proposal.basis.replaceAll("_", " ")} />
            ) : null}
          </div>

          {proposal.wouldFillImmediately ? (
            <Toast
              title="May fill immediately"
              description="This limit is already through the market price. Jupiter may execute as soon as the order is opened."
              tone="info"
            />
          ) : null}

          {error ? <Toast title="Limit order error" description={error} tone="error" /> : null}

          {confirmation ? (
            <div className="rounded-[18px] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-start gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">Limit order opened</p>
                  {confirmation.orderKey ? (
                    <p className="mt-1 break-all text-xs opacity-75">Order {confirmation.orderKey}</p>
                  ) : null}
                  <p className="mt-1 break-all text-xs opacity-75">{confirmation.signature}</p>
                </div>
              </div>
            </div>
          ) : null}

          {review.error ? <Toast title="Unable to prepare order" description={review.error} tone="error" /> : null}
          {review.expired ? <Toast title="Review expired" description="Close this review and request a fresh limit order proposal." tone="info" /> : null}
          <p className="text-xs text-muted">Estimated network fee: {review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : 'Preparing…'}</p>
          <Button className="h-12 w-full rounded-[16px]" disabled={!financialExecutionEnabled || signDisabled} onClick={() => review.approval && void onSign(review.approval.id)} variant="primary">
            {isBusy ? (
              <>
                <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                {status === "preparing" ? "Preparing" : status === "signing" ? "Approving order…" : "Confirming"}
              </>
            ) : confirmed ? (
              <>
                <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                Order opened
              </>
            ) : (
              <>
                <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                {review.loading ? 'Preparing order…' : status === 'submitted' ? 'Submitted · confirming' : 'Confirm limit order'}
              </>
            )}
          </Button>

          <p className="text-center text-[11px] leading-4 text-muted">
            <HugeiconsIcon className="mr-1 inline" color="currentColor" icon={AlertCircleIcon} size={12} strokeWidth={1.8} />
            Funds move into a Jupiter Trigger order account until the price is hit or you cancel.
          </p>
        </div>
      )}
    </Modal>
  );
}
