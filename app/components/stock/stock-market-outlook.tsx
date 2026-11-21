"use client";

import { ArrowUpRight, ChartNoAxesCombined, ChevronDown, Newspaper, ShieldAlert, TrendingDown, TrendingUp, MoveRight } from "lucide-react";

import { TechnicalBriefPanel } from "@/components/stock/technical-brief-panel";
import { cn, formatCurrency, formatNumber, formatPercent, formatRelativeTime } from "@/components/ui/utils";
import { filterStockNews } from "@/services/stock-news";
import type { NewsItem, StockAnalysis, StockDetail } from "@/types";
import { useI18n, type MessageKey, type MessageValues, type Translate } from "@/i18n/i18n";

const trendLabels: Record<"uptrend" | "downtrend" | "range", MessageKey> = { uptrend: "stock.uptrend", downtrend: "stock.downtrend", range: "stock.range" };

function percent(t: Translate, locale: string, value?: number, signed = true) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value, locale, signed) : t("stock.unavailable");
}

function metric(t: Translate, locale: string, value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value, locale, 2) : t("stock.unavailable");
}

const trendKeys = {
  uptrend: { none: "stock.trendUp", up: "stock.trendUpMomentum", down: "stock.trendUpMomentumDown" },
  downtrend: { none: "stock.trendDown", up: "stock.trendDownMomentumUp", down: "stock.trendDownMomentum" },
  range: { none: "stock.trendRange", up: "stock.trendRangeMomentumUp", down: "stock.trendRangeMomentumDown" },
} as const satisfies Record<"uptrend" | "downtrend" | "range", Record<"none" | "up" | "down", MessageKey>>;

export function StockMarketOutlook({ stock, analysis, news, analysisLoading = false, newsLoading = false }: {
  stock: StockDetail;
  analysisLoading?: boolean;
  newsLoading?: boolean;
  analysis?: StockAnalysis;
  news: NewsItem[];
}) {
  const { locale, t } = useI18n();
  const brief = analysis?.technicalBrief;
  const trend = brief ? t(trendLabels[brief.regime]) : t("stock.unavailable");
  const momentum = analysis?.signals.momentum7d;
  const hasMomentum = typeof momentum === "number" && Number.isFinite(momentum);
  const momentumValues: MessageValues = hasMomentum ? { ticker: stock.ticker, percent: formatPercent(Math.abs(momentum), locale, false) } : { ticker: stock.ticker };
  const takeaway = brief
    ? t(trendKeys[brief.regime][hasMomentum ? (momentum >= 0 ? "up" : "down") : "none"], momentumValues)
    : hasMomentum
      ? t(momentum >= 0 ? "stock.momentumUp" : "stock.momentumDown", momentumValues)
      : t("stock.noOutlook");
  const risk = brief?.risks[0] ?? (typeof analysis?.signals.volatility30d === "number"
    ? t("stock.volatilityRisk", { percent: percent(t, locale, analysis.signals.volatility30d, false) })
    : undefined);
  const score = analysis?.opportunityScore;
  const boundedScore = typeof score === "number" && Number.isFinite(score) ? Math.round(Math.min(100, Math.max(0, score))) : undefined;
  const relevantNews = filterStockNews(news, stock).slice(0, 3);
  const displayBrief = brief ? { ...brief, newsOverlay: brief.newsOverlay ? filterStockNews(brief.newsOverlay, stock) : undefined } : undefined;
  const TrendIcon = brief?.regime === "uptrend" ? TrendingUp : brief?.regime === "downtrend" ? TrendingDown : MoveRight;

  return (
    <section aria-labelledby="market-outlook-title" className="@container/outlook overflow-hidden rounded-2xl border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 px-5 py-4 @lg/outlook:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-panel-subtle text-muted"><ChartNoAxesCombined aria-hidden="true" size={17} strokeWidth={1.7} /></span>
          <h2 className="font-display text-base font-semibold" id="market-outlook-title">{t("stock.outlookTitle")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {analysis?.riskLabel && <span className="rounded-full border border-border px-2.5 py-1 text-[11px] capitalize text-muted">{t("stock.riskLabel", { label: analysis.riskLabel })}</span>}
          {boundedScore !== undefined && (
            <div aria-label={t("stock.opportunity")} aria-valuemax={100} aria-valuemin={0} aria-valuenow={boundedScore} className="flex items-center gap-2.5 rounded-lg bg-panel-subtle px-3 py-2" role="meter">
              <span className="text-[11px] text-muted">{t("stock.opportunity")}</span>
              <span className="font-money text-sm font-semibold tabular-nums">{boundedScore}<span className="font-normal text-muted"> / 100</span></span>
              <span aria-hidden="true" className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, index) => <span className={cn("h-3 w-1 rounded-full", index < Math.round(boundedScore / 10) ? "bg-foreground/75" : "bg-border")} key={index} />)}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className={cn("grid", relevantNews.length > 0 && "@3xl/outlook:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
        <div className="min-w-0 p-5 @lg/outlook:p-6">
          {analysis ? (
            <>
              <p className="max-w-2xl text-balance font-display text-lg font-medium leading-7 tracking-tight @lg/outlook:text-xl">{takeaway}</p>
              <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-panel-subtle/50">
                {[
                  [t("stock.trend"), trend],
                  [t("stock.momentum7d"), percent(t, locale, momentum)],
                  [t("stock.volatility30d"), percent(t, locale, analysis.signals.volatility30d, false)],
                ].map(([label, value]) => (
                  <div className="min-w-0 px-3 py-3.5 @lg/outlook:px-4" key={label}>
                    <dt className="text-[11px] leading-4 text-muted">{label}</dt>
                    <dd className={cn("mt-2 flex items-center gap-1.5 text-sm font-medium", label !== t("stock.trend") && "font-money tabular-nums", label === t("stock.momentum7d") && hasMomentum && (momentum > 0 ? "text-positive" : momentum < 0 ? "text-negative" : "text-foreground"))}>
                      {label === t("stock.trend") && <TrendIcon aria-hidden="true" className="hidden shrink-0 @lg/outlook:block" size={15} strokeWidth={1.8} />}<span className="min-w-0 break-words">{value}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {risk ? <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-panel-subtle px-3 py-3"><ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-muted" size={15} strokeWidth={1.7} /><p className="text-xs leading-5 text-muted"><span className="font-medium text-foreground">{t("stock.watchFor")}</span>{risk}</p></div> : null}
            </>
          ) : <p aria-busy={analysisLoading} className="mt-3 text-sm text-muted">{t(analysisLoading ? "common.loading" : "stock.analysisUnavailable")}</p>}
        </div>

        <aside aria-labelledby="outlook-news-title" className={cn("min-w-0 border-t border-border/70 bg-panel-subtle/30", relevantNews.length ? "p-5 @lg/outlook:p-6 @3xl/outlook:border-s @3xl/outlook:border-t-0" : "flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 @lg/outlook:px-6")}>
          <div className="flex items-center gap-2 text-muted"><Newspaper aria-hidden="true" size={16} strokeWidth={1.7} /><h3 className="text-xs font-medium text-foreground" id="outlook-news-title">{t("stock.latestNews")}</h3></div>
          {relevantNews.length ? <div className="mt-3 divide-y divide-border">
            {relevantNews.map((item) => (
              <article className="py-3 first:pt-0 last:pb-0" key={item.id}>
                <p className="mb-1.5 text-[11px] leading-4 text-muted">{item.source ?? t("stock.marketNews")} · {formatRelativeTime(item.publishedAt, locale, { justNow: t("common.justNow"), unknown: t("common.unknown") })}</p>
                <h4 className="text-sm font-medium leading-6">{item.url && /^https?:\/\//i.test(item.url) ? <a className="group flex items-start gap-2 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-focus" href={item.url} rel="noopener noreferrer" target="_blank"><span className="min-w-0 flex-1">{item.headline}</span><ArrowUpRight aria-hidden="true" className="mt-1 shrink-0 text-muted group-hover:text-foreground" size={14} /></a> : item.headline}</h4>
              </article>
            ))}
          </div> : <p aria-busy={newsLoading} className="text-xs leading-5 text-muted">{t(newsLoading ? "common.loading" : "stock.noNews")}</p>}
        </aside>
      </div>

      {analysis ? (
        <details className="group border-t border-border px-5 @lg/outlook:px-6">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-xs font-medium text-muted hover:text-foreground focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
            <span><span className="group-open:hidden">{t("stock.viewDetails")}</span><span className="hidden group-open:inline">{t("stock.hideDetails")}</span></span>
            <ChevronDown aria-hidden="true" className="shrink-0 group-open:rotate-180" size={16} strokeWidth={1.7} />
          </summary>
          <div className="space-y-5 pb-5">
            {analysis.summary ? <p className="max-w-3xl text-sm leading-6 text-muted">{analysis.summary}</p> : null}
            {displayBrief ? <TechnicalBriefPanel brief={displayBrief} /> : null}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs sm:grid-cols-3">
              {[
                [t("stock.momentum30d"), percent(t, locale, analysis.signals.momentum30d)],
                ...(!brief ? [[t("stock.rsi14"), metric(t, locale, analysis.signals.rsi14)]] : []),
                [t("stock.volumeTrend"), percent(t, locale, analysis.signals.volumeTrend)],
                [t("stock.liquidity"), typeof stock.liquidityUsd === "number" ? formatCurrency(stock.liquidityUsd, locale, 0) : t("stock.unavailable")],
                [t("stock.liquidityScore"), typeof analysis.signals.liquidityScore === "number" ? `${metric(t, locale, analysis.signals.liquidityScore)} / 100` : t("stock.unavailable")],
                [t("stock.sma20"), typeof analysis.signals.sma20 === "number" ? formatCurrency(analysis.signals.sma20, locale) : t("stock.unavailable")],
                [t("stock.sma50"), typeof analysis.signals.sma50 === "number" ? formatCurrency(analysis.signals.sma50, locale) : t("stock.unavailable")],
              ].map(([label, value]) => (
                <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-mono">{value}</dd></div>
              ))}
            </dl>
            {analysis.highlights.length ? <ul className="list-inside list-disc space-y-1 text-xs leading-5 text-muted">{analysis.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}
            <p className="text-xs leading-5 text-muted">{t("stock.basedOn", { time: formatRelativeTime(analysis.analyzedAt, locale, { justNow: t("common.justNow"), unknown: t("common.unknown") }) })}</p>
          </div>
        </details>
      ) : null}

    </section>
  );
}
