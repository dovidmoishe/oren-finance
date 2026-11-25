import {
  button,
  metricGrid,
  tableScroll,
  panelNote,
  notice,
  field,
  quietButton,
} from "./control-styles";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, exportDaily } from "./api";
import {
  countryFlag,
  countryName,
  formatCount,
  hasObservation,
  hasPermission,
  missingValue,
  percent,
  readable,
  referrerLabel,
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
  Retention,
  Traffic,
} from "./types";
import {
  Badge,
  DateFilters,
  DateTime,
  Empty,
  ErrorState,
  Icon,
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
    if (view === "overview")
      return (
        <Panel title="Available sections">
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {session && hasPermission(session, "dashboard.access") && (
              <>
                <Link
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-panel"
                  to="/users"
                >
                  Connected accounts
                  <Icon icon={icons.arrow} />
                </Link>
                <Link
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-panel"
                  to="/trades"
                >
                  Trade activity
                  <Icon icon={icons.arrow} />
                </Link>
              </>
            )}
            {session?.isMaster && (
              <Link
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-panel"
                to="/accounts"
              >
                Manage team access
                <Icon icon={icons.arrow} />
              </Link>
            )}
          </div>
          <p className={panelNote}>
            Ask your master admin for analytics access.
          </p>
        </Panel>
      );
    return <PermissionDenied permission="reports.read" />;
  }
  if (view === "coverage") return <CoveragePage />;
  return (
    <>
      <DateFilters
        utcOnly={["funnel", "retention", "campaigns"].includes(view)}
      />
      {view === "overview" ? (
        <>
          <OverviewMetrics />
          <TrafficPage overview />
        </>
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

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function OverviewMetrics() {
  const { params, valid } = useReport();
  const traffic = useReportQuery<Traffic>("traffic");
  const activity = useQuery({
    queryKey: ["report", "activity", params.toString()],
    queryFn: () => api<Activity>(`dashboard/activity?${params}`),
    enabled: valid,
  });
  if (!valid) return null;
  const { data } = activity;
  const pending = activity.isPending ? "?" : missingValue;
  const pageviews =
    traffic.data && trafficCoverage(traffic.data.daily).recordedPageviews;
  return (
    <>
      <div
        className={metricGrid}
        aria-busy={activity.isPending || traffic.isPending}
      >
        <Metric
          label="Trading volume"
          value={data ? usd.format(data.volumeUsd) : pending}
          note="Verified stock trades"
        />
        <Metric
          label="Trades"
          value={data ? data.trades.toLocaleString() : pending}
        />
        <Metric
          label="In-app chats"
          value={data ? data.chats.toLocaleString() : pending}
          note={data && `${data.messages.toLocaleString()} messages sent`}
        />
        <Metric
          label="Pageviews"
          value={
            pageviews?.toLocaleString() ??
            (traffic.isPending ? "?" : missingValue)
          }
        />
      </div>
      {activity.error && (
        <p
          className="mb-4 flex items-center gap-3 text-sm text-muted"
          role="status"
        >
          Couldn’t load trading and chat totals.
          <button className={button} onClick={() => void activity.refetch()}>
            Retry
          </button>
        </p>
      )}
    </>
  );
}

function TrafficPage({ overview = false }: { overview?: boolean }) {
  const query = useReportQuery<Traffic>("traffic");
  // Started with the traffic query so the panels do not wait for the chart.
  const breakdowns = useReportQuery<Breakdowns>("breakdowns");
  const { params, valid } = useReport();
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  if (!valid) return null;
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const traffic = query.data;
  const { recordedPageviews, partial, missing } = trafficCoverage(
    traffic.daily,
  );
  const visitors = traffic.distinctDurableVisitorsFirstSeenInRange;
  const visitorCount =
    recordedPageviews == null && visitors.value === 0
      ? missingValue
      : formatCount(visitors);
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
    <>
      {!overview && (
        <div className="mb-5 grid grid-cols-2 gap-3 min-[900px]:grid-cols-3">
          <Metric
            label="Recorded pageviews"
            value={recordedPageviews?.toLocaleString() ?? missingValue}
          />
          <Metric
            label="New visitors"
            value={visitorCount}
            note="First seen in this range"
          />
          <Metric
            label="Days with data"
            value={`${traffic.daily.length - missing} / ${traffic.daily.length}`}
            compact
          />
        </div>
      )}
      <Panel
        title="Daily pageviews"
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
          <div className={`${notice} mx-5`} role="alert">
            {exportError}
          </div>
        )}
        {recordedPageviews != null ? (
          <TrafficChart days={traffic.daily} />
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
      <AudiencePanels query={breakdowns} rows={overview ? 5 : 10} />
      {!overview && (
        <Panel title="Daily observations">
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
                    <td>{day.day}</td>
                    <td className="tabular-nums">{formatCount(day)}</td>
                    <td className="tabular-nums">
                      {traffic.dailyUniques.days
                        .find((item) => item.day === day.day)
                        ?.value.toLocaleString() ?? missingValue}
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
                    <td>{readable(day.source)}</td>
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
      )}
    </>
  );
}

export function AudiencePanels({
  query,
  rows,
}: {
  query: UseQueryResult<Breakdowns>;
  rows: number;
}) {
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const { countries, referrers, geolocation } = query.data;
  return (
    <div className="grid items-start gap-x-4 min-[901px]:grid-cols-2">
      <BreakdownPanel
        title="Referrers"
        subtitle="Sites that started a visit"
        column="Site"
        breakdown={referrers}
        // Share of every visit, so direct visits still count in the whole.
        denominator={referrers.total + referrers.missing}
        rows={rows}
        other="Other sites"
        label={(key) => (
          <span className="truncate" title={key}>
            {referrerLabel(key)}
          </span>
        )}
        empty="No visits came from another site in these dates."
        note={
          referrers.missing > 0
            ? `${referrers.missing.toLocaleString()} direct ${referrers.missing === 1 ? "visit" : "visits"} had no referring site.`
            : undefined
        }
      />
      <BreakdownPanel
        title="Countries"
        subtitle="From each visit’s IP address, which isn’t stored"
        column="Country"
        breakdown={countries}
        denominator={countries.total}
        rows={rows}
        other="Other countries"
        label={(key) => (
          <>
            <span aria-hidden="true">{countryFlag(key)}</span>
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
              `${countries.missing.toLocaleString()} ${countries.missing === 1 ? "visit has" : "visits have"} no country: recorded before country tracking began, or from a private network. `}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={geolocation.attributionUrl}
              rel="noreferrer"
              target="_blank"
            >
              IP Geolocation by {geolocation.provider}
            </a>
          </>
        }
      />
    </div>
  );
}

function BreakdownPanel({
  title,
  subtitle,
  column,
  breakdown,
  denominator,
  rows,
  other,
  label,
  empty,
  note,
}: {
  title: string;
  subtitle: string;
  column: string;
  breakdown: Breakdown;
  denominator: number;
  rows: number;
  other: string;
  label: (key: string) => ReactNode;
  empty: string;
  note?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? breakdown.rows : breakdown.rows.slice(0, rows);
  const largest = breakdown.rows[0]?.visits || 1;
  const share = (visits: number) =>
    percent(denominator > 0 ? visits / denominator : null);
  const row =
    "relative flex min-h-9 items-center gap-3 overflow-hidden rounded-md px-3 text-xs";
  return (
    <Panel title={title} subtitle={subtitle}>
      {visible.length ? (
        <>
          <div
            className="flex gap-3 px-6 pb-1 text-[11px] font-medium text-muted"
            aria-hidden="true"
          >
            <span className="flex-1">{column}</span>
            <span>Visits</span>
            <span className="w-12 text-right">Share</span>
          </div>
          <ol className="grid gap-1 px-3 pb-3" aria-label={`Visits by ${column.toLowerCase()}`}>
            {visible.map((item) => (
              <li className={row} key={item.key}>
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-md bg-panel"
                  style={{ width: `${(item.visits / largest) * 100}%` }}
                />
                <span className="relative flex min-w-0 flex-1 items-center gap-2">
                  {label(item.key)}
                </span>
                <span className="relative font-medium tabular-nums">
                  {item.visits.toLocaleString()}
                  <span className="sr-only"> visits</span>
                </span>
                <span className="relative w-12 text-right tabular-nums text-muted">
                  {share(item.visits)}
                </span>
              </li>
            ))}
            {expanded && breakdown.otherVisits > 0 && (
              <li className={`${row} text-muted`}>
                <span className="relative flex-1">{other}</span>
                <span className="relative tabular-nums">
                  {breakdown.otherVisits.toLocaleString()}
                  <span className="sr-only"> visits</span>
                </span>
                <span className="relative w-12 text-right tabular-nums">
                  {share(breakdown.otherVisits)}
                </span>
              </li>
            )}
          </ol>
          {breakdown.rows.length > rows && (
            <button
              className={`${quietButton} mx-3 mb-3`}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "Show fewer" : `Show all ${breakdown.rows.length}`}
            </button>
          )}
        </>
      ) : (
        <Empty title={empty} />
      )}
      {note && <p className={panelNote}>{note}</p>}
    </Panel>
  );
}

function TrafficChart({ days }: { days: Day[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(300, entry.contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const height = 230,
    left = 48,
    top = 16,
    bottom = 36;
  const maximum = Math.max(
    1,
    ...days.map((day) => (hasObservation(day) ? day.value : 0)),
  );
  const max = Math.max(4, Math.ceil(maximum / 4) * 4);
  const x = (index: number) =>
    left + (index / Math.max(1, days.length - 1)) * (width - left - 20);
  const y = (value: number) =>
    top + (1 - value / max) * (height - top - bottom);
  const segments: string[] = [];
  let segment = "";
  days.forEach((day, index) => {
    if (!hasObservation(day)) {
      if (segment) segments.push(segment);
      segment = "";
    } else segment += `${segment ? " L" : "M"} ${x(index)} ${y(day.value)}`;
  });
  if (segment) segments.push(segment);
  const intervals = Math.min(days.length - 1, width < 600 ? 3 : 5);
  const labelIndices = Array.from({ length: intervals + 1 }, (_, index) =>
    intervals > 0 ? Math.round((index * (days.length - 1)) / intervals) : 0,
  );
  return (
    <div
      className="min-w-0 px-3 pt-2 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_text]:fill-muted [&_text]:text-[10px]"
      ref={container}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily pageviews, with gaps for missing days"
      >
        {[0, 1, 2, 3, 4].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y((max * tick) / 4)}
              x2={width - 20}
              y2={y((max * tick) / 4)}
              stroke="var(--color-border)"
              strokeDasharray="4 5"
            />
            <text x={left - 14} y={y((max * tick) / 4) + 4} textAnchor="end">
              {Math.round((max * tick) / 4).toLocaleString()}
            </text>
          </g>
        ))}
        {segments.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        ))}
        {days.map((day, index) =>
          hasObservation(day) ? (
            <circle
              key={day.day}
              cx={x(index)}
              cy={y(day.value)}
              r={day.status === "partial" ? 5 : 3}
              fill={
                day.status === "partial"
                  ? "var(--color-surface)"
                  : "var(--color-brand)"
              }
              stroke="var(--color-brand)"
              strokeWidth="2"
            >
              <title>
                {day.day}: {day.value.toLocaleString()} pageviews ({day.status})
              </title>
            </circle>
          ) : (
            <g key={day.day}>
              <line
                x1={x(index)}
                y1={height - bottom - 7}
                x2={x(index)}
                y2={height - bottom}
                stroke="var(--color-border-strong)"
                strokeWidth="2"
              />
              <title>{day.day}: no observation</title>
            </g>
          ),
        )}
        {labelIndices.map((index) => (
          <text
            key={days[index].day}
            x={x(index)}
            y={height - 10}
            textAnchor="middle"
          >
            {new Date(`${days[index].day}T12:00Z`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </text>
        ))}
      </svg>
    </div>
  );
}

function FunnelPage() {
  const [grouping, setGrouping] = useState("none");
  const query = useReportQuery<Funnel>("funnel", `&groupBy=${grouping}`);
  const { valid } = useReport();
  if (!valid) return null;
  return (
    <Panel
      title="Funnel stages"
      action={
        <label className="grid gap-1.5 text-xs font-medium">
          <span className="sr-only">Group funnel</span>
          <select
            className={field}
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
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.slices.length === 0 ? (
        <Empty />
      ) : (
        <>
          {query.data.slices.map((slice) => {
            const stages = [
              {
                label: "Setup sessions",
                value: slice.setupSessions,
                note: `${slice.setupEvents} setup events`,
              },
              {
                label: "Connected accounts",
                value: slice.connectedAccounts,
                note: `${slice.connections} connection grants`,
              },
              {
                label: "In-app research",
                value: slice.researchAccounts,
                note: `${slice.researchCalls} successful calls`,
              },
              {
                label: "MCP research",
                value: slice.mcpResearchActivation.accounts,
                note: `${slice.mcpResearchActivation.calls} successful research calls`,
              },
              {
                label: "MCP stock context",
                value: slice.mcpStockContext.accounts,
                note: `${slice.mcpStockContext.calls} get_stock calls`,
              },
            ];
            const max = Math.max(1, ...stages.map((item) => item.value));
            return (
              <div
                className="px-5 pb-5 [&>h3]:mb-3 [&>h3]:font-semibold"
                key={slice.key}
              >
                {grouping !== "none" && <h3>{slice.key}</h3>}
                {stages.map((item) => (
                  <div
                    className="flex items-center gap-4 border-t border-border py-3"
                    key={item.label}
                  >
                    <div className="min-w-0 flex-1 [&>div:first-child]:mb-2 [&>div:first-child]:flex [&>div:first-child]:flex-wrap [&>div:first-child]:items-baseline [&>div:first-child]:justify-between [&_strong]:text-xs [&_span]:text-[11px] [&_span]:text-muted">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.note}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-panel [&>div]:h-full [&>div]:rounded-full [&>div]:bg-muted">
                        <div
                          style={{ width: `${(item.value / max) * 100}%` }}
                        />
                      </div>
                    </div>
                    <strong className="min-w-8 text-right text-lg font-medium tabular-nums">
                      {item.value.toLocaleString()}
                    </strong>
                  </div>
                ))}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted [&_strong]:ml-1 [&_strong]:text-foreground">
                  <span>
                    Refused <strong>{slice.oauthRefused}</strong>
                  </span>
                  <span>
                    Failed <strong>{slice.oauthFailed}</strong>
                  </span>
                  <span>
                    Expired <strong>{slice.oauthExpired}</strong>
                  </span>
                  <span>
                    Revoked grants <strong>{slice.revokedGrants}</strong>
                  </span>
                </div>
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
  const renderWindow = (value: Retention, days: number) => (
    <Panel
      title={`${days}-day research return`}
      subtitle="Returned to research or trade"
    >
      <div className="px-5 pb-3 text-4xl font-medium tracking-tight tabular-nums">
        {value.value == null ||
        value.status === "unavailable" ||
        !value.denominator
          ? missingValue
          : percent((value.retained ?? value.value) / value.denominator)}
      </div>
      <div className="flex flex-wrap gap-6 px-5 pb-5 text-xs text-muted [&_strong]:mt-1 [&_strong]:block [&_strong]:text-base [&_strong]:text-foreground">
        <span>
          Returned<strong>{value.retained ?? missingValue}</strong>
        </span>
        <span>
          Eligible accounts<strong>{value.denominator ?? missingValue}</strong>
        </span>
        <span>
          Window<strong>{days} days</strong>
        </span>
      </div>
      {value.reason && <p className={panelNote}>{readable(value.reason)}</p>}
    </Panel>
  );
  return (
    <>
      <div className="grid items-start gap-4 min-[901px]:grid-cols-2">
        {renderWindow(query.data.researchRetention7d, 7)}
        {renderWindow(query.data.researchRetention30d, 30)}
      </div>
      <div className={notice}>
        <Icon icon={icons.refresh} />
        <div>
          <strong>Give cohorts time to mature</strong>
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
      action={
        <label className="grid gap-1.5 text-xs font-medium">
          <span className="sr-only">Comparison dimension</span>
          <select
            className={field}
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
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <Empty title="No campaign observations yet">
          Campaign information will appear when attributed activity is recorded.
        </Empty>
      ) : (
        <>
          <div className={tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>{dimension}</th>
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
                    <td className="font-semibold">{row.key}</td>
                    <td className="tabular-nums">
                      {query.data.denominator === "pageviews"
                        ? row.sampleSize.toLocaleString()
                        : missingValue}
                    </td>
                    <td className="tabular-nums">{row.connections}</td>
                    <td className="tabular-nums">{row.researchAccounts}</td>
                    <td>{percent(row.connectionRate)}</td>
                    <td>
                      <Badge
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
          value={`${coverage.rawRetentionDays} days`}
          note="Then deleted, after being added to the daily totals, which are kept"
        />
        <Metric
          label="Identity keys"
          value={
            coverage.identityRetentionDays == null
              ? "Kept"
              : `${coverage.identityRetentionDays} days`
          }
          note="New-visitor counts stay available for every date range"
        />
        <Metric
          label="Attribution"
          value={readable(coverage.attribution.model)}
          note={`${coverage.attribution.windowDays}-day attribution window`}
        />
        <Metric
          label="Idempotency"
          value={`${coverage.idempotencyRetentionDays} days`}
          note="Duplicate ingestion protection"
        />
      </div>
      <Panel title="Collection sources">
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
                    <td>{readable(collector.source)}</td>
                    <td>
                      <DateTime value={collector.startedAt} />
                    </td>
                    <td>
                      <Badge>Source recorded</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No collectors recorded">
            A collector appears after its first accepted observation. This does
            not establish historical coverage.
          </Empty>
        )}
      </Panel>
      <div className="grid items-start gap-4 min-[901px]:grid-cols-2">
        <Panel title="External series">
          <div className="divide-y divide-border px-5 pb-3 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-3">
            {["X / social activity", "Revenue & costs", "Token holders"].map(
              (name) => (
                <div key={name}>
                  <span>{name}</span>
                </div>
              ),
            )}
          </div>
          <p className={panelNote}>
            No external sync is enabled. Historical observations stay separate
            from live telemetry.
          </p>
        </Panel>
        <Panel title="History & provenance">
          <p className="px-5 pb-4 text-sm leading-relaxed text-muted">
            Imported totals and historical snapshots keep their original dates
            and coverage.
          </p>
        </Panel>
      </div>
      <Panel title="Metric definitions">
        <dl className="divide-y divide-border px-5 pb-4 [&>div]:grid [&>div]:gap-1 [&>div]:py-3 sm:[&>div]:grid-cols-[140px_1fr] [&_dt]:text-xs [&_dt]:font-semibold [&_dd]:text-xs [&_dd]:leading-relaxed [&_dd]:text-muted">
          {Object.entries(coverage.definitions).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}
