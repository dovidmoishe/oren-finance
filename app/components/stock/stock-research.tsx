"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import {
  getStockResearch,
  recordResearchSourceOpen,
} from "@/services/research-service";
import type { StockResearch } from "@/types";
import { useT, type MessageKey, type Translate } from "@/i18n/i18n";

export function StockResearchPanel({ assetId }: { assetId: string }) {
  const auth = useOrenAuth();
  const t = useT();
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
      if (!token) throw new Error(t("research.signInToLoad"));
      const next = await getStockResearch(assetId, wallet, token);
      if (current !== requestId.current) return;
      setReport(next);
      setReportWallet(wallet);
    } catch (cause) {
      if (current === requestId.current)
        setError(
          cause instanceof Error ? cause.message : t("research.unavailable"),
        );
    } finally {
      if (current === requestId.current) setLoading(false);
    }
    // `t` only labels errors; a language change must not refetch research.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {t("research.title")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("research.subtitle")}
          </p>
        </div>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-panel-subtle disabled:opacity-50"
          disabled={loading || !wallet}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? t("research.refreshing") : t("research.refresh")}
        </button>
      </div>
      {!wallet ? (
        <p className="mt-5 text-sm text-muted">
          {t("research.signedOut")}
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
            <h3 className="text-sm font-semibold">{t("research.orenRead")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.analysis.data?.summary ??
                t("research.analysisUnavailable")}
            </p>
            {report.analysis.data ? (
              <p className="mt-3 text-xs text-muted">
                {t("research.scoreLine", {
                  score: Math.round(report.analysis.data.opportunityScore),
                  date: dateLabel(t, report.analysis.observedAt),
                })}
              </p>
            ) : null}
            {report.news.available &&
            report.news.data?.some(
              (item) =>
                item.url?.startsWith("https://") &&
                Number.isFinite(Date.parse(item.publishedAt)),
            ) ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium">{t("research.citedNews")}</p>
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
                        · {dateLabel(t, item.publishedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.portfolio.available ? (
              <p className="mt-2 text-xs text-muted">
                {t("research.exposure", {
                  value: report.portfolio.data
                    ? t("research.exposurePercent", { percent: report.portfolio.data.allocationPercent.toFixed(1) })
                    : t("research.noPosition"),
                })}
              </p>
            ) : null}
          </article>
          <article className="rounded-2xl border border-border bg-panel-subtle p-4">
            <h3 className="text-sm font-semibold">{t("research.writerViews")}</h3>
            {!report.opinions.available ? (
              <p className="mt-2 text-sm text-muted">
                {report.opinions.reason === "not_enabled"
                  ? t("research.opinionsDisabled")
                  : t("research.opinionsFailed")}
              </p>
            ) : null}
            {report.opinions.data ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  {t("research.opinionsMeta", {
                    writers: report.opinions.data.distinctAuthors,
                    mentions: report.opinions.data.mentionCount,
                    coverage: report.opinions.data.coverage,
                    date: dateLabel(t, report.opinions.observedAt),
                  })}
                </p>
                {report.opinions.data.window ? (
                  <p className="mt-1 text-xs text-muted">
                    {t("research.covered", {
                      from: dateLabel(t, report.opinions.data.window.from),
                      to: dateLabel(t, report.opinions.data.window.to),
                    })}
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
                        {item.stance ?? t("research.unstated")}
                        {item.action ? ` · ${item.action}` : ""} ·{" "}
                        {dateLabel(t, item.date)}
                      </p>
                      <p className="mt-1 text-sm leading-5">{item.summary}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </article>
          {report.company ? (
            <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold">{t("research.filings")}</h3>
              <p className="mt-2 text-xs text-muted">
                {t("research.filingsNote")}
              </p>
              {report.company.reason ? (
                <p className="mt-2 text-sm text-muted">
                  {t(companyReason(report.company.reason))}
                </p>
              ) : null}
              {report.company.data?.briefing.map((line, index) => (
                <p className="mt-2 text-sm leading-6" key={`${index}-${line}`}>
                  {line}
                </p>
              ))}
              {report.company.data?.latestQuarter?.revenue?.display ? (
                <p className="mt-2 text-xs text-muted">
                  {t("research.quarterRevenue", { value: report.company.data.latestQuarter.revenue.display })}
                  {report.company.data.latestQuarter.derived
                    ? t("research.derived")
                    : ""}
                  {report.company.data.latestQuarter.netIncome?.display
                    ? t("research.netIncome", { value: report.company.data.latestQuarter.netIncome.display })
                    : ""}
                  {report.company.data.latestQuarter.operatingMargin?.display
                    ? t("research.operatingMargin", { value: report.company.data.latestQuarter.operatingMargin.display })
                    : ""}
                </p>
              ) : null}
              {report.company.data?.links?.length ? (
                <ul className="mt-3 space-y-2 text-xs">
                  {report.company.data.links.slice(0, 6).map((link) =>
                    link.url.startsWith(
                      "https://www.sec.gov/Archives/edgar/data/",
                    ) ? (
                      <li key={link.url}>
                        <a
                          className="underline-offset-2 hover:underline"
                          href={link.url}
                          onClick={recordSource}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {link.label}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : null}
              {report.company.fetchedAt ? (
                <p className="mt-2 text-xs text-muted">
                  {t("research.fetched", { date: dateLabel(t, report.company.fetchedAt) })}
                  {report.company.publishedAt
                    ? t("research.filed", { date: dateLabel(t, report.company.publishedAt) })
                    : ""}
                </p>
              ) : null}
            </article>
          ) : null}
          <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold">{t("research.disagreeTitle")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.opinions.data?.disagreement
                ? t("research.disagree")
                : report.opinions.data?.coverage === "current"
                  ? t("research.noOpposing")
                  : t("research.limitedCoverage")}
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
        <p className="mt-5 text-sm text-muted">{t("research.loading")}</p>
      ) : null}
    </section>
  );
}

function dateLabel(t: Translate, value?: string) {
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
    : t("research.timeUnavailable");
}

const companyReasonKeys: Record<string, MessageKey> = {
  not_mapped: "research.reasonNotMapped",
  fund_no_statements: "research.reasonFund",
  no_coverage: "research.reasonNoCoverage",
  mint_mismatch: "research.reasonMintMismatch",
  identity_mismatch: "research.reasonIdentityMismatch",
  ambiguous_identity: "research.reasonAmbiguous",
  timeout: "research.reasonTimeout",
  rate_limited: "research.reasonRateLimited",
  provider_unavailable: "research.reasonProviderUnavailable",
  stale: "research.reasonStale",
  sec_not_configured: "research.reasonNotConfigured",
  sec_preview_disabled: "research.reasonPreview",
  sec_worker_unavailable: "research.reasonWorker",
  not_licensed: "research.reasonNotLicensed",
};

function companyReason(reason: string): MessageKey {
  return companyReasonKeys[reason] ?? "research.reasonDefault";
}
