"use client";

import {
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  RefreshCw as RefreshCwIcon,
} from "lucide-react";

import Link from "next/link";
import { Fragment, useId, useState, type ReactNode } from "react";
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

const headerCell = "px-2.5 py-3 font-medium text-muted sm:px-4";
const cell = "px-2.5 py-3 sm:px-4 sm:py-3.5";
const desktopCell = "hidden @2xl:table-cell";
const toolbarButton = "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-semibold text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11";

function PositionLogo({ position }: { position: PortfolioPosition }) {
  const [failed, setFailed] = useState(false);
  const logo = position.logoUrl;
  const url = logo?.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + logo.slice(7)
    : logo?.startsWith("//") ? "https:" + logo : logo;

  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl border border-border/60 bg-panel text-[10px] font-bold text-muted sm:size-10">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="size-full rounded-[inherit] object-contain p-1" onError={() => setFailed(true)} src={url} />
      ) : position.ticker.slice(0, 2)}
    </span>
  );
}

function PositionsTable({ positions, hidden }: { positions: PortfolioPosition[]; hidden: boolean }) {
  const { locale, t } = useI18n();
  const [expandedAsset, setExpandedAsset] = useState<string>();
  const detailsId = useId();
  const privateValue = (value: string) => hidden ? "••••••" : value;

  if (!positions.length) {
    return <EmptyState description={t("portfolio.noPositionsDescription")} title={t("portfolio.noPositionsTitle")} />;
  }

  return (
    <Table aria-label={t("portfolio.positions")} className="table-fixed">
      <TableHeader className="bg-panel-subtle/70">
        <TableRow>
          <TableHead className={cn(headerCell, "w-[44%] rounded-s-xl")} scope="col">{t("portfolio.colAsset")}</TableHead>
          <TableHead className={cn(headerCell, "w-[20%] text-end")} scope="col">{t("portfolio.col24h")}</TableHead>
          <TableHead className={cn(headerCell, "text-end")} scope="col">{t("vault.colValue")}</TableHead>
          <TableHead className="w-9 rounded-e-xl" scope="col"><span className="sr-only">{t("portfolio.positionDetails")}</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position, index) => {
          const open = expandedAsset === position.assetId;
          const target = detailsId + "-" + index;
          const change = position.change24hPct;
          const details = [
            { label: t("portfolio.colAvailable"), value: privateValue(formatNumber(position.availableQuantity, locale)) },
            { label: t("portfolio.colLocked"), value: privateValue(formatNumber(position.lockedQuantity, locale)) },
            { label: t("portfolio.colPrice"), value: formatCurrency(position.priceUsd, locale) },
          ];
          return (
            <Fragment key={position.assetId}>
              <TableRow className="hover:bg-accent-lavender/10 focus-within:bg-accent-lavender/10">
                <TableCell className={cell}>
                  <Link className="flex min-w-0 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-focus sm:gap-2.5" href={"/app/stocks/" + encodeURIComponent(position.assetId)}>
                    <PositionLogo position={position} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold sm:text-sm" title={position.name}>{position.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{position.ticker}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className={cn(cell, "break-words text-end text-xs font-semibold font-money tabular-nums sm:text-sm", change === undefined || change === 0 ? "text-muted" : change < 0 ? "text-negative" : "text-positive")}>
                  {change === undefined ? "—" : formatPercent(change, locale, change !== 0)}
                </TableCell>
                <TableCell className={cn(cell, "break-words text-end text-xs font-semibold font-money tabular-nums sm:text-sm")}>{privateValue(formatCurrency(position.valueUsd, locale))}</TableCell>
                <TableCell className="p-0">
                  <button
                    aria-controls={target}
                    aria-expanded={open}
                    aria-label={t("portfolio.positionDetails") + " " + position.ticker}
                    className="grid h-11 w-9 place-items-center rounded text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
                    onClick={() => setExpandedAsset(open ? undefined : position.assetId)}
                    type="button"
                  >
                    <ChevronDownIcon aria-hidden="true" className={open ? "rotate-180" : undefined} size={15} strokeWidth={1.8} />
                  </button>
                </TableCell>
              </TableRow>
              <tr className="bg-panel-subtle/65" hidden={!open} id={target}>
                <td className="px-3.5 py-3.5" colSpan={4}>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    {details.map(({ label, value }) => (
                      <div className="min-w-0" key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 break-words font-medium font-money tabular-nums">{value}</dd></div>
                    ))}
                  </dl>
                </td>
              </tr>
            </Fragment>
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
      <TableHeader className="bg-panel-subtle/70">
        <TableRow>
          <TableHead className={cn(headerCell, desktopCell, "w-[23%] rounded-s-xl")} scope="col">{t("portfolio.colDate")}</TableHead>
          <TableHead className={cn(headerCell, "w-[46%] rounded-s-xl @2xl:w-auto @2xl:rounded-none")} scope="col">{t("common.activityTitle")}</TableHead>
          <TableHead className={cn(headerCell, desktopCell, "w-[15%] text-end")} scope="col">{t("trader.quantity")}</TableHead>
          <TableHead className={cn(headerCell, "w-[25%] @2xl:w-[18%]")} scope="col">{t("vault.colStatus")}</TableHead>
          <TableHead className={cn(headerCell, "rounded-e-xl text-end @2xl:w-[17%]")} scope="col">{t("vault.colValue")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {activity.slice(0, 6).map((item) => {
          const timestamp = formatDateTime(item.occurredAt, locale, timeZone, t("common.unknown"));
          return (
            <TableRow className="hover:bg-accent-lavender/10 focus-within:bg-accent-lavender/10" key={item.id}>
              <TableCell className={cn(cell, desktopCell, "text-xs text-muted")}>{timestamp}</TableCell>
              <TableCell className={cell}>
                <span className="block truncate font-semibold">{item.ticker ?? t(activityLabels[item.type])}</span>
                {(item.ticker || item.route) && <span className="block text-xs text-muted">{[item.ticker ? t(activityLabels[item.type]) : undefined, item.route].filter(Boolean).join(" · ")}</span>}
                <span className="block text-xs text-muted @2xl:hidden">{timestamp}</span>
              </TableCell>
              <TableCell className={cn(cell, desktopCell, "break-words text-end font-money tabular-nums")}>
                {item.quantity === undefined ? "—" : hidden ? "••••••" : formatNumber(item.quantity, locale)}
              </TableCell>
              <TableCell className={cell}><span className="inline-block max-w-full break-words rounded-md bg-panel-subtle px-1.5 py-0.5 text-xs font-medium capitalize">{item.status ?? t("common.activitySeen")}</span></TableCell>
              <TableCell className={cn(cell, "break-words text-end text-xs font-semibold font-money tabular-nums sm:text-sm")}>
                {item.valueUsd === undefined ? "—" : hidden ? "••••••" : formatCurrency(item.valueUsd, locale)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function PortfolioTables({ positions, activity, allocation, history, hidden, isLoading, onRefresh }: {
  positions: PortfolioPosition[];
  activity: PortfolioActivityItem[];
  allocation: ReactNode;
  history?: ReactNode;
  hidden: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<"positions" | "allocation" | "activity">("positions");
  const options = [
    { id: "positions", label: t("portfolio.positions") },
    { id: "allocation", label: t("trader.allocation") },
    { id: "activity", label: t("common.activityTitle") },
  ] as const;

  return (
    <section aria-label={options.find((option) => option.id === section)?.label}>
      {history && <div aria-label={t("portfolio.valueHistory")} className="mb-8 overflow-hidden rounded-xl border border-border p-3 @lg:p-4">{history}</div>}
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-border @lg:gap-3">
        <div aria-label={t("nav.portfolio")} className="flex min-w-0 gap-5 overflow-x-auto" role="group">
          {options.map(({ id, label }) => (
            <button
              aria-pressed={id === section}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap border-b-2 px-0.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus",
                id === section ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground",
              )}
              key={id}
              onClick={() => setSection(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {section === "activity" ? (
          <Link className={toolbarButton} href="/app/activity">
            {t("portfolio.viewAll")}
            <ChevronRightIcon aria-hidden="true" size={14} strokeWidth={1.8} />
          </Link>
        ) : (
          <button aria-label={t("portfolio.refresh")} className={toolbarButton} disabled={isLoading} onClick={onRefresh} title={t("portfolio.refresh")} type="button">
            <RefreshCwIcon aria-hidden="true" className={isLoading ? "motion-safe:animate-spin" : undefined} size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {section === "positions" && <PositionsTable hidden={hidden} positions={positions} />}
      {section === "allocation" && allocation}
      {section === "activity" && <RecentActivityTable activity={activity} hidden={hidden} />}
    </section>
  );
}
