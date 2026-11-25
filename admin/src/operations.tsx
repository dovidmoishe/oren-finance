import {
  button,
  metricGrid,
  tableScroll,
  panelNote,
  field,
} from "./control-styles";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "./api";
import { missingValue, hasPermission, readable, shortId } from "./model";
import { useAuth, useReportQuery } from "./state";
import type {
  AuditRow,
  ConnectionRow,
  Funnel,
  Page,
  TradeRow,
  UserRow,
} from "./types";
import {
  Badge,
  DateFilters,
  DateTime,
  Empty,
  ErrorState,
  Icon,
  Loading,
  Metric,
  Panel,
  PermissionDenied,
  Status,
} from "./ui";

type View = "users" | "connections" | "trades" | "audit";
type Row = UserRow | ConnectionRow | TradeRow | AuditRow;
const titles = {
  users: "Accounts with MCP connections",
  connections: "Recorded client connections",
  trades: "Recent agent trade intents",
  audit: "Admin audit history",
};
const columns = {
  users: [
    "Account",
    "Connections",
    "Not revoked",
    "First connected",
    "Last connected",
  ],
  connections: ["Client / grant", "Account", "Scopes", "Status", "Connected"],
  trades: [
    "Asset / intent",
    "Account",
    "Side",
    "Amount",
    "Lane",
    "Status",
    "Prepared",
  ],
  audit: ["Action", "Actor", "Target", "Recorded"],
};

export function OperationsPage({ view }: { view: View }) {
  const { session } = useAuth();
  const allowed =
    session &&
    (view === "audit"
      ? session.isMaster
      : hasPermission(session, "dashboard.access"));
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [view]);
  const query = useQuery({
    queryKey: ["operations", view, page],
    queryFn: () => api<Page<Row>>(`dashboard/${view}?page=${page}`),
    enabled: !!allowed,
  });
  if (!allowed)
    return (
      <PermissionDenied
        permission={
          view === "audit" ? "master-admin access" : "dashboard.access"
        }
      />
    );
  const rows =
    query.data?.rows.filter((row) =>
      Object.values(row)
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
    ) ?? [];
  return (
    <>
      {view === "trades" &&
        session &&
        hasPermission(session, "reports.read") && <TradeSummary />}
      <Panel
        title={titles[view]}
        subtitle="Read-only operations · newest records first"
        action={
          <button
            className={button}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 text-xs text-muted">
          <label className="relative flex items-center gap-2 rounded-md border border-border px-2.5 text-muted [&_input]:min-h-9 [&_input]:min-w-0 [&_input]:border-0 [&_input]:px-1">
            <Icon icon={Search} size={17} />
            <input
              className={field}
              aria-label="Search this page"
              placeholder="Search this page…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
            />
          </label>
          <span>
            {query.data
              ? `${query.data.rows.length} records on page ${page}`
              : "Loading records"}
          </span>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <Empty title={search ? "No matches on this page" : "No records yet"}>
            {search
              ? "Try another search or move to another page."
              : "Recorded activity will appear here."}
          </Empty>
        ) : (
          <div className={tableScroll}>
            <table>
              <thead>
                <tr>
                  {columns[view].map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={
                      "id" in row
                        ? row.id
                        : "grantId" in row
                          ? row.grantId
                          : row.userId
                    }
                  >
                    {cells(view, row).map((cell, index) => (
                      <td key={index}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted [&>div]:flex [&>div]:gap-2">
              <span>Page {page}</span>
              <div>
                <button
                  className={button}
                  disabled={page === 1 || query.isFetching}
                  onClick={() => {
                    setPage((old) => old - 1);
                    setSearch("");
                  }}
                >
                  <Icon icon={ArrowLeft} size={15} />
                  Previous
                </button>
                <button
                  className={button}
                  disabled={!query.data.hasNext || query.isFetching}
                  onClick={() => {
                    setPage((old) => old + 1);
                    setSearch("");
                  }}
                >
                  Next
                  <Icon icon={ArrowRight} size={15} />
                </button>
              </div>
            </div>
            <p className={panelNote}>{query.data.note}</p>
          </>
        )}
      </Panel>
    </>
  );
}

function Identifier({ value }: { value: string | null }) {
  return (
    <span
      className="inline-block max-w-56 truncate align-middle font-mono text-xs text-muted"
      title={value ?? undefined}
    >
      {shortId(value)}
    </span>
  );
}
function cells(view: View, row: Row): ReactNode[] {
  if (view === "users") {
    const user = row as UserRow;
    return [
      <Identifier value={user.userId} />,
      user.connections,
      user.activeConnections,
      <DateTime value={user.firstConnectedAt} />,
      <DateTime value={user.lastConnectedAt} />,
    ];
  }
  if (view === "connections") {
    const connection = row as ConnectionRow;
    return [
      <>
        <Identifier value={connection.clientId} />
        <span
          className="mt-1 block max-w-60 truncate text-[11px] text-muted"
          title={connection.grantId}
        >
          {shortId(connection.grantId)}
        </span>
      </>,
      <>
        <Identifier value={connection.userId} />
        <span
          className="mt-1 block max-w-60 truncate text-[11px] text-muted"
          title={connection.wallet}
        >
          Wallet {shortId(connection.wallet)}
        </span>
      </>,
      <div className="flex flex-wrap gap-1">
        {connection.scopes
          .split(" ")
          .filter(Boolean)
          .map((scope) => (
            <Badge key={scope}>{scope}</Badge>
          ))}
      </div>,
      <Badge tone={connection.revokedAt ? "red" : "green"}>
        {connection.revokedAt ? "Revoked" : "Not revoked"}
      </Badge>,
      <DateTime value={connection.createdAt} />,
    ];
  }
  if (view === "trades") {
    const trade = row as TradeRow;
    return [
      <>
        <span className="font-semibold text-foreground">{trade.ticker}</span>
        <span
          className="mt-1 block max-w-60 truncate text-[11px] text-muted"
          title={trade.id}
        >
          {shortId(trade.id)}
        </span>
      </>,
      <Identifier value={trade.userId} />,
      <span className="capitalize">{trade.side}</span>,
      trade.side === "sell"
        ? trade.amountShares != null
          ? `${trade.amountShares} shares`
          : missingValue
        : trade.amountUsd != null
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(Number(trade.amountUsd))
          : missingValue,
      <Badge>{trade.mode}</Badge>,
      <>
        <Status value={trade.status} />
        {trade.status === "prepared" &&
          new Date(trade.expiresAt).getTime() < Date.now() && (
            <span className="mt-1 block max-w-60 truncate text-[11px] text-muted">
              Quote expired
            </span>
          )}
      </>,
      <DateTime value={trade.createdAt} />,
    ];
  }
  const audit = row as AuditRow;
  return [
    <span className="font-semibold capitalize">{readable(audit.action)}</span>,
    <Identifier value={audit.actorId} />,
    <Identifier value={audit.targetId} />,
    <DateTime value={audit.createdAt} />,
  ];
}

function TradeSummary() {
  const query = useReportQuery<Funnel>("funnel");
  return (
    <>
      <DateFilters utcOnly />
      {query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        query.data && (
          <div className={metricGrid}>
            <Metric
              label="Browser preparations"
              value={query.data.trades.preparations.browser.toLocaleString()}
              note="Agent intents · selected UTC date range"
            />
            <Metric
              label="Delegated preparations"
              value={query.data.trades.preparations.delegated.toLocaleString()}
              note="Agent intents · selected UTC date range"
            />
            <Metric
              label="Confirmed intents"
              value={(
                query.data.trades.confirmed.browser +
                query.data.trades.confirmed.delegated
              ).toLocaleString()}
              note="Application-confirmed browser + delegated"
            />
            <Metric
              label="Activated accounts"
              value={query.data.trades.uniqueActivatedAccounts.toLocaleString()}
              note="Distinct accounts with confirmed intents"
            />
          </div>
        )
      )}
      <p className="mb-4 text-xs text-muted">
        Date filters apply to the summary. The paginated intent list below shows
        all dates.
      </p>
    </>
  );
}
