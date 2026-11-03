"use client";

import { Toast } from "@/components/ui";
import type { MarketSession } from "@/types";

export function MarketSessionNotice({
  session,
  variant = "toast",
  className,
}: {
  session?: MarketSession | null;
  variant?: "toast" | "note";
  className?: string;
}) {
  if (!session || session.regular || !session.summary) return null;
  if (variant === "note") {
    return (
      <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
        <span className="font-semibold text-foreground">US market hours. </span>
        {session.summary}
      </p>
    );
  }
  return (
    <div className={className}>
      <Toast title="US market hours" description={session.summary} tone="info" />
    </div>
  );
}
