"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Route01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Modal, Toast, cn, formatCurrency, formatNumber } from "@/components/ui";
import type { LimitOrderProposal } from "@/types";
import type { TradeFlowStatus } from "@/hooks/use-quote-execution";

interface LimitOrderReviewModalProps {
  open: boolean;
  proposal?: LimitOrderProposal;
  status: TradeFlowStatus;
  confirmation?: { signature: string; orderKey?: string };
  error?: string;
  onClose: () => void;
  onSign: () => Promise<void>;
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

export function LimitOrderReviewModal({
  open,
  proposal,
  status,
  confirmation,
  error,
  onClose,
  onSign,
}: LimitOrderReviewModalProps) {
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const signed = status === "confirming" || status === "confirmed";
  const confirmed = status === "confirmed";
  const signDisabled = !proposal || isBusy || confirmed;
  const expiresLabel = proposal
    ? new Date(proposal.expiredAt * 1000).toLocaleDateString()
    : "—";

  return (
    <Modal open={open} onClose={onClose} side="right" title="Review limit order">
      {!proposal ? (
        <Toast title="No limit order loaded" description="Propose a limit order first." tone="error" />
      ) : (
        <div className="space-y-5">
          <div className="rounded-[24px] border border-border bg-panel-subtle p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted">
                  {proposal.side === "buy" ? "Buy limit" : "Sell limit"}
                </p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{proposal.ticker}</h3>
              </div>
              <div className="rounded-full bg-accent-lavender px-3 py-1 text-xs font-semibold">
                {proposal.provider}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Step done label="Propose" />
              <Step active={status === "preparing" || status === "signing"} done={signed || confirmed} label="Sign" />
              <Step active={status === "confirming"} done={confirmed} label="Open" />
            </div>
          </div>

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

          <Button className="h-12 w-full rounded-[16px]" disabled={signDisabled} onClick={() => void onSign()} variant="primary">
            {isBusy ? (
              <>
                <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                {status === "preparing" ? "Preparing" : status === "signing" ? "Awaiting wallet" : "Confirming"}
              </>
            ) : confirmed ? (
              <>
                <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                Order opened
              </>
            ) : (
              <>
                <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                Prepare and sign
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
