import type { ReactNode } from "react";
import { cn, formatNumber } from "@/components/ui";
import type { TechnicalBrief } from "@/types";

const REGIME_LABEL: Record<TechnicalBrief["regime"], string> = {
  uptrend: "Uptrend",
  downtrend: "Downtrend",
  range: "Range-bound",
};

const SETUP_LABEL: Record<TechnicalBrief["setup"], string> = {
  continuation: "Trend continuation",
  mean_reversion: "Mean reversion",
  breakout: "Breakout",
  insufficient: "Insufficient history",
};

interface TechnicalBriefPanelProps {
  brief: TechnicalBrief;
  compact?: boolean;
  className?: string;
}

export function TechnicalBriefPanel({
  brief,
  compact = false,
  className,
}: TechnicalBriefPanelProps) {
  const daily = brief.primaryTimeframe;
  const support = brief.levels.find((level) => level.label === "support");
  const resistance = brief.levels.find((level) => level.label === "resistance");

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-2">
        <Badge>{REGIME_LABEL[brief.regime]}</Badge>
        <Badge tone="muted">{SETUP_LABEL[brief.setup]}</Badge>
        {brief.limitedHistory ? (
          <Badge tone="warn">
            {brief.hourlyTimeframe ? "Thin daily history" : "Limited history"}
          </Badge>
        ) : null}
      </div>

      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        <Metric label="RSI (daily)" value={formatNumber(daily.rsi14, 1)} />
        <Metric label="MACD hist." value={formatSigned(daily.macd.histogram)} />
        <Metric label="ATR (14)" value={formatNumber(daily.atr14, 2)} />
        <Metric label="Band width" value={`${formatNumber(daily.bollinger.bandwidth, 1)}%`} />
      </div>

      {(support || resistance) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {support ? (
            <LevelCard
              distancePct={support.distancePct}
              label="Support"
              price={support.price}
            />
          ) : null}
          {resistance ? (
            <LevelCard
              distancePct={resistance.distancePct}
              label="Resistance"
              price={resistance.price}
            />
          ) : null}
        </div>
      )}

      {brief.limitZones?.length ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Limit zones
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {brief.limitZones.map((zone) => (
              <button
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold",
                  zone.side === "buy"
                    ? "bg-green-50 text-green-900 ring-1 ring-green-200"
                    : "bg-red-50 text-red-900 ring-1 ring-red-200",
                )}
                key={`${zone.side}-${zone.preferredUsd}`}
                type="button"
              >
                {zone.side === "buy" ? "Buy" : "Sell"} @{" "}
                {formatNumber(zone.preferredUsd, 2)}
                <span className="ml-1 font-normal opacity-70">
                  ({zone.basis.replaceAll("_", " ")})
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {brief.risks.length ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Risks
          </p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted">
            {brief.risks.slice(0, compact ? 2 : 4).map((risk) => (
              <li className="flex gap-2" key={risk}>
                <span aria-hidden>•</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {brief.newsOverlay?.length ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            News overlay
          </p>
          <ul className="mt-2 space-y-2">
            {brief.newsOverlay.slice(0, compact ? 1 : 3).map((item) => (
              <li className="rounded-[12px] bg-panel-subtle px-3 py-2 text-xs leading-5" key={item.headline}>
                <span className="mr-2 capitalize text-muted">{item.alignment.replaceAll("_", " ")}</span>
                {item.headline}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "muted" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
        tone === "default" && "bg-foreground text-white",
        tone === "muted" && "bg-panel-subtle text-foreground",
        tone === "warn" && "bg-accent-yellow text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-panel-subtle px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function LevelCard({
  label,
  price,
  distancePct,
}: {
  label: string;
  price: number;
  distancePct: number;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{formatNumber(price, 2)}</p>
      <p className="mt-0.5 text-xs text-muted">{formatSigned(distancePct)} from price</p>
    </div>
  );
}

function formatSigned(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}
