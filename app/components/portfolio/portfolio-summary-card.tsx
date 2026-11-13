"use client";

import { Add01Icon, ArrowDown01Icon, ChartLineData01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, formatCurrency } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import type { PortfolioSummary } from "@/types";

const allocationColors = ["bg-[#7160dd]", "bg-[#30303a]", "bg-[#d994ce]", "bg-[#e8bd45]", "bg-[#718ac6]"];
const masked = "••••••";

function Allocation({ portfolio }: { portfolio: PortfolioSummary }) {
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
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });

  return (
    <div className="mt-5 sm:mt-6">
      <h3 className="sr-only">{t("portfolio.allocation")}</h3>
      <div aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-panel-subtle sm:h-2">
        {allocations.map(({ key, value, color }) => (
          <span className={cn("min-w-0 basis-0 rounded-full", color)} key={key} style={{ flexGrow: value }} />
        ))}
      </div>
      {allocations.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted sm:gap-x-5">
          {allocations.map(({ key, label, value, color }) => (
            <li className="inline-flex items-center gap-1.5" key={key}>
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", color)} />
              <span className="font-medium">{label}</span>
              <span className="tabular-nums">{percent.format(value / portfolio.totalValueUsd)}</span>
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
  const changeColor = !hidden && change ? change > 0 ? "text-[#16734a]" : "text-[#be3545]" : "text-muted";
  const metrics = [
    { label: t("portfolio.colAvailable"), value: balance(portfolio.availableValueUsd) },
    { label: t("portfolio.colLocked"), value: balance(portfolio.lockedValueUsd) },
    { label: t("portfolio.cashLabel"), value: balance(portfolio.cashValueUsd) },
  ];

  return (
    <section aria-label={t("portfolio.totalValue")} className="rounded-2xl border border-border bg-panel p-3.5 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold sm:text-base">{t("portfolio.totalValue")}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 sm:gap-x-2">
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
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted">
            <span className={cn("font-semibold tabular-nums", changeColor)}>{hidden ? masked : changeValue}</span>
            <span>{t("portfolio.snapshotChange")}</span>
          </p>
        </div>
        <Button className="rounded-full shadow-none" onClick={onDeposit} size="md" variant="primary">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} size={16} strokeWidth={1.8} />
          {t("account.deposit")}
        </Button>
      </div>

      <Allocation portfolio={portfolio} />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 border-t border-border/75 pt-1.5 text-xs text-muted">
        <details className="group contents">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 font-semibold hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            {t("portfolio.detailsTitle")}
            <HugeiconsIcon aria-hidden="true" className="group-open:rotate-180" icon={ArrowDown01Icon} size={12} strokeWidth={1.8} />
          </summary>
          <dl className="order-last grid w-full grid-cols-2 gap-x-3 gap-y-2 px-1.5 pt-2 pb-1 @sm:grid-cols-3">
            {metrics.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="break-words font-semibold text-foreground tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
        <button
          aria-expanded={historyOpen}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11"
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
