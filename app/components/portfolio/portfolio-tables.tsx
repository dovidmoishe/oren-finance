"use client";

import { ArrowRight01Icon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useState } from "react";
import {
  EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  cn, formatCurrency, formatDateTime, formatNumber, formatPercent,
} from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import type { PortfolioActivityItem, PortfolioPosition } from "@/types";

const activityLabels: Record<PortfolioActivityItem["type"], MessageKey> = {
  trade: "common.activityTrade",
  basket: "common.activityBasket",
  lock: "common.activityLock",
  unlock: "common.activityUnlock",
  transfer: "common.activityTransfer",
  unknown: "common.activityUnknown",
};

const headerCell = "px-2.5 py-2.5 font-medium sm:px-3.5";
const cell = "px-2.5 py-3 sm:px-3.5";
const desktopCell = "hidden md:table-cell";
const toolbarButton = "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-semibold text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11";

function PositionLogo({ position }: { position: PortfolioPosition }) {
  const [failed, setFailed] = useState(false);
  const logo = position.logoUrl;
  const url = logo?.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + logo.slice(7)
    : logo?.startsWith("//") ? "https:" + logo : logo;

  return (
    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-subtle text-[10px] font-bold text-muted sm:size-8">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="size-full rounded-full object-contain p-0.5" onError={() => setFailed(true)} src={url} />
      ) : position.ticker.slice(0, 2)}
    </span>
  );
}

function PositionsTable({ positions, hidden }: { positions: PortfolioPosition[]; hidden: boolean }) {
  const { locale, t } = useI18n();
  const privateValue = (value: string) => hidden ? "••••••" : value;

  if (!positions.length) {
    return <EmptyState description={t("portfolio.noPositionsDescription")} title={t("portfolio.noPositionsTitle")} />;
  }

  return (
    <Table aria-label={t("portfolio.positions")} className="table-fixed">
      <TableHeader className="bg-panel-subtle">
        <TableRow>
          <TableHead className={cn(headerCell, "w-[47%] rounded-s-xl md:w-auto")} scope="col">{t("portfolio.colAsset")}</TableHead>
          <TableHead className={cn(headerCell, "w-[22%] text-end md:w-[13%]")} scope="col">{t("portfolio.col24h")}</TableHead>
          <TableHead className={cn(headerCell, desktopCell, "w-[13%] text-end")} scope="col">{t("portfolio.colAvailable")}</TableHead>
          <TableHead className={cn(headerCell, desktopCell, "w-[12%] text-end")} scope="col">{t("portfolio.colLocked")}</TableHead>
          <TableHead className={cn(headerCell, desktopCell, "w-[13%] text-end")} scope="col">{t("portfolio.colPrice")}</TableHead>
          <TableHead className={cn(headerCell, "rounded-e-xl text-end md:w-[16%]")} scope="col">{t("vault.colValue")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => {
          const available = privateValue(formatNumber(position.availableQuantity, locale));
          const locked = privateValue(formatNumber(position.lockedQuantity, locale));
          const price = formatCurrency(position.priceUsd, locale);
          const change = position.change24hPct;
          return (
            <TableRow className="hover:bg-panel-subtle/60" key={position.assetId}>
              <TableCell className={cell}>
                <Link className="flex min-w-0 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-focus sm:gap-2.5" href={"/app/stocks/" + encodeURIComponent(position.assetId)}>
                  <PositionLogo position={position} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold" title={position.name}>{position.name}</span>
                    <span className="block truncate text-xs text-muted">{position.ticker}</span>
                  </span>
                </Link>
                <details className="mt-1 text-xs text-muted md:hidden">
                  <summary className="w-fit cursor-pointer rounded py-1 font-medium focus-visible:outline-2 focus-visible:outline-focus">{t("portfolio.positionDetails")}<span className="sr-only"> {position.ticker}</span></summary>
                  <dl className="mt-1 grid gap-1">
                    {[[t("portfolio.colAvailable"), available], [t("portfolio.colLocked"), locked], [t("portfolio.colPrice"), price]].map(([label, value]) => (
                      <div className="flex flex-wrap justify-between gap-x-1" key={label}><dt>{label}</dt><dd className="break-all font-medium text-foreground tabular-nums">{value}</dd></div>
                    ))}
                  </dl>
                </details>
              </TableCell>
              <TableCell className={cn(cell, "break-words text-end text-xs font-semibold tabular-nums sm:text-sm", change === undefined || change === 0 ? "text-muted" : change < 0 ? "text-[#be3545]" : "text-[#16734a]")}>
                {change === undefined ? "—" : formatPercent(change, locale, change !== 0)}
              </TableCell>
              <TableCell className={cn(cell, desktopCell, "break-words text-end tabular-nums")}>{available}</TableCell>
              <TableCell className={cn(cell, desktopCell, "break-words text-end tabular-nums")}>{locked}</TableCell>
              <TableCell className={cn(cell, desktopCell, "break-words text-end tabular-nums")}>{price}</TableCell>
              <TableCell className={cn(cell, "break-words text-end text-xs font-semibold tabular-nums sm:text-sm")}>{privateValue(formatCurrency(position.valueUsd, locale))}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RecentActivityTable({ activity, hidden }: { activity: PortfolioActivityItem[]; hidden: boolean }) {
  const { locale, timeZone, t } = useI18n();
  if (!activity.length) return <EmptyState description={t("common.noActivityDescription")} title={t("common.noActivityTitle")} />;

  return (
    <Table aria-label={t("portfolio.recentActivity")} className="table-fixed">
      <TableHeader className="bg-panel-subtle">
        <TableRow>
          <TableHead className={cn(headerCell, desktopCell, "w-[23%] rounded-s-xl")} scope="col">{t("portfolio.colDate")}</TableHead>
          <TableHead className={cn(headerCell, "w-[46%] rounded-s-xl md:w-auto md:rounded-none")} scope="col">{t("common.activityTitle")}</TableHead>
          <TableHead className={cn(headerCell, desktopCell, "w-[15%] text-end")} scope="col">{t("trader.quantity")}</TableHead>
          <TableHead className={cn(headerCell, "w-[25%] md:w-[18%]")} scope="col">{t("vault.colStatus")}</TableHead>
          <TableHead className={cn(headerCell, "rounded-e-xl text-end md:w-[17%]")} scope="col">{t("vault.colValue")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {activity.slice(0, 6).map((item) => {
          const timestamp = formatDateTime(item.occurredAt, locale, timeZone, t("common.unknown"));
          return (
            <TableRow className="hover:bg-panel-subtle/60" key={item.id}>
              <TableCell className={cn(cell, desktopCell, "text-xs text-muted")}>{timestamp}</TableCell>
              <TableCell className={cell}>
                <span className="block truncate font-semibold">{item.ticker ?? t(activityLabels[item.type])}</span>
                {(item.ticker || item.route) && <span className="block text-xs text-muted">{[item.ticker ? t(activityLabels[item.type]) : undefined, item.route].filter(Boolean).join(" · ")}</span>}
                <span className="block text-xs text-muted md:hidden">{timestamp}</span>
              </TableCell>
              <TableCell className={cn(cell, desktopCell, "break-words text-end tabular-nums")}>
                {item.quantity === undefined ? "—" : hidden ? "••••••" : formatNumber(item.quantity, locale)}
              </TableCell>
              <TableCell className={cell}><span className="inline-block max-w-full break-words rounded-md bg-panel-subtle px-1.5 py-0.5 text-xs font-medium capitalize">{item.status ?? t("common.activitySeen")}</span></TableCell>
              <TableCell className={cn(cell, "break-words text-end text-xs font-semibold tabular-nums sm:text-sm")}>
                {item.valueUsd === undefined ? "—" : hidden ? "••••••" : formatCurrency(item.valueUsd, locale)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function PortfolioTables({ positions, activity, hidden, isLoading, onRefresh }: {
  positions: PortfolioPosition[];
  activity: PortfolioActivityItem[];
  hidden: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [showActivity, setShowActivity] = useState(false);
  const options = [{ label: t("portfolio.positions"), activity: false }, { label: t("portfolio.recentActivity"), activity: true }];

  return (
    <section aria-label={showActivity ? t("portfolio.recentActivity") : t("portfolio.positions")}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div aria-label={t("nav.portfolio")} className="flex flex-wrap gap-3 sm:gap-5" role="group">
          {options.map((option) => (
            <button
              aria-pressed={option.activity === showActivity}
              className={cn(
                "min-h-10 border-b-2 px-0.5 text-sm font-semibold focus-visible:rounded focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11",
                option.activity === showActivity ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground",
              )}
              key={option.label}
              onClick={() => setShowActivity(option.activity)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        {showActivity ? (
          <Link className={toolbarButton} href="/app/activity">
            {t("portfolio.viewAll")}
            <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} size={14} strokeWidth={1.8} />
          </Link>
        ) : (
          <button aria-label={t("portfolio.refresh")} className={toolbarButton} disabled={isLoading} onClick={onRefresh} title={t("portfolio.refresh")} type="button">
            <HugeiconsIcon aria-hidden="true" className={isLoading ? "motion-safe:animate-spin" : undefined} icon={RefreshCwIcon} size={15} strokeWidth={1.8} />
            <span className="hidden sm:inline">{t("portfolio.refresh")}</span>
          </button>
        )}
      </div>
      {showActivity ? <RecentActivityTable activity={activity} hidden={hidden} /> : <PositionsTable hidden={hidden} positions={positions} />}
    </section>
  );
}
