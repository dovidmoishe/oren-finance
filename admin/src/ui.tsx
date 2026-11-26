import {
  alertNotice,
  card,
  dateField,
  iconButton,
  notice,
  button,
  primaryButton,
  selectButton,
} from "./control-styles";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Globe,
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
  rangeLabel,
  rangePresets,
  readable,
  validRange,
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
export const toneClasses: Record<Tone, string> = {
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
      className={`grid shrink-0 place-items-center ${small ? "size-8 rounded-lg" : "size-10 rounded-xl"} ${toneClasses[tone]}`}
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
    <div className={`${alertNotice} ${className}`} role="alert">
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
const zones = [
  { value: "Africa/Lagos", label: "WAT", title: "Lagos days (WAT)" },
  { value: "UTC", label: "UTC", title: "UTC days" },
];

/**
 * The date range as one button. Its panel lists presets as rows, with a check
 * on the selected one, and keeps the custom range below a hairline.
 */
function DateRangePicker({ timezone }: { timezone: string }) {
  const state = useReport();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useId();
  const preset = activePreset(state.from, state.to, timezone);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    // The selected preset, or the first when the range is custom.
    const presets = root.current?.querySelectorAll<HTMLButtonElement>(
      "[data-preset]",
    );
    (
      [...(presets ?? [])].find(
        (item) => item.getAttribute("aria-pressed") === "true",
      ) ?? presets?.[0]
    )?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function toggle() {
    if (!open) {
      setFrom(state.from);
      setTo(state.to);
      setError("");
    }
    setOpen((value) => !value);
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validRange(from, to)) {
      setError("End on or after the start, at most 366 days later.");
      return;
    }
    state.update({ from, to });
    close();
  }
  return (
    <div className="relative max-w-full" ref={root}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        className={selectButton}
        onClick={toggle}
      >
        <span className="text-muted">
          <Icon icon={CalendarDays} size={16} />
        </span>
        <span className="truncate">{rangeLabel(state.from, state.to)}</span>
        {preset && (
          <span className="font-normal text-muted mobile:hidden">
            · Last {preset} days
          </span>
        )}
        <span
          className={`text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <Icon icon={ChevronDown} size={14} />
        </span>
      </button>
      {open && (
        <div
          id={panel}
          role="dialog"
          aria-label="Choose dates"
          className="absolute top-full left-0 z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-1.5 shadow-pop"
        >
          <div className="grid gap-0.5">
            {rangePresets.map((days) => {
              const range = initialRange(timezone, new Date(), days);
              return (
                <button
                  key={days}
                  type="button"
                  data-preset
                  aria-pressed={preset === days}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-panel focus-visible:bg-panel pointer-coarse:h-11"
                  onClick={() => {
                    state.update(range);
                    close();
                  }}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {preset === days && (
                      <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex-1 font-medium">Last {days} days</span>
                  <span className="text-xs text-muted">
                    {rangeLabel(range.from, range.to)}
                  </span>
                </button>
              );
            })}
          </div>
          <form
            className="mt-1.5 grid gap-2.5 border-t border-border px-2.5 pt-3 pb-1.5"
            onSubmit={apply}
          >
            <span className="text-xs font-medium text-muted">Custom range</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[11px] font-medium text-muted">
                From
                <input
                  className={dateField}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted">
                To
                <input
                  className={dateField}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
            {error && (
              <p className="text-xs text-error" role="alert">
                {error}
              </p>
            )}
            <button className={`${primaryButton} w-full`} type="submit">
              Apply dates
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** One row of report filters above everything it scopes: the date range, then the timezone. */
export function DateFilters({ utcOnly = false }: { utcOnly?: boolean }) {
  const state = useReport();
  const client = useQueryClient();
  const timezone = utcOnly ? "UTC" : state.timezone;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <DateRangePicker timezone={timezone} />
        {utcOnly ? (
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-medium text-muted shadow-xs pointer-coarse:h-11"
            title="This report counts UTC days"
          >
            <Icon icon={Globe} size={14} />
            UTC days
          </span>
        ) : (
          <div
            className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-xs"
            role="group"
            aria-label="Report timezone"
          >
            {zones.map((zone) => (
              <button
                key={zone.value}
                type="button"
                aria-pressed={state.timezone === zone.value}
                title={zone.title}
                className={`h-7 min-w-12 cursor-pointer rounded-lg px-2.5 text-xs font-medium transition-colors pointer-coarse:h-9 ${state.timezone === zone.value ? "bg-primary text-primary-foreground shadow-xs" : "text-muted hover:bg-panel hover:text-foreground"}`}
                onClick={() => state.update({ timezone: zone.value })}
              >
                {zone.label}
              </button>
            ))}
          </div>
        )}
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
