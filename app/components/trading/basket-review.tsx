"use client";

import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Loading03Icon,
  PauseCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Card, CardContent, CardHeader, cn, formatCurrency, formatNumber } from "@/components/ui";
import type { BasketExecutionProgress, BasketLegStatus, BasketResponse } from "@/types";

interface BasketReviewProps {
  basket: BasketResponse;
  progress?: BasketExecutionProgress;
}

const statusCopy: Record<BasketLegStatus, string> = {
  waiting: "Waiting",
  quoting: "Quoting",
  awaiting_signature: "Awaiting signature",
  submitted: "Submitted",
  confirmed: "Complete",
  failed: "Failed",
  skipped: "Skipped",
};

const statusIcon: Record<BasketLegStatus, IconSvgElement> = {
  waiting: Clock01Icon,
  quoting: Loading03Icon,
  awaiting_signature: Clock01Icon,
  submitted: Loading03Icon,
  confirmed: CheckmarkCircle01Icon,
  failed: CancelCircleIcon,
  skipped: PauseCircleIcon,
};

const statusTone: Record<BasketLegStatus, string> = {
  waiting: "border-border bg-panel-subtle text-muted",
  quoting: "border-yellow-200 bg-yellow-50 text-yellow-900",
  awaiting_signature: "border-yellow-200 bg-yellow-50 text-yellow-900",
  submitted: "border-yellow-200 bg-yellow-50 text-yellow-900",
  confirmed: "border-green-200 bg-green-50 text-green-900",
  failed: "border-red-200 bg-red-50 text-red-900",
  skipped: "border-border bg-panel-subtle text-muted",
};

export function BasketReview({ basket, progress }: BasketReviewProps) {
  const legsByAsset = new Map(progress?.legs.map((leg) => [leg.assetId, leg]));
  const completeCount = progress?.legs.filter((leg) => leg.status === "confirmed").length ?? 0;
  const failedCount = progress?.legs.filter((leg) => leg.status === "failed").length ?? 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Basket review</p>
            <h2 className="mt-1 font-display text-xl font-semibold">Investing {formatCurrency(basket.totalAmountUsd)}</h2>
            {basket.thesis ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{basket.thesis}</p> : null}
          </div>
          <div className="rounded-full bg-accent-lavender px-3 py-1 text-xs font-semibold capitalize">
            {basket.riskLabel ?? "Risk pending"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {progress ? (
          <div className="rounded-[18px] border border-border bg-panel-subtle p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold">Sequential execution</span>
              <span className="font-mono text-xs text-muted">
                {completeCount}/{basket.allocations.length} complete{failedCount ? ` · ${failedCount} failed` : ""}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Each leg is signed separately. Partial fills and failures stay visible.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          {basket.allocations.map((allocation) => {
            const leg = legsByAsset.get(allocation.assetId);
            const status = leg?.status ?? "waiting";
            const Icon = statusIcon[status];

            return (
              <article className="rounded-[18px] border border-border p-4" key={allocation.assetId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg font-semibold">{allocation.ticker}</h3>
                      <span className="rounded-full bg-panel-subtle px-2 py-1 font-mono text-[11px] text-muted">
                        {formatNumber(allocation.weightPercent, 1)}%
                      </span>
                    </div>
                    {allocation.name ? <p className="text-xs text-muted">{allocation.name}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold">{formatCurrency(allocation.amountUsd)}</p>
                    <div className={cn("mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold", statusTone[status])}>
                      <HugeiconsIcon className={status === "quoting" || status === "submitted" ? "animate-spin" : undefined} color="currentColor" icon={Icon} size={12} strokeWidth={1.8} />
                      {statusCopy[status]}
                    </div>
                  </div>
                </div>

                {allocation.rationale ? <p className="mt-3 text-sm leading-6 text-muted">{allocation.rationale}</p> : null}
                {leg?.error ? <p className="mt-3 rounded-[12px] bg-red-50 p-3 text-xs leading-5 text-red-900">{leg.error}</p> : null}
              </article>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
