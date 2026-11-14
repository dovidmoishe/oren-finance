"use client";

import { ScanEye } from "lucide-react";
import type { AgentPageContext } from "@/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { contextLabelKey } from "./agent-utils";

export function AgentViewContext({ context, ticker, enabled, onToggle }: {
  context?: AgentPageContext;
  ticker?: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const active = Boolean(context && enabled);
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-panel-subtle/50 px-4 py-2.5">
      <ScanEye aria-hidden="true" className="shrink-0 text-muted" size={16} strokeWidth={1.6} />
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-xs text-muted" title={t(active ? "agent.viewContextHint" : "agent.generalContextBody")}>
        {t(...contextLabelKey(active ? context : undefined, ticker))}
      </p>
      {context && (
        <button
          aria-checked={active}
          aria-label={t("agent.usePageContext")}
          className="group -my-2 inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-1 text-[11px] font-medium text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={onToggle}
          role="switch"
          title={t("agent.viewContextHint")}
          type="button"
        >
          {t("agent.pageContext")}
          <span aria-hidden="true" className={cn("inline-flex h-4 w-7 items-center rounded-full p-0.5", active ? "bg-foreground" : "bg-border-strong")}>
            <span className={cn("size-3 rounded-full bg-panel", active && "translate-x-3 rtl:-translate-x-3")} />
          </span>
        </button>
      )}
    </div>
  );
}
