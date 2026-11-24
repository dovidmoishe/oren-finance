import {
  button,
  iconButton,
  quietButton,
  notice,
  field,
} from "./control-styles";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, RefreshCw, ArrowRight, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useReport } from "./state";
import { initialRange, readable } from "./model";

export function Icon({
  icon: Glyph,
  size = 19,
}: {
  icon: LucideIcon;
  size?: number;
}) {
  return <Glyph size={size} strokeWidth={1.65} aria-hidden="true" />;
}
export const icons = {
  refresh: RefreshCw,
  arrow: ArrowRight,
  download: Download,
};
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mb-5 min-w-0 overflow-hidden rounded-md border border-border bg-white ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_p]:mt-1 [&_p]:text-xs [&_p]:text-muted">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <section className="flex min-h-32 min-w-0 flex-col justify-between gap-2 rounded-md border border-border bg-white p-5 mobile:p-4 [&_p]:text-[11px] [&_p]:leading-relaxed [&_p]:text-muted">
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
        {label}
      </span>
      <strong
        className={`leading-tight font-medium tracking-tight tabular-nums ${value === "Unavailable" ? "text-lg text-muted" : "text-3xl mobile:text-2xl"}`}
      >
        {value}
      </strong>
      <p>{note}</p>
    </section>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  const colors =
    tone === "green"
      ? "bg-emerald-50 text-emerald-800"
      : tone === "red"
        ? "bg-rose-50 text-rose-800"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : "bg-panel text-muted";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${colors}`}
    >
      {children}
    </span>
  );
}
export function Empty({
  title = "No activity in this period",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2 px-5 py-12 text-center [&_h3]:font-semibold [&_p]:max-w-sm [&_p]:text-xs [&_p]:text-muted">
      <div className="mb-1 grid size-10 place-items-center rounded-full bg-panel text-muted">
        <Icon icon={RefreshCw} size={23} />
      </div>
      <h3>{title}</h3>
      <p>
        {children ||
          "Try another date range. New activity will appear here when it is recorded."}
      </p>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className={notice} role="alert">
      <Icon icon={CircleAlert} />
      <div>
        <strong>We couldn’t load this view</strong>
        <p>{error.message}</p>
      </div>
      {retry && (
        <button className={button} onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div
      className="flex items-center justify-center gap-2 p-8 text-xs text-muted"
      role="status"
    >
      <span className="size-2 rounded-full bg-brand motion-safe:animate-pulse" />
      Loading workspace…
    </div>
  );
}
export function PermissionDenied({ permission }: { permission: string }) {
  return (
    <Panel title="Access required">
      <Empty title="This section isn’t included in your access">
        Ask your master admin for {permission}. Your other sections are still
        available.
      </Empty>
    </Panel>
  );
}
export function DateFilters({ utcOnly = false }: { utcOnly?: boolean }) {
  const state = useReport();
  const client = useQueryClient();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 [&>button:last-child]:ml-auto">
        <div className="flex max-w-full flex-wrap items-end gap-2">
          <label className="grid gap-1.5 text-xs font-medium">
            From
            <input
              className={field}
              type="date"
              value={state.from}
              onChange={(event) => state.update({ from: event.target.value })}
            />
          </label>
          <span className="mb-2.5 text-muted">
            <Icon icon={ArrowRight} size={15} />
          </span>
          <label className="grid gap-1.5 text-xs font-medium">
            To
            <input
              className={field}
              type="date"
              value={state.to}
              onChange={(event) => state.update({ to: event.target.value })}
            />
          </label>
        </div>
        <label className="block">
          <span className="sr-only">Report timezone</span>
          <select
            className={field}
            value={utcOnly ? "UTC" : state.timezone}
            disabled={utcOnly}
            onChange={(event) => state.update({ timezone: event.target.value })}
          >
            <option value="Africa/Lagos">Lagos · WAT</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <button
          className={quietButton}
          onClick={() =>
            state.update(initialRange(utcOnly ? "UTC" : state.timezone))
          }
        >
          Last 14 days
        </button>
        <button
          className={iconButton}
          aria-label="Refresh reports"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ["report"] })
          }
        >
          <Icon icon={icons.refresh} />
        </button>
      </div>
      {!state.valid && (
        <div className={notice} role="alert">
          Choose valid dates, with the end after the start, spanning at most 366
          days.
        </div>
      )}
      {utcOnly && (
        <p className="mb-4 text-xs text-muted">
          Funnel, campaign and retention reports use UTC calendar days.
        </p>
      )}
    </>
  );
}
export function DateTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">Unavailable</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return <span className="text-muted">Unavailable</span>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Lagos",
      }).format(date)}{" "}
      <span className="text-muted">WAT</span>
    </time>
  );
}
export function Status({ value }: { value: string }) {
  const tone = ["confirmed", "active", "exact"].includes(value)
    ? "green"
    : ["failed", "revoked"].includes(value)
      ? "red"
      : "amber";
  return <Badge tone={tone}>{readable(value)}</Badge>;
}
