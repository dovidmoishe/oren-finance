"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import {
  getStockResearch,
  recordResearchSourceOpen,
} from "@/services/research-service";
import type { StockResearch } from "@/types";

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
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "time unavailable";
}
