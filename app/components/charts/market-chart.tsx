"use client";

import { ChartCandlestick, ChartLine, Check, ChevronDown, Crosshair, Minus, MoveUpRight, RotateCcw, Rows3, SlidersHorizontal, Trash2 } from "lucide-react";
import type { KLineData, Locales } from "klinecharts";
import type { ChartInterval } from "@/types";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState, LoadingState, Tabs, cn, formatCurrency, formatDate, formatPercent } from "@/components/ui";
import { THEME_CHANGE_EVENT } from "@/components/theme/theme-script";
import { useI18n } from "@/i18n/i18n";
import { buildCandleData, buildLineData, INDICATORS, type ChartIndicator, type DrawingTool, type MarketCandlePoint, type MarketChartMode, type MarketChartRange, type MarketLinePoint } from "./kline-data";
import { createKlineChart, type KlineSession } from "./kline-engine";

export type { MarketChartMode, MarketChartRange, MarketLinePoint, MarketCandlePoint } from "./kline-data";

let chartLibrary: Promise<typeof import("klinecharts")> | undefined;
function loadChartLibrary() {
  chartLibrary ??= import("klinecharts").catch((cause: unknown) => {
    chartLibrary = undefined;
    throw cause;
  });
  return chartLibrary;
}

interface MarketChartProps {
  mode: MarketChartMode;
  lineData?: MarketLinePoint[];
  candleData?: MarketCandlePoint[];
  ranges?: MarketChartRange[];
  activeRange: MarketChartRange;
  onRangeChange: (range: MarketChartRange) => void;
  onModeChange?: (mode: MarketChartMode) => void;
  value?: number;
  changePct?: number;
  dateLabel?: string;
  loading?: boolean;
  error?: string;
  emptyDescription?: string;
  className?: string;
  compact?: boolean;
  showSummary?: boolean;
  technical?: boolean;
  symbol?: string;
  interval?: ChartInterval;
  onIntervalChange?: (interval: ChartInterval) => void;
}

const EMPTY_LINES: MarketLinePoint[] = [];
const EMPTY_CANDLES: MarketCandlePoint[] = [];
const terminalTool = "grid size-7 shrink-0 place-items-center rounded text-[#96969e] transition-colors hover:bg-[#232327] hover:text-[#eeeeef] aria-pressed:bg-[#232327] aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-35";
const toolClass = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] text-muted transition-colors hover:bg-panel-subtle hover:text-foreground aria-pressed:bg-panel-subtle aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

export function MarketChart({
  mode, lineData = EMPTY_LINES, candleData = EMPTY_CANDLES,
  ranges = ["24H", "7D", "30D", "90D", "1Y"], activeRange, onRangeChange, onModeChange,
  value, changePct, dateLabel, loading, error, emptyDescription, className,
  compact = false, showSummary = true, technical = false, symbol = "Portfolio", interval, onIntervalChange,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<KlineSession | null>(null);
  const [hoveredBar, setHoveredBar] = useState<KLineData>();
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [indicators, setIndicators] = useState<ChartIndicator[]>([]);
  const [drawing, setDrawing] = useState<DrawingTool>();
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { locale, timeZone, t } = useI18n();
  const candles = useMemo(() => buildCandleData(candleData), [candleData]);
  const line = useMemo(() => buildLineData(lineData), [lineData]);
  const canUseCandles = candles.length > 0;
  const effectiveMode = mode === "candles" && canUseCandles ? "candles" : "line";
  const bars = canUseCandles ? candles : line;
  const hasData = bars.length > 0;
  const shouldInitialize = hasData || session !== null;
  const hasVolume = canUseCandles && candles.every(bar => typeof bar.volume === "number");
  const bar = (hoveredBar && bars.find(item => item.timestamp === hoveredBar.timestamp)) || bars.at(-1);
  const formattedDate = dateLabel ?? formatDate(lineData.at(-1)?.timestamp ?? candleData.at(-1)?.timestamp, locale, timeZone, t("common.notUpdated"));
  const labels: Locales = useMemo(() => ({
    time: t("chart.time"), open: t("chart.open"), high: t("chart.high"), low: t("chart.low"), close: t("chart.close"),
    volume: t("chart.volume"), change: t("chart.change"), turnover: t("chart.turnover"),
    second: t("chart.second"), minute: t("chart.minute"), hour: t("chart.hour"), day: t("chart.day"),
    week: t("chart.week"), month: t("chart.month"), year: t("chart.year"),
  }), [t]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldInitialize) return;
    let disposed = false;
    let instance: KlineSession | undefined;
    void loadChartLibrary().then(library => {
      if (disposed) return;
      instance = createKlineChart(library, container, { symbol, locale, timeZone, labels, technical,
        onCrosshair: setHoveredBar, onDrawingEnd: () => setDrawing(undefined) });
      setSession(instance);
      setLibraryFailed(false);
      window.addEventListener(THEME_CHANGE_EVENT, instance.updateColors);
    }).catch(() => { if (!disposed) setLibraryFailed(true); });
    return () => {
      disposed = true;
      if (instance) {
        window.removeEventListener(THEME_CHANGE_EVENT, instance.updateColors);
        instance.dispose();
      }
    };
  }, [shouldInitialize, labels, locale, symbol, technical, timeZone]);

  useEffect(() => {
    if (!hasData || loading || error) return;
    session?.update(bars, activeRange, interval);
  }, [activeRange, bars, error, hasData, interval, loading, session]);
  useEffect(() => { session?.setMode(effectiveMode); }, [effectiveMode, session]);
  useEffect(() => { session?.setIndicators(technical && canUseCandles ? indicators : [], hasVolume); }, [canUseCandles, hasVolume, indicators, session, technical]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") { session?.cancelDrawing(); if (menuRef.current?.contains(document.activeElement)) menuRef.current.querySelector("button")?.focus(); setIndicatorsOpen(false); } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [session]);

  useEffect(() => {
    if (!indicatorsOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setIndicatorsOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [indicatorsOpen]);

  function toggleIndicator(name: ChartIndicator) {
    setIndicators(current => current.includes(name) ? current.filter(item => item !== name)
      : [...current.filter(item => !(name === "RSI" && item === "MACD") && !(name === "MACD" && item === "RSI")), name]);
  }
  function draw(tool: DrawingTool) {
    if (drawing === tool) session?.cancelDrawing();
    else { setDrawing(tool); session?.draw(tool); }
  }
  const disabled = !hasData || loading || !!error || libraryFailed || !session;

  const chartCanvas = <>
    <div className={cn("absolute inset-0 overflow-hidden", (loading || error || libraryFailed || !hasData) && "invisible")} ref={containerRef} role="img" aria-label={t("chart.canvasLabel", { symbol })} data-chart-engine="klinecharts" />
    {loading ? <div className="absolute inset-0 flex items-center justify-center"><LoadingState label={t("common.loadingChart")} /></div>
      : error || libraryFailed ? <EmptyState title={t("common.chartUnavailable")} description={error || t("common.chartLoadFailed")} />
      : !hasData ? <EmptyState title={t("common.noChartHistory")} description={technical ? t("chart.intervalEmpty") : emptyDescription ?? t("common.chartEmptyDefault")} /> : null}
  </>;
  const modeButtons = onModeChange && <>
    <button type="button" className={technical ? terminalTool : toolClass} aria-label={t("common.lineMode")} aria-pressed={effectiveMode === "line"} title={t("common.lineChart")} onClick={() => onModeChange("line")}><ChartLine size={15} /></button>
    <button type="button" className={technical ? terminalTool : toolClass} aria-label={t("common.candleMode")} aria-pressed={effectiveMode === "candles"} title={t("common.candleChart")} disabled={!canUseCandles} onClick={() => onModeChange("candles")}><ChartCandlestick size={15} /></button>
  </>;

  if (technical) return <section className={cn("w-full min-w-0 rounded-[16px] border border-[#28282c] bg-[#0d0d0f] text-[#a0a0a6]", className)}>
    <div className="flex h-14 min-w-0 items-center gap-4 border-b border-[#242427] px-3 sm:gap-6">
      <span className="shrink-0 rounded-lg border border-[#2b2b30] px-2 py-1.5 text-sm font-semibold text-[#f0f0f2]">{symbol}</span>
      <div><p className="text-[10px] leading-4">{t("chart.price")}</p><p className="font-money text-base font-semibold leading-5 tabular-nums text-[#f0f0f2]">{formatCurrency(value, locale)}</p></div>
      <div><p className="text-[10px] leading-4">{t("chart.change24h")}</p><p className={cn("font-money text-sm font-semibold leading-5 tabular-nums", (changePct ?? 0) < 0 ? "text-[#e65358]" : "text-[#36c93f]")}>{formatPercent(changePct, locale)}</p></div>
      <div className="ml-auto flex items-center gap-0.5">{modeButtons}</div>
    </div>
    <div className="flex h-10 min-w-0 items-center gap-1 px-2 text-xs">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="group" aria-label={t("chart.interval")}>
        {(["1m", "5m", "15m", "1H", "4H", "1D"] as const).map(item => <button type="button" key={item} className="h-7 shrink-0 rounded px-2 text-[#96969e] hover:bg-[#202023] aria-pressed:bg-[#242427] aria-pressed:font-semibold aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-1" aria-pressed={interval === item} disabled={!onIntervalChange} onClick={() => onIntervalChange?.(item)}>{item.replace("H", "h")}</button>)}
      </div>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-[#2b2b30]" />
      <div ref={menuRef} className="relative shrink-0">
        <button type="button" className="flex h-7 items-center gap-1.5 rounded px-2 hover:bg-[#202023] focus-visible:outline-2 focus-visible:outline-offset-1" aria-expanded={indicatorsOpen} aria-controls={menuId} onClick={() => setIndicatorsOpen(open => !open)}><SlidersHorizontal size={13} /><span className="hidden sm:inline">{t("chart.indicators")}</span><ChevronDown size={11} /></button>
        {indicatorsOpen && <div id={menuId} className="absolute right-0 top-full z-30 mt-1 w-52 origin-top-right rounded-lg border border-[#333338] bg-[#19191c] p-1.5 shadow-xl transition-[opacity,transform] duration-250 starting:scale-97 starting:opacity-0 motion-reduce:transition-none" role="group" aria-label={t("chart.indicators")}>
          {INDICATORS.map(indicator => <label key={indicator.name} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs hover:bg-[#29292e] has-disabled:cursor-not-allowed has-disabled:opacity-40">
            <input className="peer sr-only" type="checkbox" checked={indicators.includes(indicator.name) && (indicator.name !== "VOL" || hasVolume)} disabled={disabled || !canUseCandles || (indicator.name === "VOL" && !hasVolume)} onChange={() => toggleIndicator(indicator.name)} />
            <span className="grid size-3.5 place-items-center rounded border border-[#64646c] peer-checked:border-[#c4c4cc] peer-checked:bg-[#c4c4cc] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">{indicators.includes(indicator.name) && (indicator.name !== "VOL" || hasVolume) && <Check size={10} className="text-[#131315]" />}</span>
            {indicator.name === "VOL" ? t("chart.volume") : indicator.label}
          </label>)}
          {!hasVolume && <p className="px-2 py-1 text-[10px] leading-4">{t("chart.volumeUnavailable")}</p>}
        </div>}
      </div>
    </div>
    <div className="flex h-5 items-center gap-2 overflow-hidden whitespace-nowrap pl-11 pr-2 font-mono text-[9px] tabular-nums" aria-label={t("chart.barValues")}>
      {(["open", "high", "low", "close"] as const).map((field, index) => <span key={field} title={t(`chart.${field}`)}>{["O", "H", "L", "C"][index]} <span className="text-[#c5c5cb]">{formatCurrency(bar?.[field], locale)}</span></span>)}
      <span className="hidden sm:inline">{t("chart.volume")} {typeof bar?.volume === "number" ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(bar.volume) : "?"}</span>
    </div>
    <div className="flex min-w-0">
      <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-[#242427] py-1" role="group" aria-label={t("chart.drawingTools")}>
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.crosshair")} aria-label={t("chart.crosshair")} aria-pressed={!drawing} onClick={() => session?.cancelDrawing()}><Crosshair size={16} /></button>
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.trendLine")} aria-label={t("chart.trendLine")} aria-pressed={drawing === "segment"} onClick={() => draw("segment")}><MoveUpRight size={17} /></button>
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.priceLevel")} aria-label={t("chart.priceLevel")} aria-pressed={drawing === "horizontalStraightLine"} onClick={() => draw("horizontalStraightLine")}><Minus size={18} /></button>
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.fibonacci")} aria-label={t("chart.fibonacci")} aria-pressed={drawing === "fibonacciLine"} onClick={() => draw("fibonacciLine")}><Rows3 size={16} /></button>
        <span aria-hidden className="my-1 h-px w-5 bg-[#2b2b30]" />
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.resetView")} aria-label={t("chart.resetView")} onClick={() => session?.fit()}><RotateCcw size={15} /></button>
        <button type="button" className={terminalTool} disabled={disabled} title={t("chart.clearDrawings")} aria-label={t("chart.clearDrawings")} onClick={() => session?.clearDrawings()}><Trash2 size={15} /></button>
      </div>
      <div className="relative h-[280px] min-w-0 flex-1 sm:h-[320px]">{chartCanvas}</div>
    </div>
    {(drawing || indicators.some(name => { const item = INDICATORS.find(i => i.name === name); return item && name !== "VOL" && bars.length < Math.max(item.minimum, name === "MA" ? 50 : 0); })) && <p className="border-t border-[#242427] px-3 py-1 text-[10px] leading-4" role="status">{drawing ? t("chart.drawHint") : t("chart.historyHint")}</p>}
  </section>;

  return <section className={cn("flex flex-col rounded-[24px] border border-border bg-panel shadow-[0_18px_60px_rgba(23,23,23,0.025)]", compact ? "p-3" : "p-[var(--app-card-padding,1.5rem)]", className)}>
    {showSummary && <div><p className={cn("font-money font-semibold tabular-nums", compact ? "text-3xl" : "text-6xl")}>{formatCurrency(value, locale)}</p><div className="mt-1 flex items-center gap-3 text-xs"><span className={cn((changePct ?? 0) < 0 ? "text-negative" : "text-positive")}>{formatPercent(changePct, locale)}</span><span className="text-muted">{formattedDate}</span></div></div>}
    <div className={cn("relative min-w-0", compact ? "mt-4 h-[220px] min-h-[200px] flex-1 sm:h-[260px] sm:min-h-[240px]" : "mt-[var(--app-chart-gap,2rem)] h-[var(--app-chart-height,430px)] min-h-[var(--app-chart-min-height,340px)]")}>{chartCanvas}</div>
    <div className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3", compact ? "mt-3" : "mt-6")}><Tabs ariaLabel={t("common.chartRange")} items={ranges} onValueChange={onRangeChange} value={activeRange} /><div className="flex gap-1">{modeButtons}</div></div>
  </section>;
}
