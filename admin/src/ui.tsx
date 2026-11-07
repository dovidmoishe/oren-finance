import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowReloadHorizontalIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import { useQueryClient } from "@tanstack/react-query";
import { useReport } from "./state";
import { initialRange, readable } from "./model";

export function Icon({
  icon,
  size = 19,
}: {
  icon: typeof AlertCircleIcon;
  size?: number;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.65}
      aria-hidden="true"
    />
  );
}
export const icons = {
  refresh: ArrowReloadHorizontalIcon,
  arrow: ArrowRight01Icon,
  download: Download04Icon,
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
    <section className={`panel ${className}`}>
      <div className="panel-heading">
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
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note: string;
  tone?: string;
}) {
  return (
    <section className={`metric ${tone}`}>
      <span className="eyebrow">{label}</span>
      <strong className={value === "Unavailable" ? "unavailable" : ""}>
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
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title = "No activity in this period",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Icon icon={ArrowReloadHorizontalIcon} size={23} />
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
    <div className="notice error" role="alert">
      <Icon icon={AlertCircleIcon} />
      <div>
        <strong>We couldn’t load this view</strong>
        <p>{error.message}</p>
      </div>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" />
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
      <div className="filters">
        <div className="range-fields">
          <label>
            From
            <input
              type="date"
              value={state.from}
              onChange={(event) => state.update({ from: event.target.value })}
            />
          </label>
          <span className="range-arrow">
            <Icon icon={ArrowRight01Icon} size={15} />
          </span>
          <label>
            To
            <input
              type="date"
              value={state.to}
              onChange={(event) => state.update({ to: event.target.value })}
            />
          </label>
        </div>
        <label className="timezone">
          <span className="sr-only">Report timezone</span>
          <select
            value={utcOnly ? "UTC" : state.timezone}
            disabled={utcOnly}
            onChange={(event) => state.update({ timezone: event.target.value })}
          >
            <option value="Africa/Lagos">Lagos · WAT</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <button
          className="subtle"
          onClick={() =>
            state.update(initialRange(utcOnly ? "UTC" : state.timezone))
          }
        >
          Last 14 days
        </button>
        <button
          className="icon-button"
          aria-label="Refresh reports"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ["report"] })
          }
        >
          <Icon icon={icons.refresh} />
        </button>
      </div>
      {!state.valid && (
        <div className="notice error" role="alert">
          Choose valid dates, with the end after the start, spanning at most 366
          days.
        </div>
      )}
      {utcOnly && (
        <p className="filter-note">
          Funnel, campaign and retention reports use UTC calendar days.
        </p>
      )}
    </>
  );
}
export function DateTime({ value }: { value: string | null }) {
  if (!value) return <span className="muted">Unavailable</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return <span className="muted">Unavailable</span>;
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
      <span className="muted">WAT</span>
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
