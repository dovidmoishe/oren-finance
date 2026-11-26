import {
  card,
  field,
  iconButton,
  notice,
  button,
} from "./control-styles";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Download,
  Inbox,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useReport } from "./state";
import {
  activePreset,
  initialRange,
  missingValue,
  rangePresets,
  readable,
} from "./model";

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

export type Tone = "violet" | "blue" | "green" | "orange" | "pink";
const chipTones: Record<Tone, string> = {
  violet: "bg-brand/10 text-brand",
  blue: "bg-accent-blue/10 text-accent-blue",
  green: "bg-accent-green/10 text-accent-green",
  orange: "bg-accent-orange/10 text-accent-orange",
  pink: "bg-accent-pink/10 text-accent-pink",
};
/** A tinted square behind an icon. Decoration only: it never encodes data or status. */
export function IconChip({
  icon,
  tone = "violet",
  small = false,
}: {
  icon: LucideIcon;
  tone?: Tone;
  small?: boolean;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center ${small ? "size-8 rounded-lg" : "size-10 rounded-xl"} ${chipTones[tone]}`}
    >
      <Icon icon={icon} size={small ? 16 : 19} />
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${card} flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4.5 pb-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {icon && (
            <span className="mt-px text-muted">
              <Icon icon={icon} size={17} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] leading-5 font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A stat tile. Values use proportional figures; only aligned columns use tabular ones. */
export function Metric({
  label,
  value,
  note,
  icon,
  tone = "violet",
  loading = false,
  dimmed = false,
  title,
  className = "",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  dimmed?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <section
      className={`${card} flex min-w-0 items-start gap-4 p-5 transition-opacity mobile:flex-col mobile:gap-3 mobile:p-4 ${dimmed ? "opacity-60" : ""} ${className}`}
      aria-busy={loading || undefined}
    >
      {icon && <IconChip icon={icon} tone={tone} />}
      <div className="min-w-0">
        <span className="block text-[13px] leading-5 font-medium text-muted">
          {label}
        </span>
        {loading ? (
          <span
            className="mt-1.5 block h-8 w-24 rounded-lg bg-panel motion-safe:animate-pulse"
            aria-hidden="true"
          />
        ) : (
          <strong
            className={`mt-1 block leading-tight font-semibold tracking-tight ${value === missingValue ? "text-2xl text-muted" : "text-[26px] mobile:text-[22px]"}`}
            title={title}
          >
            {value}
          </strong>
        )}
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
    </section>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-success-surface text-success",
  red: "bg-error-surface text-error",
  amber: "bg-warning-surface text-warning",
  brand: "bg-brand/10 text-brand",
  "": "bg-panel text-muted ring-1 ring-border ring-inset",
};
export function Badge({
  children,
  tone = "",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] leading-5 font-medium whitespace-nowrap ${badgeTones[tone] ?? badgeTones[""]}`}
    >
      {dot && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
export function Empty({
  title = "No activity in this period",
  icon = Inbox,
  children,
}: {
  title?: string;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="grid flex-1 content-center justify-items-center gap-1.5 px-5 py-12 text-center">
      <div className="mb-2 grid size-11 place-items-center rounded-xl bg-panel text-muted">
        <Icon icon={icon} size={20} />
      </div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="max-w-sm text-xs leading-relaxed text-muted">
        {children || "Try another date range."}
      </p>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
  className = "",
}: {
  error: Error;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div className={`${notice} items-center ${className}`} role="alert">
      <Icon icon={CircleAlert} />
      <div className="min-w-0 flex-1">
        <strong className="font-semibold">We couldn’t load this view</strong>
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
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex flex-1 items-center justify-center gap-2 p-10 text-xs text-muted"
      role="status"
    >
      <span className="size-2 rounded-full bg-brand motion-safe:animate-pulse" />
      {label}
    </div>
  );
}
export function PermissionDenied({ permission }: { permission: string }) {
  return (
    <Panel title="Access required" icon={LockKeyhole}>
      <Empty title="This section isn’t included in your access" icon={LockKeyhole}>
        Ask your master admin for {permission}. Your other sections are still
        available.
      </Empty>
    </Panel>
  );
}

/** One row of report filters above everything it scopes: presets first, then a custom range. */
export function DateFilters({ utcOnly = false }: { utcOnly?: boolean }) {
  const state = useReport();
  const client = useQueryClient();
  const timezone = utcOnly ? "UTC" : state.timezone;
  const preset = activePreset(state.from, state.to, timezone);
  const dateInput =
    "min-w-0 cursor-pointer bg-transparent text-[13px] text-foreground [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-80";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-xs"
          role="group"
          aria-label="Date range"
        >
          {rangePresets.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={preset === days}
              title={`Last ${days} days`}
              className={`h-7 min-w-11 cursor-pointer rounded-lg px-2.5 text-xs font-medium transition-colors pointer-coarse:h-9 ${preset === days ? "bg-primary text-primary-foreground shadow-xs" : "text-muted hover:bg-panel hover:text-foreground"}`}
              onClick={() => state.update(initialRange(timezone, new Date(), days))}
            >
              <span aria-hidden="true">{days}D</span>
              <span className="sr-only">Last {days} days</span>
            </button>
          ))}
        </div>
        <div className="flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-muted shadow-xs pointer-coarse:h-11">
          <Icon icon={CalendarDays} size={15} />
          <input
            className={dateInput}
            aria-label="From"
            type="date"
            value={state.from}
            onChange={(event) => state.update({ from: event.target.value })}
          />
          <Icon icon={ArrowRight} size={13} />
          <input
            className={dateInput}
            aria-label="To"
            type="date"
            value={state.to}
            onChange={(event) => state.update({ to: event.target.value })}
          />
        </div>
        <select
          className={`${field} cursor-pointer`}
          aria-label="Report timezone"
          value={timezone}
          disabled={utcOnly}
          title={utcOnly ? "This report uses UTC days" : undefined}
          onChange={(event) => state.update({ timezone: event.target.value })}
        >
          <option value="Africa/Lagos">Lagos · WAT</option>
          <option value="UTC">UTC</option>
        </select>
        <button
          className={`${iconButton} ml-auto border border-border bg-surface shadow-xs`}
          aria-label="Refresh reports"
          title="Refresh reports"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ["report"] })
          }
        >
          <Icon icon={icons.refresh} size={17} />
        </button>
      </div>
      {!state.valid && (
        <div className={notice} role="alert">
          <Icon icon={CircleAlert} />
          <p className="text-foreground!">
            Choose valid dates, with the end after the start, spanning at most
            366 days.
          </p>
        </div>
      )}
    </div>
  );
}
export function DateTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">{missingValue}</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return <span className="text-muted">{missingValue}</span>;
  return (
    <time dateTime={value} className="whitespace-nowrap">
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
  return (
    <Badge tone={tone} dot>
      {readable(value)}
    </Badge>
  );
}
