"use client";

import { useEffect, useMemo, useState } from "react";
import { getFeatureVolumes, getStockVolumes, getVolumeOverview } from "@/services";
import type { FeatureVolume, StockVolume, VolumeOverview, VolumeRange } from "@/types";
import { Button, Card, CardContent, CardHeader, ErrorState, Skeleton, cn, formatCurrency } from "@/components/ui";

const ranges: VolumeRange[] = ["24h", "7d", "30d", "all"];

export function VolumeDashboard() {
  const [range, setRange] = useState<VolumeRange>("30d");
  const [overview, setOverview] = useState<VolumeOverview>();
  const [stocks, setStocks] = useState<StockVolume[]>([]);
  const [features, setFeatures] = useState<FeatureVolume[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const interval = range === "24h" || range === "7d" ? "hour" : "day";
    void Promise.all([getVolumeOverview(range, interval), getStockVolumes(range), getFeatureVolumes(range)])
      .then(([nextOverview, nextStocks, nextFeatures]) => {
        setOverview(nextOverview);
        setStocks(nextStocks.items);
        setFeatures(nextFeatures.items);
        setError(undefined);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Unable to load Oren volume");
        setLoading(false);
      });
  }, [range]);

  const maxStock = Math.max(1, ...stocks.map((stock) => stock.grossVolumeUsd));
  const points = useMemo(() => sparkline(overview?.timeSeries.map((point) => point.grossVolumeUsd) ?? []), [overview]);

  if (loading && !overview) return <div className="mx-auto max-w-[1540px] space-y-4"><Skeleton className="h-28" /><Skeleton className="h-[420px]" /></div>;
  if (error && !overview) return <div className="mx-auto max-w-3xl py-16"><ErrorState title="Volume unavailable" description={error} /></div>;

  return (
    <div className="mx-auto max-w-[1540px] space-y-6 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Verified on Solana</p>
          <h1 className="font-display text-4xl font-semibold">Oren volume</h1>
          <p className="mt-1 text-sm text-muted">Only completed stock trades routed through Oren.</p>
        </div>
        <div className="flex gap-2">
          {ranges.map((item) => <Button key={item} onClick={() => { setLoading(true); setRange(item); }} size="sm" variant={range === item ? "primary" : "secondary"}>{item.toUpperCase()}</Button>)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Gross volume" value={formatCurrency(overview?.grossVolumeUsd, 0)} />
        <Metric label="Buy volume" value={formatCurrency(overview?.buyVolumeUsd, 0)} tone="bg-accent-yellow" />
        <Metric label="Sell volume" value={formatCurrency(overview?.sellVolumeUsd, 0)} tone="bg-accent-pink" />
        <Metric label="Verified trades" value={(overview?.tradeCount ?? 0).toLocaleString()} tone="bg-accent-lavender" />
      </div>

      <Card>
        <CardHeader><h2 className="font-display text-xl font-semibold">Volume flow</h2></CardHeader>
        <CardContent>
          {points ? <svg className="h-48 w-full text-foreground" preserveAspectRatio="none" viewBox="0 0 600 160"><polyline fill="none" points={points} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg> : <p className="py-16 text-center text-sm text-muted">No verified volume in this range yet.</p>}
          <p className="mt-3 text-xs text-muted">Updated {overview ? new Date(overview.asOf).toLocaleString() : "—"}</p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader><h2 className="font-display text-xl font-semibold">Volume by stock</h2></CardHeader>
          <CardContent className="space-y-4">
            {stocks.length ? stocks.slice(0, 20).map((stock) => (
              <div key={stock.assetId}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{stock.ticker}</span><span className="font-mono">{formatCurrency(stock.grossVolumeUsd, 0)}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-subtle"><div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(2, stock.grossVolumeUsd / maxStock * 100)}%` }} /></div>
                <p className="mt-1 text-xs text-muted">{stock.tradeCount} trades · {formatCurrency(stock.buyVolumeUsd, 0)} buys · {formatCurrency(stock.sellVolumeUsd, 0)} sells</p>
              </div>
            )) : <p className="text-sm text-muted">No verified stock fills yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="font-display text-xl font-semibold">By feature</h2></CardHeader>
          <CardContent className="space-y-3">
            {features.length ? features.map((feature) => <div className="flex items-center justify-between rounded-[16px] bg-panel-subtle p-3" key={feature.feature}><span className="text-sm capitalize">{feature.feature.replace("_", " ")}</span><span className="font-mono text-sm">{formatCurrency(feature.grossVolumeUsd, 0)}</span></div>) : <p className="text-sm text-muted">No verified feature volume yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "bg-panel" }: { label: string; value: string; tone?: string }) {
  return <div className={cn("rounded-[24px] border border-border p-5", tone)}><p className="text-xs text-muted">{label}</p><p className="mt-2 font-display text-2xl font-semibold">{value}</p></div>;
}

function sparkline(values: number[]) {
  if (values.length < 2 || Math.max(...values) <= 0) return undefined;
  const max = Math.max(...values);
  return values.map((value, index) => `${(index / (values.length - 1)) * 600},${155 - value / max * 145}`).join(" ");
}
