"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import {
  getStockResearch,
  recordResearchSourceOpen,
} from "@/services/research-service";
import type {
  CompanyCitationView,
  CompanyMetricView,
  CompanyPeriodView,
  CompanyResearchData,
  StockResearch,
} from "@/types";

export function StockResearchPanel({ assetId }: { assetId: string }) {
  const auth = useOrenAuth();
  const [loadedReport, setReport] = useState<StockResearch>();
  const [reportWallet, setReportWallet] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const wallet = auth.address;
  const report =
    wallet && reportWallet === wallet && loadedReport?.assetId === assetId
      ? loadedReport
      : undefined;
  const bullishView = report?.opinions.data?.items.find(
    (item) =>
      item.stance === "BULLISH" && item.action?.toUpperCase() !== "EXIT",
  );
  const bearishView = report?.opinions.data?.items.find(
    (item) =>
      item.stance === "BEARISH" &&
      item.action?.toUpperCase() !== "EXIT" &&
      item.author.toLowerCase() !== bullishView?.author.toLowerCase(),
  );
  const getAccessToken = auth.getAccessToken;

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const current = ++requestId.current;
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to load research.");
      const next = await getStockResearch(assetId, wallet, token);
      if (current !== requestId.current) return;
      setReport(next);
      setReportWallet(wallet);
    } catch (cause) {
      if (current === requestId.current)
        setError(
          cause instanceof Error ? cause.message : "Research is unavailable.",
        );
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [assetId, wallet, getAccessToken]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const activeRequestId = requestId;
    return () => {
      clearTimeout(timer);
      activeRequestId.current++;
    };
  }, [refresh]);

  const recordSource = () => {
    if (!wallet) return;
    void getAccessToken()
      .then((token) =>
        token ? recordResearchSourceOpen(assetId, wallet, token) : undefined,
      )
      .catch(() => undefined);
  };

  return (
    <section
      aria-labelledby="stock-research-title"
      className="rounded-[20px] border border-border bg-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="stock-research-title"
            className="font-display text-lg font-semibold"
          >
            Research desk
          </h2>
          <p className="mt-1 text-xs text-muted">
            Market data and cited views in one place.
          </p>
        </div>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-panel-subtle disabled:opacity-50"
          disabled={loading || !wallet}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? "Refreshing…" : "Refresh research"}
        </button>
      </div>
      {!wallet ? (
        <p className="mt-5 text-sm text-muted">
          Sign in to see portfolio-aware research.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border bg-panel-subtle p-4">
            <h3 className="text-sm font-semibold">Oren read</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.analysis.data?.summary ??
                "Market analysis is temporarily unavailable."}
            </p>
            {report.analysis.data ? (
              <p className="mt-3 text-xs text-muted">
                Deterministic Oren Score:{" "}
                {Math.round(report.analysis.data.opportunityScore)} / 100 ·
                Observed {dateLabel(report.analysis.observedAt)}
              </p>
            ) : null}
            {report.news.available &&
            report.news.data?.some(
              (item) =>
                item.url?.startsWith("https://") &&
                Number.isFinite(Date.parse(item.publishedAt)),
            ) ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium">Recent cited news</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {report.news.data
                    .filter(
                      (item) =>
                        item.url?.startsWith("https://") &&
                        Number.isFinite(Date.parse(item.publishedAt)),
                    )
                    .slice(0, 3)
                    .map((item) => (
                    <li key={item.url}>
                      <a
                        className="underline-offset-2 hover:underline"
                        href={item.url}
                        onClick={recordSource}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {item.headline}
                      </a>
                      <span className="ml-1 text-muted">
                        · {dateLabel(item.publishedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.portfolio.available ? (
              <p className="mt-2 text-xs text-muted">
                Your exposure:{" "}
                {report.portfolio.data
                  ? `${report.portfolio.data.allocationPercent.toFixed(1)}% of portfolio`
                  : "No current position"}
              </p>
            ) : null}
          </article>
          <article className="rounded-2xl border border-border bg-panel-subtle p-4">
            <h3 className="text-sm font-semibold">Writer views</h3>
            {!report.opinions.available ? (
              <p className="mt-2 text-sm text-muted">
                {report.opinions.reason === "not_enabled"
                  ? "Writer opinions are not enabled for this signed-in view."
                  : "Writer opinions could not be loaded for this research view."}
              </p>
            ) : null}
            {report.opinions.data ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  {report.opinions.data.distinctAuthors} distinct writers ·{" "}
                  {report.opinions.data.mentionCount} mentions ·{" "}
                  {report.opinions.data.coverage} coverage · Observed{" "}
                  {dateLabel(report.opinions.observedAt)}
                </p>
                {report.opinions.data.window ? (
                  <p className="mt-1 text-xs text-muted">
                    Covered {dateLabel(report.opinions.data.window.from)}–
                    {dateLabel(report.opinions.data.window.to)}
                  </p>
                ) : null}
                <div className="mt-3 space-y-3">
                  {report.opinions.data.items.slice(0, 4).map((item) => (
                    <div
                      className="border-t border-border pt-3"
                      key={`${item.author}-${item.url}`}
                    >
                      <a
                        className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
                        href={item.url}
                        onClick={recordSource}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {item.linkLabel ?? item.author}
                        {item.sourceLabel ? (
                          <span className="font-normal text-muted"> · {item.sourceLabel}</span>
                        ) : (
                          <span className="font-normal text-muted"> · {item.source}</span>
                        )}
                      </a>
                      <p className="mt-1 text-xs text-muted">
                        {item.stance ?? "Unstated"}
                        {item.action ? ` · ${item.action}` : ""} ·{" "}
                        {dateLabel(item.date)}
                      </p>
                      <p className="mt-1 text-sm leading-5">{item.summary}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </article>
          {report.company ? (
            <CompanyFilings
              company={report.company}
              onOpenSource={recordSource}
            />
          ) : null}
          <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold">Where they disagree</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.opinions.data?.disagreement
                ? "Distinct writers have both bullish and bearish views. Read the sources before drawing a conclusion."
                : report.opinions.data?.coverage === "current"
                  ? "No opposing writer stances appear in the covered sample. This is not market consensus."
                  : "Coverage is too limited for a useful agreement read."}
            </p>
            {report.opinions.data?.disagreement &&
            bullishView &&
            bearishView ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs leading-5">
                <p>
                  <a
                    className="font-medium hover:underline"
                    href={bullishView.url}
                    onClick={recordSource}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {bullishView.author}
                  </a>
                  : {bullishView.summary}
                </p>
                <p>
                  <a
                    className="font-medium hover:underline"
                    href={bearishView.url}
                    onClick={recordSource}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {bearishView.author}
                  </a>
                  : {bearishView.summary}
                </p>
              </div>
            ) : null}
          </article>
          {/* Thesis posting stays off the desk. saveStockThesis remains on the API for a later pass. */}
        </div>
      ) : loading ? (
        <p className="mt-5 text-sm text-muted">Loading research…</p>
      ) : null}
    </section>
  );
}

function dateLabel(value?: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (dateOnly) {
    const date = new Date(
      Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
    );
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "time unavailable";
}

const FILING_LINK_CLASS =
  "font-medium text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
const SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/";
const COMPANY_DISCLAIMER =
  "Filing facts, not the Oren Score, not a recommendation.";

function CompanyFilings({
  company,
  onOpenSource,
}: {
  company: NonNullable<StockResearch["company"]>;
  onOpenSource: () => void;
}) {
  const data = company.data;
  const cards = data ? companyCards(data) : [];
  const filings = sourceFilings(data);
  return (
    <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
      <h3 className="text-sm font-semibold">Company filings</h3>
      <p className="mt-2 text-xs text-muted">{COMPANY_DISCLAIMER}</p>
      {company.reason ? (
        <p className="mt-2 text-sm text-muted">{companyReason(company.reason)}</p>
      ) : null}
      {cards.length ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {cards.map((card) => (
            <section
              className="rounded-xl border border-border bg-panel p-3"
              key={card.key}
            >
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {card.title}
              </h4>
              <p className="mt-1 text-sm font-semibold">{card.period}</p>
              <p className="text-[11px] text-muted">{card.range}</p>
              <dl className="mt-3 space-y-2">
                <MetricFact
                  label="Revenue"
                  metric={card.revenue}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label="Net income"
                  metric={card.netIncome}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label="Operating margin"
                  metric={card.margin}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label="YoY"
                  metric={card.yoy}
                  note={card.yoyNote}
                  onOpenSource={onOpenSource}
                />
              </dl>
            </section>
          ))}
        </div>
      ) : data?.briefing.length ? (
        <div className="mt-3 space-y-2">
          {data.briefing
            .filter((line) => line !== COMPANY_DISCLAIMER)
            .map((line) => (
              <p className="text-sm leading-6 text-muted" key={line}>
                {line}
              </p>
            ))}
        </div>
      ) : null}
      {filings.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold">Source filings</h4>
          <ul className="mt-2 divide-y divide-border">
            {filings.map((filing) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                key={filing.key}
              >
                <span className="inline-flex rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                  {filing.form}
                </span>
                <span className="text-xs text-muted">{filing.period}</span>
                <span className="text-xs text-muted">Filed {filing.filed}</span>
                <a
                  className={`ml-auto text-xs ${FILING_LINK_CLASS}`}
                  href={filing.url}
                  onClick={onOpenSource}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View on SEC
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {company.fetchedAt ? (
        <p className="mt-2 text-xs text-muted">
          Fetched {dateLabel(company.fetchedAt)}
        </p>
      ) : null}
    </article>
  );
}

function MetricFact({
  label,
  metric,
  note,
  onOpenSource,
}: {
  label: string;
  metric?: CompanyMetricView;
  note?: string;
  onOpenSource: () => void;
}) {
  const sources = metricSources(metric);
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-right">
        <p className="text-xs font-medium tabular-nums">
          {metric?.available && metric.display ? metric.display : "Unavailable"}
          {metric?.derived && metric.available ? (
            <span className="ml-1 font-normal text-muted">derived</span>
          ) : null}
        </p>
        {note ? <p className="text-[11px] text-muted">{note}</p> : null}
        {sources.map((source) => (
          <a
            className={`mt-0.5 block text-[11px] ${FILING_LINK_CLASS}`}
            href={source.sourceUrl}
            key={source.sourceUrl}
            onClick={onOpenSource}
            rel="noopener noreferrer"
            target="_blank"
          >
            {source.form} filed {dateLabel(source.filed)}
          </a>
        ))}
      </dd>
    </div>
  );
}

function companyCards(data: CompanyResearchData): Array<{
  key: string;
  title: string;
  period: string;
  range: string;
  revenue?: CompanyMetricView;
  netIncome?: CompanyMetricView;
  margin?: CompanyMetricView;
  yoy?: CompanyMetricView;
  yoyNote?: string;
}> {
  const cards = [];
  if (data.latestQuarter) {
    const period = data.latestQuarter;
    cards.push({
      key: "quarter",
      title: "Latest quarter",
      period: fiscalLabel(period),
      range: rangeLabel(period.start, period.end),
      revenue: period.revenue,
      netIncome: period.netIncome,
      margin: period.operatingMargin,
      yoy: period.revenueGrowth,
      yoyNote: period.fiscalQuarter
        ? `vs FY${period.fiscalYear - 1} Q${period.fiscalQuarter}`
        : undefined,
    });
  }
  if (data.ttm) {
    cards.push({
      key: "ttm",
      title: "TTM",
      period: "Trailing twelve months",
      range:
        data.ttm.start && data.ttm.end
          ? rangeLabel(data.ttm.start, data.ttm.end)
          : "Period not stated",
      revenue: data.ttm.revenue,
      netIncome: data.ttm.netIncome,
      margin: data.ttm.operatingMargin,
      yoy: data.ttm.revenueGrowth,
      yoyNote: "vs prior trailing twelve months",
    });
  }
  if (data.latestAnnual) {
    const period = data.latestAnnual;
    cards.push({
      key: "year",
      title: "Full year",
      period: fiscalLabel(period),
      range: rangeLabel(period.start, period.end),
      revenue: period.revenue,
      netIncome: period.netIncome,
      margin: period.operatingMargin,
      yoy: period.revenueGrowth,
      yoyNote: `vs FY${period.fiscalYear - 1}`,
    });
  }
  return cards;
}

function sourceFilings(data: CompanyResearchData | undefined) {
  const rows = (data?.filings ?? [])
    .filter((filing) => filing.sourceUrl.startsWith(SEC_ARCHIVE))
    .map((filing) => ({
      key: filing.accession,
      form: filing.form,
      period: filing.reportDate
        ? `Period ended ${dateLabel(filing.reportDate)}`
        : "Period not stated",
      filed: dateLabel(filing.filed),
      filedSort: filing.filed,
      url: filing.sourceUrl,
    }));
  if (rows.length) {
    return rows.sort(
      (a, b) => b.filedSort.localeCompare(a.filedSort) || b.key.localeCompare(a.key),
    );
  }
  return (data?.links ?? [])
    .filter((link) => link.url.startsWith(SEC_ARCHIVE))
    .map((link) => ({
      key: link.url,
      form: link.label.split(" ")[0] || "Filing",
      period: "Period not stated",
      filed: "date unavailable",
      filedSort: "",
      url: link.url,
    }));
}

function metricSources(metric?: CompanyMetricView): CompanyCitationView[] {
  const items = [metric?.citation, ...(metric?.inputCitations ?? [])].filter(
    (item): item is CompanyCitationView =>
      Boolean(item?.sourceUrl?.startsWith(SEC_ARCHIVE)),
  );
  const byUrl = new Map<string, CompanyCitationView>();
  for (const item of items) {
    const existing = byUrl.get(item.sourceUrl);
    if (!existing || item.filed > existing.filed) byUrl.set(item.sourceUrl, item);
  }
  return [...byUrl.values()].sort(
    (a, b) => b.filed.localeCompare(a.filed) || a.form.localeCompare(b.form),
  );
}

function fiscalLabel(period: CompanyPeriodView) {
  return period.fiscalQuarter
    ? `FY${period.fiscalYear} Q${period.fiscalQuarter}`
    : `FY${period.fiscalYear}`;
}

function rangeLabel(start?: string, end?: string) {
  if (!start || !end) return "Period not stated";
  return `${dateLabel(start)} to ${dateLabel(end)}`;
}

function companyReason(reason: string): string {
  switch (reason) {
    case "not_mapped":
      return "Company filings are not available. Oren has not verified this token's issuer.";
    case "fund_no_statements":
      return "This is a fund or ETF. Oren does not report operating-company statements for it.";
    case "no_coverage":
      return "Company statements are not covered for this instrument.";
    case "mint_mismatch":
      return "The token mint does not match the verified issuer record, so no company figures are shown.";
    case "identity_mismatch":
      return "The live stock record does not match the verified issuer, so no company figures are shown.";
    case "ambiguous_identity":
      return "More than one issuer matches this stock, so no company figures are shown.";
    case "timeout":
      return "Company filings timed out. Other research is unchanged.";
    case "rate_limited":
      return "Company filings were rate limited. Other research is unchanged.";
    case "provider_unavailable":
      return "Company filings could not be loaded. Other research is unchanged.";
    case "stale":
      return "Company figures are shown, and the filing or cache is stale.";
    case "sec_not_configured":
      return "Company filings are not loaded until the server contact is configured.";
    case "sec_preview_disabled":
      return "Company filings are not loaded in previews.";
    case "sec_worker_unavailable":
      return "Company filings are not loaded from this server process.";
    case "not_licensed":
      return "This source is not licensed for this view.";
    default:
      return "Company filings could not be loaded.";
  }
}
