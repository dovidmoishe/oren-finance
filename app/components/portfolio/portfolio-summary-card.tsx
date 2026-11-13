"use client";

import { Add01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, formatCurrency } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import type { PortfolioSummary } from "@/types";

const allocationColors = ["bg-[#7160dd]", "bg-[#30303a]", "bg-[#d994ce]", "bg-[#e8bd45]", "bg-[#718ac6]"];
const masked = "••••••";

export function PortfolioAllocation({ portfolio, hidden }: { portfolio: PortfolioSummary; hidden: boolean }) {
  const { locale, t } = useI18n();
  const positions = portfolio.positions.filter(({ valueUsd }) => valueUsd > 0);
  const visibleCount = positions.length > allocationColors.length ? allocationColors.length - 1 : allocationColors.length;
  const other = positions.slice(visibleCount).reduce((sum, position) => sum + position.valueUsd, 0);
  const allocations = positions.slice(0, visibleCount).map((position, index) => ({
    key: position.assetId,
    label: position.ticker,
    value: position.valueUsd,
    color: allocationColors[index],
  }));
  if (other > 0) allocations.push({ key: "other", label: t("portfolio.otherAssets"), value: other, color: "bg-[#9bacc9]" });
  if (portfolio.cashValueUsd > 0) allocations.push({ key: "cash", label: "USDC", value: portfolio.cashValueUsd, color: "bg-[#399d8a]" });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const balance = (value: number) => hidden ? masked : formatCurrency(value, locale);
  const metrics = [
    { label: t("portfolio.colAvailable"), value: portfolio.availableValueUsd },
    { label: t("portfolio.colLocked"), value: portfolio.lockedValueUsd },
    { label: t("portfolio.cashLabel"), value: portfolio.cashValueUsd },
  ];

  return (
    <section aria-label={t("portfolio.allocation")} className="rounded-2xl border border-border px-4 py-5 @lg:px-6">
      {allocations.length > 0 && (
        <>
          <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-panel-subtle">
            {allocations.map(({ key, value, color }) => (
              <span className={cn("min-w-0 basis-0 rounded-full", color)} key={key} style={{ flexGrow: value }} />
            ))}
          </div>
          <ul className="my-4 divide-y divide-border">
            {allocations.map(({ key, label, value, color }) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 py-3 text-sm" key={key}>
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", color)} />
                  {label}
                </span>
                <span className="text-muted tabular-nums">{percent.format(value / portfolio.totalValueUsd)}</span>
                <span className="text-end font-medium tabular-nums">{balance(value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <dl className="grid grid-cols-2 gap-4 @sm:grid-cols-3">
        {metrics.map(({ label, value }) => (
          <div className="min-w-0" key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{balance(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PortfolioSummaryCard({ portfolio, hidden, onToggleHidden, onDeposit }: {
  portfolio: PortfolioSummary;
  hidden: boolean;
  onToggleHidden: () => void;
  onDeposit: () => void;
}) {
  const { locale, t } = useI18n();
  const change = portfolio.changeUsd;
  const changeValue = change === undefined ? "—" : (change > 0 ? "+" : "") + formatCurrency(change, locale);
  const changeColor = !hidden && change ? change > 0 ? "text-[#16734a]" : "text-[#be3545]" : "text-muted";

  return (
    <section aria-label={t("portfolio.totalValue")} className="rounded-2xl bg-panel-subtle/80 p-4 @lg:px-7 @lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-medium text-muted">{t("portfolio.totalValue")}</h2>
            <button
              aria-label={t("portfolio.hideBalances")}
              aria-pressed={hidden}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-panel hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:size-10"
              onClick={onToggleHidden}
              title={t(hidden ? "portfolio.showBalances" : "portfolio.hideBalances")}
              type="button"
            >
              <HugeiconsIcon aria-hidden="true" icon={hidden ? ViewOffIcon : ViewIcon} size={16} strokeWidth={1.7} />
            </button>
          </div>
          <p className="break-words font-display text-[clamp(1.65rem,6cqi,3rem)] leading-[1.12] font-semibold tracking-[-0.055em] tabular-nums">{hidden ? masked : formatCurrency(portfolio.totalValueUsd, locale)}</p>
          {change !== undefined && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-muted @lg:text-sm">
              <span className={cn("font-semibold tabular-nums", changeColor)}>{hidden ? masked : changeValue}</span>
              <span>{t("portfolio.snapshotChange")}</span>
            </p>
          )}
        </div>
        <Button className="rounded-full shadow-none" onClick={onDeposit} size="md" variant="primary">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} size={16} strokeWidth={1.8} />
          {t("account.deposit")}
        </Button>
      </div>
    </section>
  );
}
