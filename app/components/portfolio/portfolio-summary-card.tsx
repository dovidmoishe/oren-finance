"use client";

import { Add01Icon, ArrowDown01Icon, ChartLineData01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, formatCurrency } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import type { PortfolioSummary } from "@/types";

const allocationColors = ["bg-[#7160dd]", "bg-[#30303a]", "bg-[#d994ce]", "bg-[#e8bd45]", "bg-[#718ac6]"];
const masked = "••••••";

function Allocation({ portfolio, hidden }: { portfolio: PortfolioSummary; hidden: boolean }) {
  const { locale, t } = useI18n();
  const positions = portfolio.positions.filter(({ valueUsd }) => valueUsd > 0);
  const visibleCount = positions.length > allocationColors.length ? allocationColors.length - 1 : allocationColors.length;
  const visible = positions.slice(0, visibleCount);
  const other = positions.slice(visibleCount).reduce((sum, position) => sum + position.valueUsd, 0);
  const allocations = visible.map((position, index) => ({
    key: position.assetId,
    label: position.ticker,
    value: position.valueUsd,
    color: allocationColors[index],
  }));
  if (other > 0) allocations.push({ key: "other", label: t("portfolio.otherAssets"), value: other, color: "bg-[#9bacc9]" });
  if (portfolio.cashValueUsd > 0) allocations.push({ key: "cash", label: "USDC", value: portfolio.cashValueUsd, color: "bg-[#399d8a]" });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });

  return (
    <div className="mt-6 sm:mt-7">
      <h3 className="text-xs font-medium text-muted sm:text-sm">{t("portfolio.allocation")}</h3>
      <div aria-hidden="true" className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-panel-subtle">
        {allocations.map(({ key, value, color }) => (
          <span className={cn("min-w-0 basis-0 rounded-full", color)} key={key} style={{ flexGrow: value }} />
        ))}
      </div>
      {allocations.length > 0 && (
        <ul className="mt-3.5 grid gap-x-3 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,7.3rem),1fr))]">
          {allocations.map(({ key, label, value, color }) => (
            <li className="relative min-w-0 ps-2.5" key={key}>
              <span aria-hidden="true" className={cn("absolute inset-y-0 start-0 w-0.5 rounded-full opacity-80", color)} />
              <div className="flex items-baseline justify-between gap-1 text-xs text-muted">
                <span className="min-w-0 truncate font-semibold" title={label}>{label}</span>
                <span className="shrink-0 tabular-nums">{percent.format(value / portfolio.totalValueUsd)}</span>
              </div>
              <p className="mt-0.5 break-words text-xs font-semibold tabular-nums">{hidden ? masked : formatCurrency(value, locale)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortfolioSummaryCard({
  portfolio, hidden, onToggleHidden, historyOpen, onToggleHistory, onDeposit,
}: {
  portfolio: PortfolioSummary;
  hidden: boolean;
  onToggleHidden: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onDeposit: () => void;
}) {
  const { locale, t } = useI18n();
  const balance = (value?: number) => hidden ? masked : formatCurrency(value, locale);
  const change = portfolio.changeUsd;
  const changeValue = change === undefined ? "—" : change > 0 ? "+" + balance(change) : balance(change);
  const metrics = [
    { label: t("portfolio.snapshotChange"), value: hidden ? masked : changeValue, color: !hidden && change !== undefined && change !== 0 ? change > 0 ? "text-[#16734a]" : "text-[#be3545]" : undefined },
    { label: t("portfolio.colAvailable"), value: balance(portfolio.availableValueUsd) },
    { label: t("portfolio.colLocked"), value: balance(portfolio.lockedValueUsd) },
    { label: t("portfolio.cashLabel"), value: balance(portfolio.cashValueUsd) },
  ];

  return (
    <section aria-label={t("portfolio.totalValue")} className="rounded-2xl border border-border bg-panel p-3.5 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold sm:text-base">{t("portfolio.totalValue")}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 sm:mt-3 sm:gap-x-2">
            <p className="max-w-full break-words font-display text-[clamp(1.35rem,5vw,2rem)] leading-tight font-bold tracking-[-0.045em] tabular-nums">{balance(portfolio.totalValueUsd)}</p>
            <button
              aria-label={t("portfolio.hideBalances")}
              aria-pressed={hidden}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:size-11"
              onClick={onToggleHidden}
              title={t(hidden ? "portfolio.showBalances" : "portfolio.hideBalances")}
              type="button"
            >
              <HugeiconsIcon aria-hidden="true" icon={hidden ? ViewOffIcon : ViewIcon} size={17} strokeWidth={1.7} />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted sm:text-sm">{t("portfolio.assetCount", { count: portfolio.positions.length })}</p>
        </div>
        <Button className="rounded-full shadow-none" onClick={onDeposit} size="md" variant="primary">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} size={16} strokeWidth={1.8} />
          {t("account.deposit")}
        </Button>
      </div>

      <Allocation hidden={hidden} portfolio={portfolio} />

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-4 sm:mt-6">
        <dl className="grid min-w-0 flex-1 basis-[23rem] grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          {metrics.map(({ label, value, color }) => (
            <div className="flex min-w-0 flex-col-reverse gap-0.5" key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={cn("break-words text-sm font-semibold tabular-nums sm:text-base", color)}>{value}</dd>
            </div>
          ))}
        </dl>
        <button
          aria-expanded={historyOpen}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11"
          disabled={hidden}
          onClick={onToggleHistory}
          type="button"
        >
          <HugeiconsIcon aria-hidden="true" icon={ChartLineData01Icon} size={15} strokeWidth={1.7} />
          {t("portfolio.valueHistory")}
          <HugeiconsIcon aria-hidden="true" className={historyOpen ? "rotate-180" : undefined} icon={ArrowDown01Icon} size={12} strokeWidth={1.8} />
        </button>
      </div>
    </section>
  );
}
