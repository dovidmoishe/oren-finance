"use client";

import { useEffect, useMemo, useState } from "react";
import { BotIcon, Clock3Icon, RefreshCwIcon, SparklesIcon, WalletIcon } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState, cn, formatDateTime } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import {
  accountValue,
  combinedValue,
  errorLabel,
  formatUsdc,
  isQuietRound,
  observationOutcome,
  paperFills,
  sourceLabel,
  usdc,
  type ObservationTone,
} from "@/lib/paper-lab";
import { ApiError, apiRequest } from "@/services/api-client";
import type {
  PaperBenchmarkReport,
  PaperLabAccount,
  PaperLabAsset,
  PaperLabObservation,
  PaperLabRound,
} from "@/types/paper-lab";

// Reviews run hourly and the report carries every journal, so a slow refresh is enough.
const REFRESH_MS = 5 * 60_000;
const PAGE_SIZE = 48;

const toneClass: Record<ObservationTone, string> = {
  positive: "border-success-border bg-success-surface text-success",
  negative: "border-error-border bg-error-surface text-error",
  warning: "border-warning-border bg-warning-surface text-warning",
  muted: "border-border bg-panel-subtle text-muted",
  neutral: "border-border bg-panel text-foreground",
};

function Pill({ tone = "muted", children }: { tone?: ObservationTone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", toneClass[tone])}>
      {children}
    </span>
  );
}

function logoSource(url: string) {
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`;
  return url.startsWith("//") ? `https:${url}` : url;
}

export function AssetLogo({ id, asset, size = 24 }: { id: string; asset?: PaperLabAsset; size?: number }) {
  const [failed, setFailed] = useState(false);
  const ticker = asset?.ticker ?? id;
  if (asset?.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${asset.name} logo`}
        className="shrink-0 rounded-full bg-asset-surface object-contain"
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        src={logoSource(asset.logo)}
        width={size}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-panel-subtle text-[10px] font-semibold uppercase text-muted"
      style={{ width: size, height: size }}
    >
      {ticker.replace(/^stock-/, "").slice(0, 2)}
    </span>
  );
}

function agentName(accountId: string) {
  if (/(^|-)rules$/.test(accountId)) return "Rules baseline";
  const match = /(?:^|-)trader-(\d+)$/.exec(accountId);
  return match ? `Trader ${match[1]}` : accountId;
}

function traderSummary(accounts: PaperLabAccount[]) {
  const baselines = accounts.filter((a) => a.policy === "rules").length;
  const agents = accounts.length - baselines;
  const label = `${agents} AI agent${agents === 1 ? "" : "s"}`;
  return baselines ? `${label} and ${baselines} rules baseline${baselines === 1 ? "" : "s"}` : label;
}

function signedUsdc(value: number | null, locale: string) {
  if (value === null) return "Unknown";
  const body = formatUsdc(Math.abs(value), locale);
  return value < 0 ? `−${body}` : `+${body}`;
}

function percent(value: number, base: number, locale: string) {
  const pct = base ? (value / base) * 100 : 0;
  const body = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(pct));
  return `${pct < 0 ? "−" : "+"}${body}%`;
}

function SummaryTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 font-money text-lg font-semibold tabular-nums", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

function latestMarks(account: PaperLabAccount) {
  const marks = new Map<string, number | null>();
  for (const obs of account.rounds.at(-1)?.observations ?? []) marks.set(obs.asset, usdc(obs.mark));
  return marks;
}

function AgentCard({
  account,
  assets,
  locale,
  onSelect,
  selected,
  startingUsdc,
}: {
  account: PaperLabAccount;
  assets: Record<string, PaperLabAsset>;
  locale: string;
  onSelect: (id: string) => void;
  selected: boolean;
  startingUsdc: number;
}) {
  const value = accountValue(account);
  const change = value === null ? null : value - startingUsdc;
  const holdings = Object.keys(account.book.positions);
  const marks = latestMarks(account);
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus",
        selected ? "border-foreground bg-panel-subtle" : "border-border bg-panel",
      )}
      onClick={() => onSelect(account.accountId)}
      type="button"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BotIcon aria-hidden="true" className="text-muted" size={16} strokeWidth={1.8} />
          {agentName(account.accountId)}
        </span>
        <Pill tone={account.status === "observing" ? "positive" : "muted"}>{account.status}</Pill>
      </span>
      <span>
        <span className="block font-money text-lg font-semibold tabular-nums">{formatUsdc(value, locale)}</span>
        {change === null ? (
          <span className="block text-xs text-warning">A holding has no exit quote</span>
        ) : (
          <span className={cn("block text-xs tabular-nums", change < 0 ? "text-negative" : "text-positive")}>
            {signedUsdc(change, locale)} ({percent(change, startingUsdc, locale)})
          </span>
        )}
      </span>
      <span className="grid grid-cols-2 gap-2 text-xs">
        <span>
          <span className="block text-muted">Cash</span>
          <span className="font-money tabular-nums">{formatUsdc(usdc(account.book.cash), locale)}</span>
        </span>
        <span>
          <span className="block text-muted">Max drawdown</span>
          <span className="tabular-nums">
            {account.observedDrawdownPct === null ? "None yet" : `${account.observedDrawdownPct.toFixed(2)}%`}
          </span>
        </span>
      </span>
      <span className="flex min-h-7 flex-wrap items-center gap-1.5 text-xs">
        {holdings.length ? (
          holdings.map((id) => (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-panel px-1.5 py-0.5" key={id}>
              <AssetLogo asset={assets[id]} id={id} size={16} />
              {assets[id]?.ticker ?? id}
              {marks.get(id) != null ? <span className="font-money text-muted tabular-nums">{formatUsdc(marks.get(id) ?? null, locale)}</span> : null}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 text-muted">
            <WalletIcon aria-hidden="true" size={14} strokeWidth={1.8} />
            All cash
          </span>
        )}
      </span>
      {account.lastError ? <span className="text-xs text-warning">{errorLabel(account.lastError)}</span> : null}
    </button>
  );
}

function fillAmount(obs: PaperLabObservation, locale: string) {
  if (obs.filled && obs.signal === "buy") return `Spent ${formatUsdc(usdc(obs.terms?.input), locale)}`;
  if (obs.filled && obs.signal === "sell") return `Sale quoted at ${formatUsdc(usdc(obs.terms?.quotedOutput), locale)}`;
  const mark = usdc(obs.mark);
  return mark ? `Marked ${formatUsdc(mark, locale)}` : null;
}

function ObservationRow({ obs, assets, locale }: { obs: PaperLabObservation; assets: Record<string, PaperLabAsset>; locale: string }) {
  const asset = assets[obs.asset];
  const outcome = observationOutcome(obs);
  const source = sourceLabel(obs.source);
  const amount = fillAmount(obs, locale);
  const research = obs.research;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AssetLogo asset={asset} id={obs.asset} />
        <span className="text-sm font-semibold">{asset?.ticker ?? obs.asset}</span>
        {asset?.name ? <span className="min-w-0 truncate text-xs text-muted">{asset.name}</span> : null}
        <Pill tone={outcome.tone}>{outcome.label}</Pill>
        {source ? <Pill>{source}</Pill> : null}
        {amount ? <span className="font-money text-xs tabular-nums">{amount}</span> : null}
      </div>
      {research?.rationale ? (
        <p className="flex gap-1.5 text-xs leading-relaxed text-muted">
          <SparklesIcon aria-hidden="true" className="mt-0.5 shrink-0" size={12} strokeWidth={1.8} />
          <span>{research.rationale}</span>
        </p>
      ) : null}
      {research?.tools?.length ? (
        <p className="text-[11px] text-muted-2">
          Checked {research.tools.join(", ")}
          {research.model ? ` · ${research.model}` : ""}
        </p>
      ) : null}
    </li>
  );
}

function JournalRound({
  round,
  assets,
  locale,
  timeZone,
}: {
  round: PaperLabRound;
  assets: Record<string, PaperLabAsset>;
  locale: string;
  timeZone: string;
}) {
  const observations = round.observations ?? [];
  return (
    <article className="rounded-xl border border-border bg-panel p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-baseline gap-2 text-sm font-semibold">
          Review {round.epoch}
          <span className="text-xs font-normal text-muted">{formatDateTime(round.at, locale, timeZone)}</span>
        </p>
        <span className="flex items-center gap-2 text-xs">
          {round.method ? <Pill>{round.method}</Pill> : null}
          <span className="font-money tabular-nums">{formatUsdc(usdc(round.equityRaw), locale)}</span>
        </span>
      </header>
      {round.candidates?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>Watchlist</span>
          {round.candidates.map((id) => (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-foreground" key={id}>
              <AssetLogo asset={assets[id]} id={id} size={16} />
              {assets[id]?.ticker ?? id}
            </span>
          ))}
        </div>
      ) : null}
      {round.screenError ? <p className="mt-2 text-xs text-warning">The market screen failed, so the previous watchlist was kept.</p> : null}
      {round.marketSwitch === "off" ? (
        <p className="mt-2 text-xs text-muted">Market switch off: QQQ is below its 50-day average or fewer than half the stocks are trending up, so no new entries.</p>
      ) : null}
      {observations.length ? (
        <ul className="mt-2 divide-y divide-border/70">
          {observations.map((obs, index) => (
            <ObservationRow assets={assets} key={`${obs.asset}-${index}`} locale={locale} obs={obs} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">No holdings or candidates to review.</p>
      )}
    </article>
  );
}

export interface PaperLabViewProps {
  report: PaperBenchmarkReport;
  locale: string;
  timeZone: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hideQuiet: boolean;
  onHideQuietChange: (hide: boolean) => void;
  limit: number;
  onShowMore: () => void;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function PaperLabView({
  report,
  locale,
  timeZone,
  selectedId,
  onSelect,
  hideQuiet,
  onHideQuietChange,
  limit,
  onShowMore,
  updatedAt,
  refreshing,
  onRefresh,
}: PaperLabViewProps) {
  const assets = report.assets ?? {};
  const total = combinedValue(report);
  const fills = paperFills(report.accounts);
  const buys = fills.filter((f) => f.side === "buy").length;
  const holdings = report.accounts.flatMap((a) => Object.keys(a.book.positions));
  const selected = report.accounts.find((a) => a.accountId === selectedId) ?? report.accounts[0];
  const rounds = selected ? [...selected.rounds].reverse() : [];
  const visible = hideQuiet ? rounds.filter((round) => !isQuietRound(round)) : rounds;
  const nextReview = report.accounts.map((a) => a.nextCheckAt).filter(Boolean).sort()[0] ?? null;
  const latestScan = report.coverage.at(-1);
  const when = (value: string | number | null | undefined) => formatDateTime(value ?? undefined, locale, timeZone, "Not set");

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Paper traders</h1>
          <p className="mt-1 text-sm text-muted">
            {traderSummary(report.accounts)} trading test USDC · experiment {report.experiment} · {report.status}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {updatedAt ? <span>Updated {when(updatedAt)}</span> : null}
          <Button disabled={refreshing} onClick={onRefresh} size="sm" variant="secondary">
            <RefreshCwIcon aria-hidden="true" className={cn(refreshing && "motion-safe:animate-spin")} size={14} strokeWidth={1.8} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
        <SummaryTile
          detail={`Started with ${formatUsdc(report.totalStartingUsdc, locale)}`}
          label="Combined value"
          value={total.value === null ? `${total.unknownAccounts} account(s) unpriced` : formatUsdc(total.value, locale)}
        />
        <SummaryTile
          detail={total.change === null ? undefined : percent(total.change, report.totalStartingUsdc, locale)}
          label="Change"
          tone={total.change === null ? undefined : total.change < 0 ? "negative" : "positive"}
          value={signedUsdc(total.change, locale)}
        />
        <SummaryTile
          detail={holdings.length ? holdings.map((id) => assets[id]?.ticker ?? id).join(", ") : "Every agent is in cash"}
          label="Open holdings"
          value={String(holdings.length)}
        />
        <SummaryTile
          detail={fills[0] ? `Latest: ${agentName(fills[0].accountId)} ${fills[0].side === "buy" ? "bought" : "sold"} ${assets[fills[0].asset]?.ticker ?? fills[0].asset}` : "None yet"}
          label="Simulated fills"
          value={`${buys} buys · ${fills.length - buys} sells`}
        />
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Clock3Icon aria-hidden="true" size={13} strokeWidth={1.8} />
          Next review {when(nextReview)}
        </span>
        <span>
          Runs {when(report.startedAt)} to {when(report.endsAt)}
        </span>
        {latestScan ? (
          <span>
            Latest market scan: {latestScan.count} assets at {when(latestScan.at)}
          </span>
        ) : null}
        {report.deployedCommit ? <span>Commit {report.deployedCommit.slice(0, 7)}</span> : null}
        {report.pollError ? <span className="text-warning">Worker: {errorLabel(report.pollError)}</span> : null}
      </p>

      <div className="grid gap-3 @lg:grid-cols-3 @5xl:grid-cols-5">
        {report.accounts.map((account) => (
          <AgentCard
            account={account}
            assets={assets}
            key={account.accountId}
            locale={locale}
            onSelect={onSelect}
            selected={account.accountId === selected?.accountId}
            startingUsdc={report.startingUsdcPerAccount}
          />
        ))}
      </div>

      {selected ? (
        <section aria-label={`${agentName(selected.accountId)} journal`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{agentName(selected.accountId)} journal</h2>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                checked={hideQuiet}
                className="size-4 accent-foreground"
                onChange={(event) => onHideQuietChange(event.target.checked)}
                type="checkbox"
              />
              Hide reviews with only closed-market or repeated candles
            </label>
          </div>
          {visible.length ? (
            <>
              {visible.slice(0, limit).map((round) => (
                <JournalRound assets={assets} key={`${round.epoch}-${round.at}`} locale={locale} round={round} timeZone={timeZone} />
              ))}
              <p className="text-xs text-muted">
                Showing {Math.min(limit, visible.length)} of {visible.length} reviews
                {hideQuiet ? ` (${rounds.length - visible.length} quiet reviews hidden)` : ""}
              </p>
              {visible.length > limit ? (
                <Button onClick={onShowMore} size="sm" variant="secondary">
                  Show older reviews
                </Button>
              ) : null}
            </>
          ) : (
            <EmptyState description="Every review so far was a closed market or a repeated candle." title="Nothing to read yet" />
          )}
        </section>
      ) : null}
    </div>
  );
}

function failureOf(cause: unknown) {
  return {
    status: cause instanceof ApiError ? cause.status : undefined,
    message: cause instanceof Error ? cause.message : "Request failed",
  };
}

export function PaperLab() {
  const { locale } = useI18n();
  const [report, setReport] = useState<PaperBenchmarkReport | null>(null);
  const [failure, setFailure] = useState<{ status?: number; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideQuiet, setHideQuiet] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Data loads only in the browser, so times use the viewer's own time zone.
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  // A manual refresh bumps reloadKey, which fetches now and restarts the timer.
  useEffect(() => {
    const controller = new AbortController();
    const fetchReport = () =>
      apiRequest<PaperBenchmarkReport>("paper/benchmark", { cache: "no-store", signal: controller.signal })
        .then((next) => {
          setReport(next);
          setFailure(null);
          setUpdatedAt(Date.now());
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setFailure(failureOf(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setRefreshing(false);
        });
    void fetchReport();
    const timer = setInterval(() => void fetchReport(), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reloadKey]);

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  };

  if (!report) {
    if (failure?.status === 404)
      return <EmptyState description="This preview is not running the paper trading benchmark." title="No paper traders here" />;
    if (failure) return <ErrorState description={failure.message} onRetry={refresh} title="Couldn't load the paper traders" />;
    return <LoadingState label="Loading paper traders…" />;
  }

  return (
    <>
      {failure ? <ErrorState description={failure.message} onRetry={refresh} title="Refresh failed; showing the last report" /> : null}
      <PaperLabView
        hideQuiet={hideQuiet}
        limit={limit}
        locale={locale}
        onHideQuietChange={setHideQuiet}
        onRefresh={refresh}
        onSelect={(id) => {
          setSelectedId(id);
          setLimit(PAGE_SIZE);
        }}
        onShowMore={() => setLimit((value) => value + PAGE_SIZE)}
        refreshing={refreshing}
        report={report}
        selectedId={selectedId}
        timeZone={timeZone}
        updatedAt={updatedAt}
      />
    </>
  );
}
