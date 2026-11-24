import {
  primaryButton,
  button,
  metricGrid,
  tableScroll,
  panelNote,
  notice,
  field,
} from "./control-styles";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, exportDaily } from "./api";
import {
  formatCount,
  hasPermission,
  percent,
  readable,
  totalSlice,
} from "./model";
import { useAuth, useReport, useReportQuery } from "./state";
import type {
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
        <Panel
          title="Your workspace is ready"
          subtitle="Choose one of your available sections."
        >
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
            Growth reports require the separate reports.read permission.
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
      {view === "overview" || view === "traffic" ? (
        <TrafficPage overview={view === "overview"} />
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

function TrafficPage({ overview }: { overview: boolean }) {
  const query = useReportQuery<Traffic>("traffic");
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
  const known = traffic.daily.filter(
    (day) => day.value != null && day.status !== "unavailable",
  );
  const complete = traffic.daily.filter((day) => day.status === "exact").length;
  const dayCount = traffic.daily.length;
  const coverage = dayCount ? complete / dayCount : 0;
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
    <div
      className={
        overview
          ? "grid items-start gap-6 min-[1001px]:grid-cols-[minmax(0,1fr)_244px]"
          : undefined
      }
    >
      <div className="min-w-0">
        <div className={overview ? "mb-5 grid grid-cols-2 gap-3" : metricGrid}>
          <Metric
            label="Pageviews"
            value={formatCount(traffic.pageviews)}
            note="Complete, closed days in this range"
          />
          <Metric
            label="New durable visitors"
            value={formatCount(traffic.distinctDurableVisitorsFirstSeenInRange)}
            note="First seen in range · visitor IDs, not people"
          />
          {!overview && (
            <>
              <Metric
                label="Complete days"
                value={`${complete} / ${traffic.daily.length}`}
                note="Missing days are never counted as zero"
              />
              <Metric
                label="Report timezone"
                value={traffic.timezone === "Africa/Lagos" ? "WAT" : "UTC"}
                note={
                  traffic.timezone === "Africa/Lagos"
                    ? "Africa/Lagos · UTC +01:00"
                    : "Coordinated Universal Time"
                }
              />
            </>
          )}
        </div>
        {exportError && (
          <div className={notice} role="alert">
            {exportError}
          </div>
        )}
        <Panel
          title="Pageviews"
          subtitle="Accepted pageviews, day by day"
          action={
            <button
              className={overview ? primaryButton : button}
              onClick={() => void download()}
              disabled={exporting}
            >
              <Icon icon={icons.download} size={16} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          }
        >
          {known.length ? (
            <TrafficChart days={traffic.daily} />
          ) : (
            <Empty title="No traffic observations yet">
              Collection may not have started for this range. Check data
              coverage or select different dates.
            </Empty>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-2 pb-4 text-[11px] text-muted [&>span:first-child]:inline-flex [&>span:first-child]:items-center [&>span:first-child]:gap-1.5">
            <span>
              <span className="inline-block size-1.5 rounded-full bg-brand" />
              Pageviews
            </span>
            <span>Gaps and partial days are shown separately</span>
          </div>
        </Panel>
      </div>
      {overview ? (
        <aside
          className="min-w-0 min-[1001px]:border-l min-[1001px]:border-border min-[1001px]:pl-5 [&>section]:border-0 [&>section]:rounded-none [&>section>div:first-child]:px-0"
          aria-label="Overview summary"
        >
          <Panel title="Reporting coverage">
            <div className="grid justify-items-center gap-2.5 py-2 text-xs text-muted">
              <div
                className="grid size-[104px] place-items-center rounded-full [&_strong]:grid [&_strong]:size-[92px] [&_strong]:grid-flow-col [&_strong]:place-content-center [&_strong]:items-baseline [&_strong]:gap-1 [&_strong]:rounded-full [&_strong]:bg-white [&_strong]:text-2xl [&_strong]:font-medium [&_strong]:text-foreground [&_strong]:tabular-nums [&_strong_span]:text-sm [&_strong_span]:text-muted"
                aria-hidden="true"
                style={{
                  background: `conic-gradient(var(--color-brand) ${coverage}turn, var(--color-border) 0)`,
                }}
              >
                <strong>
                  {complete}
                  <span> / {dayCount}</span>
                </strong>
              </div>
              <p>
                {dayCount
                  ? `${complete} of ${dayCount} days complete`
                  : "No days available"}
              </p>
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                to="/coverage"
              >
                View coverage <Icon icon={icons.arrow} size={14} />
              </Link>
            </div>
          </Panel>
          <OverviewActivity />
        </aside>
      ) : (
        <Panel
          title="Daily observations"
          subtitle="Original status and provenance stay with every number"
        >
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
                        ?.value.toLocaleString() ?? "Unavailable"}
                    </td>
                    <td>
                      <Status value={day.status} />
                      {day.reason && (
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
            Daily unique counts describe each day individually. They are never
            summed into lifetime visitors.
          </p>
        </Panel>
      )}
    </div>
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
    ...days.map((day) => (day.status !== "unavailable" ? (day.value ?? 0) : 0)),
  );
  const max = Math.max(4, Math.ceil(maximum / 4) * 4);
  const x = (index: number) =>
    left + (index / Math.max(1, days.length - 1)) * (width - left - 20);
  const y = (value: number) =>
    top + (1 - value / max) * (height - top - bottom);
  const segments: string[] = [];
  let segment = "";
  days.forEach((day, index) => {
    if (day.value == null || day.status === "unavailable") {
      if (segment) segments.push(segment);
      segment = "";
    } else segment += `${segment ? " L" : "M"} ${x(index)} ${y(day.value)}`;
  });
  if (segment) segments.push(segment);
  return (
    <div
      className="min-w-0 px-3 pt-2 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_text]:fill-muted [&_text]:text-[10px]"
      ref={container}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily pageviews. Missing observations create gaps; use the daily observations table for exact values."
      >
        <defs>
          <linearGradient id="traffic-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#666666" stopOpacity=".14" />
            <stop offset="100%" stopColor="#666666" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y((max * tick) / 4)}
              x2={width - 20}
              y2={y((max * tick) / 4)}
              stroke="#ededed"
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
          day.value != null && day.status !== "unavailable" ? (
            <circle
              key={day.day}
              cx={x(index)}
              cy={y(day.value)}
              r={day.status === "partial" ? 5 : 3}
              fill={day.status === "partial" ? "#788694" : "var(--color-brand)"}
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
                stroke="#cccccc"
                strokeWidth="2"
              />
              <title>{day.day}: unavailable</title>
            </g>
          ),
        )}
        {days
          .filter(
            (_, index) =>
              index === 0 ||
              index === days.length - 1 ||
              index %
                Math.max(1, Math.ceil(days.length / (width < 600 ? 3 : 6))) ===
                0,
          )
          .map((day) => (
            <text
              key={day.day}
              x={x(days.indexOf(day))}
              y={height - 10}
              textAnchor="middle"
            >
              {new Date(`${day.day}T12:00Z`).toLocaleDateString("en-GB", {
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

function OverviewActivity() {
  const query = useReportQuery<Funnel>("funnel");
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const slice = totalSlice(query.data.slices);
  return (
    <div>
      <Panel title="Activation" subtitle="Selected dates · UTC">
        {slice ? (
          <div className="pb-2">
            {[
              { label: "Setup sessions", value: slice.setupSessions },
              { label: "Connected accounts", value: slice.connectedAccounts },
              {
                label: "In-app research accounts",
                value: slice.researchAccounts,
              },
            ].map((item) => (
              <div
                className="flex items-center justify-between gap-3 border-t border-border py-3 text-xs text-muted [&_strong]:font-medium [&_strong]:text-foreground [&_strong]:tabular-nums"
                key={item.label}
              >
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No funnel activity yet" />
        )}
        <div className="pt-2">
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
            to="/funnel"
          >
            Explore funnel <Icon icon={icons.arrow} size={14} />
          </Link>
        </div>
      </Panel>
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
      title="The activation journey"
      subtitle="Setup, OAuth connections and research are separate measures"
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
      subtitle="Research or a confirmed trade after the first in-range research"
    >
      <div className="px-5 pb-3 text-4xl font-medium tracking-tight tabular-nums">
        {value.value == null ||
        value.status === "unavailable" ||
        !value.denominator
          ? "Unavailable"
          : percent((value.retained ?? value.value) / value.denominator)}
      </div>
      <div className="flex flex-wrap gap-6 px-5 pb-5 text-xs text-muted [&_strong]:mt-1 [&_strong]:block [&_strong]:text-base [&_strong]:text-foreground">
        <span>
          Returned<strong>{value.retained ?? "Unavailable"}</strong>
        </span>
        <span>
          Eligible accounts<strong>{value.denominator ?? "Unavailable"}</strong>
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
            Only accounts whose full follow-up window has elapsed enter the
            denominator. Returns can fall after the selected end date. Each
            cohort starts with an account?s earliest research in the selected
            period.
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
      title="Acquisition, in context"
      subtitle="Descriptive comparisons with sample sizes kept visible"
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
                        : "Unavailable"}
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
          note="Rolling raw-data retention"
        />
        <Metric
          label="Identity keys"
          value={`${coverage.identityRetentionDays} days`}
          note="Distinct counts depend on retained keys"
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
      <Panel
        title="Collection sources"
        subtitle="The first accepted observation marks the start of coverage"
      >
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
        <Panel
          title="External series"
          subtitle="Unavailable until independently supplied"
        >
          <div className="divide-y divide-border px-5 pb-3 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-3">
            {["X / social activity", "Revenue & costs", "Token holders"].map(
              (name) => (
                <div key={name}>
                  <span>{name}</span>
                  <Badge>Unavailable</Badge>
                </div>
              ),
            )}
          </div>
          <p className={panelNote}>
            No external sync is enabled. Historical observations stay separate
            from live telemetry.
          </p>
        </Panel>
        <Panel
          title="History & provenance"
          subtitle="Recovered records keep their original limitations"
        >
          <p className="px-5 pb-4 text-sm leading-relaxed text-muted">
            Historical imports are manual operator actions. Missing days remain
            unavailable. Point-in-time snapshots are not daily deltas and are
            never added to live trade counts.
          </p>
          <p className={panelNote}>
            This workspace does not import history or issue machine credentials.
          </p>
        </Panel>
      </div>
      <Panel
        title="A shared vocabulary"
        subtitle="The definitions used by the reporting API"
      >
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
