import { TechnicalBriefPanel } from "@/components/stock/technical-brief-panel";
import { formatCurrency, formatNumber, formatPercent, formatRelativeTime } from "@/components/ui/utils";
import type { NewsItem, StockAnalysis, StockDetail } from "@/types";

const trendLabels = { uptrend: "Uptrend", downtrend: "Downtrend", range: "Range-bound" };

function percent(value?: number, signed = true) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value, signed) : "Unavailable";
}

function metric(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value, 2) : "Unavailable";
}

export function StockMarketOutlook({ stock, analysis, news }: {
  stock: StockDetail;
  analysis?: StockAnalysis;
  news: NewsItem[];
}) {
  const brief = analysis?.technicalBrief;
  const trend = brief ? trendLabels[brief.regime] : "Unavailable";
  const momentum = analysis?.signals.momentum7d;
  const hasMomentum = typeof momentum === "number" && Number.isFinite(momentum);
  const takeaway = brief
    ? `${stock.ticker} is ${brief.regime === "uptrend" ? "trending upward" : brief.regime === "downtrend" ? "trending downward" : "trading in a range"}${hasMomentum ? `, ${momentum >= 0 ? "up" : "down"} ${formatPercent(Math.abs(momentum), false)} over the past week` : ""}.`
    : hasMomentum
      ? `${stock.ticker} is ${momentum >= 0 ? "up" : "down"} ${formatPercent(Math.abs(momentum), false)} over the past week.`
      : "There isn’t enough market data for an outlook yet.";
  const risk = brief?.risks[0] ?? (typeof analysis?.signals.volatility30d === "number"
    ? `30-day volatility is ${percent(analysis.signals.volatility30d, false)}.`
    : undefined);
  const score = analysis?.opportunityScore;

  return (
    <section aria-labelledby="market-outlook-title" className="rounded-[20px] border border-border bg-panel px-5 sm:px-6">
      <div className="py-5 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-base font-semibold" id="market-outlook-title">Market outlook</h2>
          {analysis ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {typeof score === "number" && Number.isFinite(score) ? (
                <span>Opportunity <span className="ml-1 font-mono font-medium text-foreground">{Math.round(Math.min(100, Math.max(0, score)))}<span className="font-normal text-muted"> / 100</span></span></span>
              ) : null}
              {analysis.riskLabel ? <span className="capitalize">{analysis.riskLabel} risk</span> : null}
            </div>
          ) : null}
        </div>

        {analysis ? (
          <>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{takeaway}</p>
            <dl className="mt-5 grid grid-cols-3 gap-3 sm:max-w-xl sm:gap-8">
              {[
                ["Trend", trend],
                ["7D momentum", percent(momentum)],
                ["30D volatility", percent(analysis.signals.volatility30d, false)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1.5 text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {risk ? <p className="mt-5 max-w-2xl text-xs leading-5 text-muted"><span className="font-medium text-foreground">Watch for: </span>{risk}</p> : null}
          </>
        ) : <p className="mt-3 text-sm text-muted">Analysis is currently unavailable.</p>}
      </div>

      {analysis ? (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-xs font-medium focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
            <span><span className="group-open:hidden">View technical details</span><span className="hidden group-open:inline">Hide technical details</span></span>
            <span aria-hidden className="text-base font-normal text-muted"><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span>
          </summary>
          <div className="space-y-5 pb-5">
            {analysis.summary ? <p className="max-w-3xl text-sm leading-6 text-muted">{analysis.summary}</p> : null}
            {brief ? <TechnicalBriefPanel brief={brief} /> : null}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs sm:grid-cols-3">
              {[
                ["30D momentum", percent(analysis.signals.momentum30d)],
                ...(!brief ? [["RSI (14)", metric(analysis.signals.rsi14)]] : []),
                ["Volume trend", percent(analysis.signals.volumeTrend)],
                ["Liquidity", typeof stock.liquidityUsd === "number" ? formatCurrency(stock.liquidityUsd, 0) : "Unavailable"],
                ["Liquidity score", typeof analysis.signals.liquidityScore === "number" ? `${metric(analysis.signals.liquidityScore)} / 100` : "Unavailable"],
                ["20D moving average", typeof analysis.signals.sma20 === "number" ? formatCurrency(analysis.signals.sma20) : "Unavailable"],
                ["50D moving average", typeof analysis.signals.sma50 === "number" ? formatCurrency(analysis.signals.sma50) : "Unavailable"],
              ].map(([label, value]) => (
                <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-mono">{value}</dd></div>
              ))}
            </dl>
            {analysis.highlights.length ? <ul className="list-inside list-disc space-y-1 text-xs leading-5 text-muted">{analysis.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}
            <p className="text-xs leading-5 text-muted">Based on deterministic market signals. Updated {formatRelativeTime(analysis.analyzedAt)}.</p>
          </div>
        </details>
      ) : null}

      <div className="border-t border-border py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="text-xs font-medium">Latest news</h3>
          {!news.length ? <p className="text-xs text-muted">No recent coverage.</p> : null}
        </div>
        {news.length ? (
          <div className="mt-3 divide-y divide-border">
            {news.slice(0, 3).map((item) => (
              <article className="py-3 first:pt-0 last:pb-0" key={item.id}>
                <p className="mb-1 text-xs text-muted">{item.source ?? "Market news"} · {formatRelativeTime(item.publishedAt)}</p>
                <h4 className="text-sm font-medium leading-5">{item.url ? <a className="hover:underline focus-visible:underline" href={item.url} rel="noreferrer" target="_blank">{item.headline}</a> : item.headline}</h4>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
