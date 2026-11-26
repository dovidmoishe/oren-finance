import {
  button,
  field,
  inlineNotice,
  metricGrid,
  notice,
  panelNote,
  quietButton,
  tableScroll,
} from "./control-styles";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Activity as ActivityIcon,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  ChartSpline,
  CircleDollarSign,
  Clock,
  CopyCheck,
  Database,
  Earth,
  Eye,
  FileText,
  KeyRound,
  Layers,
  Link2,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Plug,
  Route,
  Search,
  Sparkles,
  Table2,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { api, exportDaily } from "./api";
import {
  axisLabel,
  countryFlag,
  countryName,
  dayLabel,
  exactUsd,
  formatCount,
  formatMetric,
  formatUsd,
  hasObservation,
  hasPermission,
  missingValue,
  niceScale,
  percent,
  readable,
  referrerInitial,
  referrerLabel,
  shortDateTime,
  trafficCoverage,
} from "./model";
import { useAuth, useReport, useReportQuery } from "./state";
import type {
  Activity,
  Breakdown,
  Breakdowns,
  Comparison,
  Coverage,
  Day,
  Funnel,
  Page,
  Retention,
  TradeRow,
  Traffic,
} from "./types";
import {
  Badge,
  DateFilters,
  DateTime,
  Empty,
  ErrorState,
  Icon,
  IconChip,
  icons,
  Loading,
  Metric,
  Panel,
  PermissionDenied,
  Status,
} from "./ui";

export type ReportView =
  "overview" | "traffic" | "funnel" | "retention" | "campaigns" | "coverage";
export function ReportPage({ view }: { view: ReportView }) {
  const { session } = useAuth();
  if (!session || !hasPermission(session, "reports.read")) {
    if (view === "overview") return <AvailableSections />;
    return <PermissionDenied permission="reports.read" />;
  }
  if (view === "coverage") return <CoveragePage />;
  return (
    <>
      <DateFilters
        utcOnly={["funnel", "retention", "campaigns"].includes(view)}
      />
      {view === "overview" ? (
        <Overview />
      ) : view === "traffic" ? (
        <TrafficPage />
      ) : view === "funnel" ? (
        <FunnelPage />
      ) : view === "retention" ? (
        <RetentionPage />
      ) : (
        <CampaignPage />
      )}
    </>
  );
}

function AvailableSections() {
  const { session } = useAuth();
  const links = [
    ...(session && hasPermission(session, "dashboard.access")
      ? [
          { to: "/users", label: "Connected accounts", icon: Users },
          { to: "/trades", label: "Trade activity", icon: ActivityIcon },
        ]
      : []),
    ...(session?.isMaster
      ? [{ to: "/accounts", label: "Manage team access", icon: KeyRound }]
      : []),
  ];
  return (
    <Panel title="Available sections" subtitle="Ask your master admin for analytics access.">
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-[13px] font-medium transition-colors hover:bg-panel"
          >
            <IconChip icon={link.icon} small />
            <span className="flex-1">{link.label}</span>
            <Icon icon={icons.arrow} size={15} />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function Overview() {
  const { session } = useAuth();
  const { valid } = useReport();
  const traffic = useReportQuery<Traffic>("traffic");
  // Started with the traffic query so the panels do not wait for the chart.
  const breakdowns = useReportQuery<Breakdowns>("breakdowns");
  if (!valid) return null;
  const operations = !!session && hasPermission(session, "dashboard.access");
  return (
    <>
      <OverviewMetrics traffic={traffic} />
      {operations ? (
        <>
          <div className="grid gap-5 mobile:gap-4 min-[1100px]:grid-cols-3 [&>*]:min-w-0">
            <PageviewsPanel
              query={traffic}
              overview
              className="min-[1100px]:col-span-2"
            />
            <BreakdownSection query={breakdowns} kind="countries" rows={5} />
          </div>
          <div className="grid gap-5 mobile:gap-4 min-[1100px]:grid-cols-3 [&>*]:min-w-0">
            <BreakdownSection query={breakdowns} kind="referrers" rows={5} />
            <RecentTrades className="min-[1100px]:col-span-2" />
          </div>
        </>
      ) : (
        <>
          <PageviewsPanel query={traffic} overview />
          <AudiencePanels query={breakdowns} rows={5} overview />
        </>
      )}
    </>
  );
}

function OverviewMetrics({ traffic }: { traffic: UseQueryResult<Traffic> }) {
  const { params, valid } = useReport();
  const activity = useQuery({
    queryKey: ["report", "activity", params.toString()],
    queryFn: () => api<Activity>(`dashboard/activity?${params}`),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const { data } = activity;
  const pageviews =
    traffic.data && trafficCoverage(traffic.data.daily).recordedPageviews;
  return (
    <>
      <div className={metricGrid}>
        <Metric
          label="Trading volume"
          icon={CircleDollarSign}
          tone="green"
          value={data ? formatUsd(data.volumeUsd) : missingValue}
          title={data ? exactUsd.format(data.volumeUsd) : undefined}
          note="Verified stock trades"
          loading={activity.isPending}
          dimmed={activity.isPlaceholderData}
        />
        <Metric
          label="Trades"
          icon={ArrowLeftRight}
          tone="violet"
          value={data ? formatMetric(data.trades) : missingValue}
          loading={activity.isPending}
          dimmed={activity.isPlaceholderData}
        />
        <Metric
          label="In-app chats"
          icon={MessagesSquare}
          tone="blue"
          value={data ? formatMetric(data.chats) : missingValue}
          note={data && `${formatMetric(data.messages)} messages sent`}
          loading={activity.isPending}
          dimmed={activity.isPlaceholderData}
        />
        <Metric
          label="Pageviews"
          icon={Eye}
          tone="orange"
          value={pageviews != null ? formatMetric(pageviews) : missingValue}
          loading={traffic.isPending}
          dimmed={traffic.isPlaceholderData}
        />
      </div>
      {activity.error && (
        <div className={notice} role="status">
          <p className="flex-1 self-center text-foreground!">
            Couldn’t load trading and chat totals.
          </p>
          <button className={button} onClick={() => void activity.refetch()}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function PageviewsPanel({
  query,
  overview = false,
  className = "",
}: {
  query: UseQueryResult<Traffic>;
  overview?: boolean;
  className?: string;
}) {
  const { params } = useReport();
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const title = "Daily pageviews";
  if (query.isPending)
    return (
      <Panel title={title} icon={ChartSpline} className={className}>
        <Loading />
      </Panel>
    );
  if (query.error)
    return (
      <ErrorState
        className={className}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const traffic = query.data;
  const { recordedPageviews, partial, missing } = trafficCoverage(
    traffic.daily,
  );
  async function download() {
    setExportError("");
    setExporting(true);
    try {
      await exportDaily(params);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }
  return (
    <Panel
      title={title}
      subtitle={
        recordedPageviews != null
          ? `${recordedPageviews.toLocaleString("en-US")} recorded in these dates`
          : undefined
      }
      icon={ChartSpline}
      className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""} ${className}`}
      action={
        overview ? (
          <Link className={button} to="/traffic">
            View traffic <Icon icon={icons.arrow} size={14} />
          </Link>
        ) : (
          <button
            className={button}
            onClick={() => void download()}
            disabled={exporting}
          >
            <Icon icon={icons.download} size={16} />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        )
      }
    >
      {exportError && (
        <div className={`${inlineNotice} mx-5 mb-3`} role="alert">
          {exportError}
        </div>
      )}
      {recordedPageviews != null ? (
        <TrafficChart days={traffic.daily} uniques={traffic.dailyUniques.days} />
      ) : (
        <Empty title="No visits recorded for these dates" />
      )}
      {recordedPageviews != null && (missing > 0 || partial) && (
        <p className="px-5 pb-4 text-xs text-muted">
          {[
            missing > 0 && "Gaps are days without data.",
            partial && "Open dots are partial days.",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </Panel>
  );
}

function TrafficPage() {
  const query = useReportQuery<Traffic>("traffic");
  // Started with the traffic query so the panels do not wait for the chart.
  const breakdowns = useReportQuery<Breakdowns>("breakdowns");
  const { valid } = useReport();
  if (!valid) return null;
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const traffic = query.data;
  const { recordedPageviews, missing } = trafficCoverage(traffic.daily);
  const visitors = traffic.distinctDurableVisitorsFirstSeenInRange;
  const visitorCount =
    recordedPageviews == null && visitors.value === 0
      ? missingValue
      : formatCount(visitors);
  const dimmed = query.isPlaceholderData;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 mobile:gap-3 min-[900px]:grid-cols-3">
        <Metric
          label="Recorded pageviews"
          icon={Eye}
          tone="orange"
          value={
            recordedPageviews != null
              ? formatMetric(recordedPageviews)
              : missingValue
          }
          dimmed={dimmed}
        />
        <Metric
          label="New visitors"
          icon={UserPlus}
          tone="blue"
          value={visitorCount}
          note="First seen in this range"
          dimmed={dimmed}
        />
        <Metric
          label="Days with data"
          icon={CalendarCheck}
          tone="green"
          value={`${traffic.daily.length - missing} / ${traffic.daily.length}`}
          dimmed={dimmed}
          className="max-[899px]:col-span-2"
        />
      </div>
      <PageviewsPanel query={query} />
      <AudiencePanels query={breakdowns} rows={10} />
      <Panel title="Daily observations" icon={Table2}>
        <div className={tableScroll}>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Pageviews</th>
                <th>Daily uniques</th>
                <th>Coverage</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {traffic.daily.map((day) => (
                <tr key={day.day}>
                  <td className="whitespace-nowrap">
                    <time dateTime={day.day}>{dayLabel(day.day)}</time>
                  </td>
                  <td className="font-medium tabular-nums">
                    {formatCount(day)}
                  </td>
                  <td className="tabular-nums">
                    {traffic.dailyUniques.days
                      .find((item) => item.day === day.day)
                      ?.value.toLocaleString("en-US") ?? missingValue}
                  </td>
                  <td>
                    <Status
                      value={
                        day.status === "unavailable" ? "no data" : day.status
                      }
                    />
                    {day.reason && day.reason !== "no_observation" && (
                      <span className="mt-1 block max-w-60 truncate text-[11px] text-muted">
                        {readable(day.reason)}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{readable(day.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={panelNote}>
          A dash means no observation. Daily uniques count visitors separately
          each day.
        </p>
      </Panel>
    </>
  );
}

export function AudiencePanels({
  query,
  rows,
  overview = false,
}: {
  query: UseQueryResult<Breakdowns>;
  rows: number;
  overview?: boolean;
}) {
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const dimmed = query.isPlaceholderData;
  return (
    <div className="grid items-stretch gap-5 mobile:gap-4 min-[901px]:grid-cols-2 [&>*]:min-w-0">
      <ReferrersPanel
        data={query.data}
        rows={rows}
        overview={overview}
        dimmed={dimmed}
      />
      <CountriesPanel
        data={query.data}
        rows={rows}
        overview={overview}
        dimmed={dimmed}
      />
    </div>
  );
}

function BreakdownSection({
  query,
  kind,
  rows,
}: {
  query: UseQueryResult<Breakdowns>;
  kind: "countries" | "referrers";
  rows: number;
}) {
  if (query.isPending)
    return (
      <Panel
        title={kind === "countries" ? "Countries" : "Referrers"}
        icon={kind === "countries" ? Earth : Link2}
      >
        <Loading />
      </Panel>
    );
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const Section = kind === "countries" ? CountriesPanel : ReferrersPanel;
  return (
    <Section
      data={query.data}
      rows={rows}
      overview
      dimmed={query.isPlaceholderData}
    />
  );
}

interface AudienceProps {
  data: Breakdowns;
  rows: number;
  overview?: boolean;
  dimmed?: boolean;
}
const viewAll = (
  <Link className={`${quietButton} -my-1 -mr-2 h-8 px-2.5`} to="/traffic">
    View all <Icon icon={icons.arrow} size={14} />
  </Link>
);
const attribution =
  "underline decoration-border-strong underline-offset-2 hover:text-foreground";

function ReferrersPanel({ data, rows, overview, dimmed }: AudienceProps) {
  const { referrers } = data;
  return (
    <BreakdownPanel
      title="Referrers"
      subtitle="Sites that started a visit"
      icon={Link2}
      column="Site"
      breakdown={referrers}
      // Share of every visit, so direct visits still count in the whole.
      denominator={referrers.total + referrers.missing}
      rows={rows}
      other="Other sites"
      action={overview ? viewAll : undefined}
      expandable={!overview}
      dimmed={dimmed}
      label={(key) => (
        <>
          <span
            className="grid size-6 shrink-0 place-items-center rounded-md bg-panel text-[11px] font-semibold text-muted ring-1 ring-border ring-inset"
            aria-hidden="true"
          >
            {referrerInitial(key)}
          </span>
          <span className="truncate" title={key}>
            {referrerLabel(key)}
          </span>
        </>
      )}
      empty="No visits came from another site in these dates."
      note={
        referrers.missing > 0
          ? `${referrers.missing.toLocaleString("en-US")} direct ${referrers.missing === 1 ? "visit" : "visits"} had no referring site.`
          : undefined
      }
    />
  );
}

function CountriesPanel({ data, rows, overview, dimmed }: AudienceProps) {
  const { countries, geolocation } = data;
  return (
    <BreakdownPanel
      title="Countries"
      subtitle="From each visit’s IP address, which isn’t stored"
      icon={Earth}
      column="Country"
      breakdown={countries}
      denominator={countries.total}
      rows={rows}
      other="Other countries"
      action={overview ? viewAll : undefined}
      expandable={!overview}
      dimmed={dimmed}
      label={(key) => (
        <>
          <span
            className="grid w-6 shrink-0 place-items-center font-flag text-lg leading-none"
            aria-hidden="true"
          >
            {countryFlag(key) || <Icon icon={Earth} size={16} />}
          </span>
          <span className="truncate">{countryName(key)}</span>
        </>
      )}
      empty={
        geolocation.database
          ? "No visits with a country in these dates."
          : "Countries aren’t being recorded yet."
      }
      note={
        <>
          {!geolocation.database &&
            "The location database isn’t loaded, so new visits have no country. "}
          {countries.missing > 0 &&
            `${countries.missing.toLocaleString("en-US")} ${countries.missing === 1 ? "visit has" : "visits have"} no country: recorded before country tracking began, or from a private network. `}
          <a
            className={attribution}
            href={geolocation.attributionUrl}
            rel="noreferrer"
            target="_blank"
          >
            IP Geolocation by {geolocation.provider}
          </a>
          {" · Flags by "}
          <a
            className={attribution}
            href="https://github.com/twitter/twemoji"
            rel="noreferrer"
            target="_blank"
          >
            Twemoji
          </a>
          {", "}
          <a
            className={attribution}
            href="https://creativecommons.org/licenses/by/4.0/"
            rel="noreferrer"
            target="_blank"
          >
            CC BY 4.0
          </a>
        </>
      }
    />
  );
}

/** Ranked bars in one hue, largest first: name, visits and share, with the bar under them. */
function BreakdownPanel({
  title,
  subtitle,
  icon,
  column,
  breakdown,
  denominator,
  rows,
  other,
  label,
  empty,
  note,
  action,
  expandable = true,
  dimmed = false,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  column: string;
  breakdown: Breakdown;
  denominator: number;
  rows: number;
  other: string;
  label: (key: string) => ReactNode;
  empty: string;
  note?: ReactNode;
  action?: ReactNode;
  expandable?: boolean;
  dimmed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? breakdown.rows : breakdown.rows.slice(0, rows);
  const largest = breakdown.rows[0]?.visits || 1;
  const share = (visits: number) =>
    percent(denominator > 0 ? visits / denominator : null);
  const row =
    "grid min-w-0 grid-cols-[minmax(0,1fr)_auto_3.25rem] items-center gap-x-3 gap-y-2 py-2";
  const meter = (visits: number, muted = false) => (
    <span
      className="col-span-3 h-1.5 overflow-hidden rounded-full bg-brand/12"
      aria-hidden="true"
    >
      <span
        className={`block h-full rounded-full ${muted ? "bg-muted/50" : "bg-brand"}`}
        style={{ width: `${Math.max(1.5, (visits / largest) * 100)}%` }}
      />
    </span>
  );
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={action}
      className={`transition-opacity ${dimmed ? "opacity-60" : ""}`}
    >
      {visible.length ? (
        <>
          <div
            className="flex gap-3 px-5 text-[11px] font-medium text-muted"
            aria-hidden="true"
          >
            <span className="flex-1">{column}</span>
            <span>Visits</span>
            <span className="w-[3.25rem] text-right">Share</span>
          </div>
          <ol
            className="grid px-5 pt-1 pb-3"
            aria-label={`Visits by ${column.toLowerCase()}`}
          >
            {visible.map((item) => (
              <li className={row} key={item.key}>
                <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
                  {label(item.key)}
                </span>
                <span className="text-[13px] font-medium tabular-nums">
                  {item.visits.toLocaleString("en-US")}
                  <span className="sr-only"> visits</span>
                </span>
                <span className="text-right text-xs text-muted tabular-nums">
                  {share(item.visits)}
                </span>
                {meter(item.visits)}
              </li>
            ))}
            {expanded && breakdown.otherVisits > 0 && (
              <li className={`${row} text-muted`}>
                <span className="text-[13px]">{other}</span>
                <span className="text-[13px] tabular-nums">
                  {breakdown.otherVisits.toLocaleString("en-US")}
                  <span className="sr-only"> visits</span>
                </span>
                <span className="text-right text-xs tabular-nums">
                  {share(breakdown.otherVisits)}
                </span>
                {meter(breakdown.otherVisits, true)}
              </li>
            )}
          </ol>
          {expandable && breakdown.rows.length > rows && (
            <button
              className={`${quietButton} mx-3 mb-3 self-start`}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "Show fewer" : `Show all ${breakdown.rows.length}`}
            </button>
          )}
        </>
      ) : (
        <Empty title={empty} icon={icon} />
      )}
      {note && <p className={panelNote}>{note}</p>}
    </Panel>
  );
}

function lastObservation(days: Day[]) {
  for (let index = days.length - 1; index >= 0; index--)
    if (hasObservation(days[index])) return index;
  return -1;
}

/** Daily pageviews as an area chart, with a crosshair readout on hover and keyboard focus. */
export function TrafficChart({
  days,
  uniques = [],
}: {
  days: Day[];
  uniques?: { day: string; value: number }[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  // The chart fills its card, so it matches a taller neighbour in the same row.
  const [{ width, height }, setSize] = useState({ width: 1000, height: 260 });
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const gradient = useId();
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(280, Math.round(entry.contentRect.width)),
        height: Math.max(200, Math.round(entry.contentRect.height)),
      }),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const left = 44,
    right = 16,
    top = 18,
    bottom = 30;
  const plotRight = width - right;
  const baseline = height - bottom;
  const scale = niceScale(
    Math.max(0, ...days.map((day) => (hasObservation(day) ? day.value : 0))),
  );
  const ticks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, index) => index * scale.step,
  );
  const x = (index: number) =>
    days.length === 1
      ? (left + plotRight) / 2
      : left + (index / (days.length - 1)) * (plotRight - left);
  const y = (value: number) =>
    top + (1 - value / scale.max) * (baseline - top);
  const segments: number[][] = [];
  let current: number[] = [];
  days.forEach((day, index) => {
    if (hasObservation(day)) current.push(index);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  const line = (segment: number[]) =>
    segment
      .map((index, n) => `${n ? "L" : "M"}${x(index)},${y(days[index].value!)}`)
      .join(" ");
  const area = (segment: number[]) =>
    `${line(segment)} L${x(segment[segment.length - 1])},${baseline} L${x(segment[0])},${baseline} Z`;
  const last = lastObservation(days);
  // Evenly spaced date labels, counted back from the latest day.
  const stride = Math.max(
    1,
    Math.ceil((days.length - 1) / (width < 600 ? 3 : 6)),
  );
  const labelIndices: number[] = [];
  for (let index = days.length - 1; index >= 0; index -= stride)
    labelIndices.unshift(index);
  const daily = new Map(uniques.map((item) => [item.day, item.value]));
  const point = active == null ? undefined : days[active];
  const indexAt = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    const ratio = (px - left) / Math.max(1, plotRight - left);
    return Math.min(
      days.length - 1,
      Math.max(0, Math.round(ratio * (days.length - 1))),
    );
  };
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowRight"
        ? (active ?? -1) + 1
        : event.key === "ArrowLeft"
          ? (active ?? days.length) - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? days.length - 1
              : null;
    if (next == null) return;
    event.preventDefault();
    setFromKeyboard(true);
    setActive(Math.min(days.length - 1, Math.max(0, next)));
  }
  const flip = active != null && x(active) > width * 0.62;
  return (
    <div
      className="flex min-h-[268px] min-w-0 flex-1 flex-col rounded-lg px-3 pb-2"
      tabIndex={0}
      role="group"
      aria-label="Daily pageviews chart. Use the arrow keys to read each day."
      onKeyDown={move}
      onFocus={() => {
        setFromKeyboard(true);
        setActive((value) => value ?? Math.max(0, last));
      }}
      onBlur={() => setActive(null)}
    >
      <div className="relative min-h-0 flex-1" ref={container}>
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 block size-full touch-pan-y select-none"
        role="img"
        aria-label="Daily pageviews, with gaps for missing days"
        onPointerMove={(event) => {
          setFromKeyboard(false);
          setActive(indexAt(event.clientX));
        }}
        onPointerDown={(event) => setActive(indexAt(event.clientX))}
        onPointerLeave={() => {
          if (!fromKeyboard) setActive(null);
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              className="[stop-color:var(--color-brand)] [stop-opacity:0.16]"
            />
            <stop
              offset="100%"
              className="[stop-color:var(--color-brand)] [stop-opacity:0]"
            />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y(tick)}
              x2={plotRight}
              y2={y(tick)}
              className={tick === 0 ? "stroke-border-strong" : "stroke-grid"}
              strokeWidth="1"
              shapeRendering="crispEdges"
            />
            <text
              x={left - 12}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted text-[11px] tabular-nums"
            >
              {axisLabel(tick, scale.max)}
            </text>
          </g>
        ))}
        {segments.map((segment) => (
          <path
            key={`area-${segment[0]}`}
            d={area(segment)}
            fill={`url(#${gradient})`}
          />
        ))}
        {segments.map((segment) => (
          <path
            key={`line-${segment[0]}`}
            d={line(segment)}
            className="fill-none stroke-brand"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {days.map((day, index) =>
          hasObservation(day) ? null : (
            <line
              key={day.day}
              x1={x(index)}
              y1={baseline - 6}
              x2={x(index)}
              y2={baseline}
              className="stroke-border-strong"
              strokeWidth="2"
            />
          ),
        )}
        {active != null && (
          <line
            x1={x(active)}
            y1={top - 6}
            x2={x(active)}
            y2={baseline}
            className="stroke-border-strong"
            strokeWidth="1"
            shapeRendering="crispEdges"
          />
        )}
        {days.map((day, index) =>
          hasObservation(day) &&
          (day.status === "partial" || index === last || index === active) ? (
            <circle
              key={day.day}
              cx={x(index)}
              cy={y(day.value)}
              r={index === active ? 5 : 4}
              className={
                day.status === "partial"
                  ? "fill-surface stroke-brand"
                  : "fill-brand stroke-surface"
              }
              strokeWidth="2"
            >
              <title>
                {day.day}: {day.value.toLocaleString("en-US")} pageviews (
                {day.status})
              </title>
            </circle>
          ) : null,
        )}
        {labelIndices.map((index) => (
          <text
            key={days[index].day}
            x={x(index)}
            y={height - 8}
            textAnchor={
              index === 0 && days.length > 1
                ? "start"
                : index === days.length - 1 && days.length > 1
                  ? "end"
                  : "middle"
            }
            className="fill-muted text-[11px]"
          >
            {new Date(`${days[index].day}T12:00Z`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </text>
        ))}
      </svg>
      {point && active != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-44 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs shadow-pop"
          style={{
            left: x(active) + (flip ? -14 : 14),
            transform: flip ? "translateX(-100%)" : undefined,
          }}
          aria-hidden="true"
        >
          <p className="font-medium text-muted">{dayLabel(point.day)}</p>
          {hasObservation(point) ? (
            <>
              <p className="mt-2 flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full bg-brand" />
                <strong className="text-sm font-semibold text-foreground tabular-nums">
                  {point.value.toLocaleString("en-US")}
                </strong>
                <span className="text-muted">pageviews</span>
              </p>
              {daily.has(point.day) && (
                <p className="mt-1 flex items-center gap-2 pl-5">
                  <strong className="font-semibold text-foreground tabular-nums">
                    {daily.get(point.day)!.toLocaleString("en-US")}
                  </strong>
                  <span className="text-muted">daily uniques</span>
                </p>
              )}
              {point.status === "partial" && (
                <p className="mt-1.5 text-muted">Partial day</p>
              )}
            </>
          ) : (
            <p className="mt-1.5 text-muted">No data for this day</p>
          )}
        </div>
      )}
      </div>
      <p className="sr-only" aria-live="polite">
        {fromKeyboard && point
          ? `${dayLabel(point.day)}: ${hasObservation(point) ? `${point.value.toLocaleString("en-US")} pageviews` : "no data"}`
          : ""}
      </p>
    </div>
  );
}

function RecentTrades({ className = "" }: { className?: string }) {
  const query = useQuery({
    queryKey: ["operations", "trades", 1],
    queryFn: () => api<Page<TradeRow>>("dashboard/trades?page=1"),
  });
  const usd = (value: string | null) =>
    value == null ? missingValue : exactUsd.format(Number(value));
  return (
    <Panel
      title="Recent agent trades"
      subtitle="Latest trade intents, any date"
      icon={ActivityIcon}
      className={className}
      action={
        <Link className={`${quietButton} -my-1 -mr-2 h-8 px-2.5`} to="/trades">
          View all <Icon icon={icons.arrow} size={14} />
        </Link>
      }
    >
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          className="mx-5 mb-5"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : query.data.rows.length === 0 ? (
        <Empty title="No agent trades yet" icon={ActivityIcon}>
          Trade intents from connected agents will appear here.
        </Empty>
      ) : (
        <ul className="grid px-5 pb-2">
          {query.data.rows.slice(0, 5).map((trade) => {
            const buy = trade.side !== "sell";
            return (
              <li
                key={trade.id}
                className="flex min-w-0 items-center gap-3 border-t border-border py-3 first:border-t-0"
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full ${buy ? "bg-brand/10 text-brand" : "bg-panel text-muted"}`}
                >
                  <Icon icon={buy ? ArrowDownLeft : ArrowUpRight} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    <span className="capitalize">{trade.side}</span>{" "}
                    {trade.ticker}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {buy
                      ? usd(trade.amountUsd)
                      : trade.amountShares != null
                        ? `${trade.amountShares} shares`
                        : missingValue}{" "}
                    · {readable(trade.mode)} · {shortDateTime(trade.createdAt)}
                  </p>
                </div>
                <Status value={trade.status} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const stageIcons = [Route, Plug, Search, Sparkles, FileText];

function FunnelPage() {
  const [grouping, setGrouping] = useState("none");
  const query = useReportQuery<Funnel>("funnel", `&groupBy=${grouping}`);
  const { valid } = useReport();
  if (!valid) return null;
  return (
    <Panel
      title="Funnel stages"
      subtitle="From agent setup to research, in UTC days"
      icon={ListChecks}
      className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}
      action={
        <label className="grid text-xs font-medium">
          <span className="sr-only">Group funnel</span>
          <select
            className={`${field} cursor-pointer`}
            value={grouping}
            onChange={(event) => setGrouping(event.target.value)}
          >
            <option value="none">All activity</option>
            <option value="week">By week</option>
            <option value="campaign">By campaign</option>
          </select>
        </label>
      }
    >
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          className="mx-5 mb-5"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : query.data.slices.length === 0 ? (
        <Empty />
      ) : (
        <>
          {query.data.slices.map((slice) => {
            const stages = [
              {
                label: "Setup sessions",
                value: slice.setupSessions,
                note: `${slice.setupEvents.toLocaleString("en-US")} setup events`,
              },
              {
                label: "Connected accounts",
                value: slice.connectedAccounts,
                note: `${slice.connections.toLocaleString("en-US")} connection grants`,
              },
              {
                label: "In-app research",
                value: slice.researchAccounts,
                note: `${slice.researchCalls.toLocaleString("en-US")} successful calls`,
              },
              {
                label: "MCP research",
                value: slice.mcpResearchActivation.accounts,
                note: `${slice.mcpResearchActivation.calls.toLocaleString("en-US")} successful research calls`,
              },
              {
                label: "MCP stock context",
                value: slice.mcpStockContext.accounts,
                note: `${slice.mcpStockContext.calls.toLocaleString("en-US")} get_stock calls`,
              },
            ];
            const max = Math.max(1, ...stages.map((item) => item.value));
            const outcomes = [
              ["Refused", slice.oauthRefused],
              ["Failed", slice.oauthFailed],
              ["Expired", slice.oauthExpired],
              ["Revoked grants", slice.revokedGrants],
            ] as const;
            return (
              <div className="px-5 pb-5" key={slice.key}>
                {grouping !== "none" && (
                  <h3 className="mb-1 text-[13px] font-semibold">{slice.key}</h3>
                )}
                <ol className="grid">
                  {stages.map((item, index) => (
                    <li
                      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-t border-border py-3.5 first:border-t-0 mobile:gap-3"
                      key={item.label}
                    >
                      <IconChip icon={stageIcons[index]} small />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <strong className="text-[13px] font-medium">
                            {item.label}
                          </strong>
                          <span className="text-xs text-muted">{item.note}</span>
                        </div>
                        <div
                          className="mt-2 h-2 overflow-hidden rounded-full bg-brand/12"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{
                              width: `${Math.max(item.value ? 1.5 : 0, (item.value / max) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                      <strong className="min-w-10 text-right text-xl font-semibold tracking-tight">
                        {item.value.toLocaleString("en-US")}
                      </strong>
                    </li>
                  ))}
                </ol>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {outcomes.map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl bg-panel px-3.5 py-2.5"
                    >
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="mt-0.5 text-base font-semibold">
                        {value.toLocaleString("en-US")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
          <p className={panelNote}>
            Each stage counts observed activity in the selected period. An
            account can appear in several groups.
          </p>
        </>
      )}
    </Panel>
  );
}

function RetentionPage() {
  const query = useReportQuery<Funnel>("retention");
  const { valid } = useReport();
  if (!valid) return null;
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const renderWindow = (value: Retention, days: number) => {
    const measured =
      value.value != null &&
      value.status !== "unavailable" &&
      !!value.denominator;
    const ratio = measured
      ? (value.retained ?? value.value!) / value.denominator!
      : null;
    return (
      <Panel
        title={`${days}-day research return`}
        subtitle="Returned to research or trade"
        icon={days === 7 ? CalendarDays : CalendarCheck}
        className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}
      >
        <div className="px-5 pb-5">
          <strong
            className={`block leading-none font-semibold tracking-tight ${measured ? "text-[44px]" : "text-3xl text-muted"}`}
          >
            {ratio == null ? missingValue : percent(ratio)}
          </strong>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-brand/12"
            role="meter"
            aria-label={`${days}-day research return`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ratio == null ? undefined : Math.round(ratio * 100)}
          >
            {ratio != null && (
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, ratio * 100)}%` }}
              />
            )}
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            {(
              [
                ["Returned", value.retained ?? missingValue],
                ["Eligible accounts", value.denominator ?? missingValue],
                ["Window", `${days} days`],
              ] as const
            ).map(([label, figure]) => (
              <div key={label} className="rounded-xl bg-panel px-3.5 py-2.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold">
                  {typeof figure === "number"
                    ? figure.toLocaleString("en-US")
                    : figure}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {value.reason && (
          <p className={`${panelNote} first-letter:uppercase`}>
            {readable(value.reason)}
          </p>
        )}
      </Panel>
    );
  };
  return (
    <>
      <div className="grid items-stretch gap-5 mobile:gap-4 min-[901px]:grid-cols-2 [&>*]:min-w-0">
        {renderWindow(query.data.researchRetention7d, 7)}
        {renderWindow(query.data.researchRetention30d, 30)}
      </div>
      <div className={notice}>
        <Icon icon={Clock} />
        <div>
          <strong className="font-semibold">Give cohorts time to mature</strong>
          <p>
            Each account gets the full follow-up window after its first
            research.
          </p>
        </div>
      </div>
    </>
  );
}

function CampaignPage() {
  const [dimension, setDimension] = useState("campaign");
  const query = useReportQuery<Comparison>(
    "compare",
    `&dimension=${dimension}`,
  );
  const { valid } = useReport();
  if (!valid) return null;
  return (
    <Panel
      title="Campaign results"
      subtitle="Attributed activity by campaign field"
      icon={Megaphone}
      className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}
      action={
        <label className="grid text-xs font-medium">
          <span className="sr-only">Comparison dimension</span>
          <select
            className={`${field} cursor-pointer`}
            value={dimension}
            onChange={(event) => setDimension(event.target.value)}
          >
            <option value="campaign">Campaign</option>
            <option value="content">Content</option>
            <option value="term">Term</option>
            <option value="slot">Placement slot</option>
          </select>
        </label>
      }
    >
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          className="mx-5 mb-5"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : query.data.rows.length === 0 ? (
        <Empty title="No campaign observations yet" icon={Megaphone}>
          Campaign information will appear when attributed activity is recorded.
        </Empty>
      ) : (
        <>
          <div className={tableScroll}>
            <table>
              <thead>
                <tr>
                  <th className="capitalize">{readable(dimension)}</th>
                  <th>Pageviews</th>
                  <th>Connections</th>
                  <th>Research accounts</th>
                  <th>Connection rate</th>
                  <th>Sample</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((row) => (
                  <tr key={row.key}>
                    <td className="font-medium">{row.key}</td>
                    <td className="tabular-nums">
                      {query.data.denominator === "pageviews"
                        ? row.sampleSize.toLocaleString("en-US")
                        : missingValue}
                    </td>
                    <td className="tabular-nums">{row.connections}</td>
                    <td className="tabular-nums">{row.researchAccounts}</td>
                    <td className="tabular-nums">
                      {percent(row.connectionRate)}
                    </td>
                    <td>
                      <Badge
                        dot
                        tone={
                          row.sampleSize >= query.data.minimumSample
                            ? "green"
                            : "amber"
                        }
                      >
                        {row.sampleSize >= query.data.minimumSample
                          ? "Above minimum"
                          : "Below minimum"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={panelNote}>
            {query.data.inference} Minimum sample: {query.data.minimumSample}.
            Non-campaign denominators are unavailable. No significance is
            claimed.
          </p>
        </>
      )}
    </Panel>
  );
}

function CoveragePage() {
  const query = useQuery({
    queryKey: ["report", "coverage"],
    queryFn: () => api<Coverage>("reports/coverage"),
  });
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const coverage = query.data;
  return (
    <>
      <div className={metricGrid}>
        <Metric
          label="Raw observations"
          icon={Database}
          tone="blue"
          value={`${coverage.rawRetentionDays} days`}
          note="Then deleted, after being added to the daily totals, which are kept"
        />
        <Metric
          label="Identity keys"
          icon={KeyRound}
          tone="violet"
          value={
            coverage.identityRetentionDays == null
              ? "Kept"
              : `${coverage.identityRetentionDays} days`
          }
          note="New-visitor counts stay available for every date range"
        />
        <Metric
          label="Attribution"
          icon={Target}
          tone="orange"
          value={<span className="capitalize">{readable(coverage.attribution.model)}</span>}
          note={`${coverage.attribution.windowDays}-day attribution window`}
        />
        <Metric
          label="Idempotency"
          icon={CopyCheck}
          tone="green"
          value={`${coverage.idempotencyRetentionDays} days`}
          note="Duplicate ingestion protection"
        />
      </div>
      <Panel title="Collection sources" icon={Layers}>
        {coverage.collectors.length ? (
          <div className={tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Collector</th>
                  <th>Started</th>
                  <th>Collection</th>
                </tr>
              </thead>
              <tbody>
                {coverage.collectors.map((collector) => (
                  <tr key={collector.source}>
                    <td className="font-medium capitalize">
                      {readable(collector.source)}
                    </td>
                    <td>
                      <DateTime value={collector.startedAt} />
                    </td>
                    <td>
                      <Badge tone="green" dot>
                        Source recorded
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No collectors recorded" icon={Layers}>
            A collector appears after its first accepted observation. This does
            not establish historical coverage.
          </Empty>
        )}
      </Panel>
      <div className="grid items-stretch gap-5 mobile:gap-4 min-[901px]:grid-cols-2 [&>*]:min-w-0">
        <Panel title="External series" icon={Link2}>
          <ul className="grid px-5 pb-3">
            {["X / social activity", "Revenue & costs", "Token holders"].map(
              (name) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-3 border-t border-border py-3 text-[13px] first:border-t-0"
                >
                  <span>{name}</span>
                  <Badge>Not connected</Badge>
                </li>
              ),
            )}
          </ul>
          <p className={panelNote}>
            No external sync is enabled. Historical observations stay separate
            from live telemetry.
          </p>
        </Panel>
        <Panel title="History & provenance" icon={FileText}>
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted">
            Imported totals and historical snapshots keep their original dates
            and coverage.
          </p>
        </Panel>
      </div>
      <Panel title="Metric definitions" icon={ListChecks}>
        <dl className="grid px-5 pb-4">
          {Object.entries(coverage.definitions).map(([key, value]) => (
            <div
              key={key}
              className="grid gap-1 border-t border-border py-3.5 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-4"
            >
              <dt className="text-[13px] font-medium first-letter:uppercase">
                {key.replace(/([A-Z])/g, " $1").toLowerCase()}
              </dt>
              <dd className="text-[13px] leading-relaxed text-muted">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}
