"use client";

import type { TradeSide } from "@/types";

export function OrderControls({ side, onSideChange }: {
  side: TradeSide;
  onSideChange: (side: TradeSide) => void;
}) {
  return <div className="mb-4 flex items-center justify-between gap-4">
    <div aria-label="Trade direction" className="inline-flex min-w-0 flex-1 rounded-2xl bg-panel-subtle p-1 text-sm font-semibold" role="group">
      {(["buy", "sell"] as const).map((value) => <button
        aria-pressed={side === value}
        className={`h-9 min-w-0 flex-1 rounded-xl px-3 capitalize transition-colors ${side === value ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
        key={value} onClick={() => onSideChange(value)} type="button"
      >{value}</button>)}
    </div>
  </div>;
}

export function LimitOrderToggle({ limit, limitFieldsId, onLimitChange }: {
  limit: boolean;
  limitFieldsId: string;
  onLimitChange: (limit: boolean) => void;
}) {
  return <label className="mt-5 mb-3 flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
      <span>Limit order</span>
      <input aria-controls={limitFieldsId} checked={limit} className="oren-limit-input sr-only" onChange={(event) => onLimitChange(event.target.checked)} role="switch" type="checkbox" />
      <span aria-hidden className="oren-limit-switch"><span className="oren-limit-thumb" /></span>
    </label>;
}
