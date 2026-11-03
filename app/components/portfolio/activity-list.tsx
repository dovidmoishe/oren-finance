import { EmptyState, formatCurrency, formatRelativeTime } from "@/components/ui";
import type { PortfolioActivityItem } from "@/types";

const labels: Record<PortfolioActivityItem["type"], string> = {
  trade: "Trade",
  basket: "Basket",
  lock: "Lock",
  unlock: "Unlock",
  transfer: "Transfer",
  unknown: "Activity",
};

export function ActivityList({ items }: { items: PortfolioActivityItem[] }) {
  if (!items.length) {
    return (
      <EmptyState
        description="Trades you place on Oren show up here. A route is shown only when it was recorded with the trade."
        title="No activity yet"
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div className="flex items-center justify-between gap-4 rounded-[18px] border border-border bg-background p-3" key={item.id}>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {labels[item.type]}
              {item.ticker ? <span className="text-muted"> · {item.ticker}</span> : null}
              {item.route ? <span className="text-muted"> · {item.route}</span> : null}
            </p>
            <p className="text-xs text-muted">{formatRelativeTime(item.occurredAt)}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm">{item.valueUsd ? formatCurrency(item.valueUsd) : item.status ?? "Seen"}</p>
            {item.signature ? <p className="text-xs text-muted">{item.signature.slice(0, 8)}...</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
