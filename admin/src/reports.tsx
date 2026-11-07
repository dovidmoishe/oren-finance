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
          <div className="welcome-options">
            {session && hasPermission(session, "dashboard.access") && (
              <>
                <Link className="welcome-link" to="/users">
                  Connected accounts
                  <Icon icon={icons.arrow} />
                </Link>
                <Link className="welcome-link" to="/trades">
                  Trade activity
                  <Icon icon={icons.arrow} />
                </Link>
              </>
            )}
            {session?.isMaster && (
              <Link className="welcome-link" to="/accounts">
                Manage team access
                <Icon icon={icons.arrow} />
              </Link>
            )}
          </div>
          <p className="panel-note">
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
      <div className={`metric-grid ${overview ? "overview-metrics" : ""}`}>
        <Metric
          label="Pageviews"
          value={formatCount(traffic.pageviews)}
          note="Complete, closed days in this range"
          tone="mint"
        />
        <Metric
          label="New durable visitors"
          value={formatCount(traffic.distinctDurableVisitorsFirstSeenInRange)}
          note="First seen in range · visitor IDs, not people"
          tone="lavender"
        />
        {!overview && (
          <>
            <Metric
              label="Complete days"
              value={`${complete} / ${traffic.daily.length}`}
              note="Missing days are never counted as zero"
              tone="peach"
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
        <div className="notice error" role="alert">
          {exportError}
        </div>
      )}
      <Panel
        title="Pageviews"
        subtitle="Accepted pageviews, day by day"
        action={
          <button
            className="button"
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
            Collection may not have started for this range. Check data coverage
            or select different dates.
          </Empty>
        )}
        <div className="chart-caption">
          <span>
            <span className="legend-dot" />
            Pageviews
          </span>
          <span>Gaps and partial days are shown separately</span>
        </div>
      </Panel>
      {overview ? (
        <OverviewActivity />
      ) : (
        <Panel
          title="Daily observations"
          subtitle="Original status and provenance stay with every number"
        >
          <div className="table-scroll">
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
                    <td className="numeric">{formatCount(day)}</td>
                    <td className="numeric">
                      {traffic.dailyUniques.days
                        .find((item) => item.day === day.day)
                        ?.value.toLocaleString() ?? "Unavailable"}
                    </td>
                    <td>
                      <Status value={day.status} />
                      {day.reason && (
                        <span className="cell-note">
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
          <p className="panel-note">
            Daily unique counts describe each day individually. They are never
            summed into lifetime visitors.
          </p>
        </Panel>
      )}
    </>
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
    <div className="traffic-chart" ref={container}>
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
            stroke="#222222"
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
              fill={day.status === "partial" ? "#888888" : "#222222"}
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
      <Panel
        title="Activity"
        subtitle="UTC date range · stages describe distinct actions"
        action={
          <Link className="text-link" to="/funnel">
            Explore funnel
            <Icon icon={icons.arrow} size={14} />
          </Link>
        }
      >
        {slice ? (
          <div className="mini-funnel">
            {[
              { label: "Setup sessions", value: slice.setupSessions },
              { label: "Connected accounts", value: slice.connectedAccounts },
              {
                label: "In-app research accounts",
                value: slice.researchAccounts,
              },
            ].map((item, index) => (
              <div className="mini-funnel-row" key={item.label}>
                <span className="stage-number">0{index + 1}</span>
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No funnel activity yet" />
        )}
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
        <label>
          <span className="sr-only">Group funnel</span>
          <select
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
                label: "MCP stock context",
                value: slice.mcpStockContext.accounts,
                note: `${slice.mcpStockContext.calls} get_stock calls`,
              },
            ];
            const max = Math.max(1, ...stages.map((item) => item.value));
            return (
              <div className="funnel-group" key={slice.key}>
                {grouping !== "none" && <h3>{slice.key}</h3>}
                {stages.map((item, index) => (
                  <div className="funnel-stage" key={item.label}>
                    <span className="stage-number">0{index + 1}</span>
                    <div className="stage-content">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.note}</span>
                      </div>
                      <div className="bar-track">
                        <div
                          style={{ width: `${(item.value / max) * 100}%` }}
                        />
                      </div>
                    </div>
                    <strong className="stage-value">
                      {item.value.toLocaleString()}
                    </strong>
                  </div>
                ))}
                <div className="outcome-row">
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
          <p className="panel-note">
            These stages aren’t a single attributed conversion cohort. In-app
            research and MCP stock context are separate channels. MCP research
            activation is unavailable because there is no MCP research-report
            tool. Distinct counts across groups are not additive.
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
      <div className="retention-number">
        {value.value == null ||
        value.status === "unavailable" ||
        !value.denominator
          ? "Unavailable"
          : percent((value.retained ?? value.value) / value.denominator)}
      </div>
      <div className="retention-details">
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
      {value.reason && <p className="panel-note">{readable(value.reason)}</p>}
    </Panel>
  );
  return (
    <>
      <div className="two-column">
        {renderWindow(query.data.researchRetention7d, 7)}
        {renderWindow(query.data.researchRetention30d, 30)}
      </div>
      <div className="notice">
        <Icon icon={icons.refresh} />
        <div>
          <strong>Give cohorts time to mature</strong>
          <p>
            Only accounts whose full follow-up window has elapsed enter the
            denominator. The current API includes activity within the selected
            date range; returns after its end aren’t included. These are
            in-range research cohorts, not lifetime first-research cohorts.
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
        <label>
          <span className="sr-only">Comparison dimension</span>
          <select
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
          <div className="table-scroll">
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
                    <td className="strong">{row.key}</td>
                    <td className="numeric">
                      {query.data.denominator === "pageviews"
                        ? row.sampleSize.toLocaleString()
                        : "Unavailable"}
                    </td>
                    <td className="numeric">{row.connections}</td>
                    <td className="numeric">{row.researchAccounts}</td>
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
          <p className="panel-note">
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
      <div className="metric-grid">
        <Metric
          label="Raw observations"
          value={`${coverage.rawRetentionDays} days`}
          note="Rolling raw-data retention"
          tone="mint"
        />
        <Metric
          label="Identity keys"
          value={`${coverage.identityRetentionDays} days`}
          note="Distinct counts depend on retained keys"
          tone="lavender"
        />
        <Metric
          label="Attribution"
          value={readable(coverage.attribution.model)}
          note={`${coverage.attribution.windowDays}-day attribution window`}
          tone="peach"
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
          <div className="table-scroll">
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
      <div className="two-column">
        <Panel
          title="External series"
          subtitle="Unavailable until independently supplied"
        >
          <div className="integration-list">
            {["X / social activity", "Revenue & costs", "Token holders"].map(
              (name) => (
                <div key={name}>
                  <span>{name}</span>
                  <Badge>Unavailable</Badge>
                </div>
              ),
            )}
          </div>
          <p className="panel-note">
            No external sync is enabled. Historical observations stay separate
            from live telemetry.
          </p>
        </Panel>
        <Panel
          title="History & provenance"
          subtitle="Recovered records keep their original limitations"
        >
          <p className="prose">
            Historical imports are manual operator actions. Missing days remain
            unavailable. Point-in-time snapshots are not daily deltas and are
            never added to live trade counts.
          </p>
          <p className="panel-note">
            This workspace does not import history or issue machine credentials.
          </p>
        </Panel>
      </div>
      <Panel
        title="A shared vocabulary"
        subtitle="The definitions used by the reporting API"
      >
        <dl className="definitions">
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
