import {
  button,
  metricGrid,
  tableScroll,
  panelNote,
} from "./control-styles";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  ArrowLeft,
  ArrowRight,
  Users,
  Link2,
  Activity,
  ScrollText,
  Monitor,
  Bot,
  CircleCheck,
  UserCheck,
  RefreshCw,
} from "lucide-react";
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
const titles: Record<View, { title: string; icon: LucideIcon }> = {
  users: { title: "Accounts with MCP connections", icon: Users },
  connections: { title: "Recorded client connections", icon: Link2 },
  trades: { title: "Recent agent trade intents", icon: Activity },
  audit: { title: "Admin audit history", icon: ScrollText },
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
        title={titles[view].title}
        subtitle="Read-only · newest records first"
        icon={titles[view].icon}
        action={
          <button
            className={button}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <Icon icon={RefreshCw} size={15} />
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 text-xs text-muted">
          <label className="flex h-9 w-full max-w-72 items-center gap-2 rounded-lg border border-border bg-surface px-3 shadow-xs pointer-coarse:h-11">
            <Icon icon={Search} size={15} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted"
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
          <ErrorState
            className="mx-5 mb-5"
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <Empty
            title={search ? "No matches on this page" : "No records yet"}
            icon={search ? Search : titles[view].icon}
          >
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
              <span>Page {page}</span>
              <div className="flex gap-2">
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
            {view === "users" && (
              <p className={panelNote}>Accounts that connected an agent.</p>
            )}
            {view === "connections" && (
              <p className={panelNote}>
                An unrevoked connection can still expire.
              </p>
            )}
            {view === "trades" && (
              <p className={panelNote}>
                Agent trade requests and their latest status.
              </p>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function Identifier({ value }: { value: string | null }) {
  return (
    <span
      className="inline-block max-w-56 truncate rounded-md bg-panel px-1.5 py-0.5 align-middle font-mono text-[11px] text-muted"
      title={value ?? undefined}
    >
      {shortId(value)}
    </span>
  );
}
function Secondary({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      className="mt-1 block max-w-60 truncate text-[11px] text-muted"
      title={title}
    >
      {children}
    </span>
  );
}
function cells(view: View, row: Row): ReactNode[] {
  if (view === "users") {
    const user = row as UserRow;
    return [
      <Identifier value={user.userId} />,
      <span className="tabular-nums">{user.connections}</span>,
      <span className="tabular-nums">{user.activeConnections}</span>,
      <DateTime value={user.firstConnectedAt} />,
      <DateTime value={user.lastConnectedAt} />,
    ];
  }
  if (view === "connections") {
    const connection = row as ConnectionRow;
    return [
      <>
        <Identifier value={connection.clientId} />
        <Secondary title={connection.grantId}>
          {shortId(connection.grantId)}
        </Secondary>
      </>,
      <>
        <Identifier value={connection.userId} />
        <Secondary title={connection.wallet}>
          Wallet {shortId(connection.wallet)}
        </Secondary>
      </>,
      <div className="flex flex-wrap gap-1">
        {connection.scopes
          .split(" ")
          .filter(Boolean)
          .map((scope) => (
            <Badge key={scope}>{scope}</Badge>
          ))}
      </div>,
      <Badge tone={connection.revokedAt ? "red" : "green"} dot>
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
        <Secondary title={trade.id}>{shortId(trade.id)}</Secondary>
      </>,
      <Identifier value={trade.userId} />,
      <span className="capitalize">{trade.side}</span>,
      <span className="tabular-nums">
        {trade.side === "sell"
          ? trade.amountShares != null
            ? `${trade.amountShares} shares`
            : missingValue
          : trade.amountUsd != null
            ? new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(Number(trade.amountUsd))
            : missingValue}
      </span>,
      <Badge tone="brand">{trade.mode}</Badge>,
      <>
        <Status value={trade.status} />
        {trade.status === "prepared" &&
          new Date(trade.expiresAt).getTime() < Date.now() && (
            <Secondary>Quote expired</Secondary>
          )}
      </>,
      <DateTime value={trade.createdAt} />,
    ];
  }
  const audit = row as AuditRow;
  return [
    <span className="font-medium capitalize">{readable(audit.action)}</span>,
    <Identifier value={audit.actorId} />,
    <Identifier value={audit.targetId} />,
    <DateTime value={audit.createdAt} />,
  ];
}

function TradeSummary() {
  const query = useReportQuery<Funnel>("funnel");
  const dimmed = query.isPlaceholderData;
  return (
    <>
      <DateFilters utcOnly />
      {query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className={metricGrid}>
          <Metric
            label="Browser preparations"
            icon={Monitor}
            tone="blue"
            value={query.data?.trades.preparations.browser.toLocaleString("en-US") ?? missingValue}
            note="Agent intents in these UTC dates"
            loading={query.isPending}
            dimmed={dimmed}
          />
          <Metric
            label="Delegated preparations"
            icon={Bot}
            tone="violet"
            value={query.data?.trades.preparations.delegated.toLocaleString("en-US") ?? missingValue}
            note="Agent intents in these UTC dates"
            loading={query.isPending}
            dimmed={dimmed}
          />
          <Metric
            label="Confirmed intents"
            icon={CircleCheck}
            tone="green"
            value={
              query.data
                ? (
                    query.data.trades.confirmed.browser +
                    query.data.trades.confirmed.delegated
                  ).toLocaleString("en-US")
                : missingValue
            }
            loading={query.isPending}
            dimmed={dimmed}
          />
          <Metric
            label="Activated accounts"
            icon={UserCheck}
            tone="orange"
            value={
              query.data?.trades.uniqueActivatedAccounts.toLocaleString("en-US") ??
              missingValue
            }
            loading={query.isPending}
            dimmed={dimmed}
          />
        </div>
      )}
      <p className="-mt-1 text-xs text-muted">
        Date filters apply to the summary. The paginated intent list below shows
        all dates.
      </p>
    </>
  );
}
