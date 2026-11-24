import type { Crosshair, KLineData, Locales, Styles, DeepPartial } from "klinecharts";
import type { ChartInterval } from "@/types";
import { chartPeriod, INDICATORS, type ChartIndicator, type DrawingTool, type MarketChartMode, type MarketChartRange } from "./kline-data";

type Library = Pick<typeof import("klinecharts"), "init" | "dispose" | "registerLocale">;
interface ChartOptions {
  symbol: string;
  locale: string;
  timeZone: string;
  labels: Locales;
  technical: boolean;
  onCrosshair: (bar?: KLineData) => void;
  onDrawingEnd: () => void;
}

export function createKlineChart(library: Library, container: HTMLElement, options: ChartOptions) {
  library.registerLocale(options.locale, options.labels);
  let period = chartPeriod("30D");
  const chart = library.init(container, {
    locale: options.locale, timezone: options.timeZone,
    hotkey: { enabled: false },
    layout: { barSpaceLimit: { min: 1, max: 80 } },
    formatter: { formatDate: ({ timestamp, type }) => new Intl.DateTimeFormat(options.locale, {
      timeZone: options.timeZone,
      ...(type === "xAxis" && (period.type === "minute" || (period.type === "hour" && period.span === 1)) ? {} : { month: "short", day: "numeric" }),
      ...(type !== "xAxis" || period.type === "hour" || period.type === "minute" ? { hour: "2-digit", minute: "2-digit" } : {}),
      ...(type !== "xAxis" ? { year: "numeric" } : {}),
    }).format(timestamp) },
  });
  if (!chart) throw new Error("Chart initialization failed");
  let data: KLineData[] = [];
  let active = true;
  let pendingDrawing: string | null = null;
  let mode: MarketChartMode = "line";

  const updateColors = () => {
    if (!active) return;
    const computed = getComputedStyle(container);
    const terminal: Record<string, string> = { 'chart-up': '#36c93f', 'chart-down': '#e65358', 'chart-text': '#96969b', 'chart-grid': '#262629', 'chart-crosshair': '#636368', 'chart-crosshair-soft': '#404044', 'chart-line': '#c4c4cc', 'chart-area': '#9a9aa5', 'panel': '#0d0d0f', 'panel-subtle': '#202023', 'border': '#252528' };
    const color = (name: string) => options.technical ? terminal[name] ?? '#96969b' : computed.getPropertyValue(`--${name}`).trim();
    const upColor = color("chart-up"), downColor = color("chart-down"), neutral = color("chart-text");
    const font = computed.fontFamily;
    const text = { color: neutral, family: font, size: 10 };
    const styles: DeepPartial<Styles> = {
      grid: { horizontal: { color: color("chart-grid"), style: "dashed", dashedValue: [2, 4] }, vertical: { show: options.technical, color: color("chart-grid"), style: "dashed", dashedValue: [2, 4] } },
      candle: {
        type: mode === "candles" ? "candle_solid" : "area",
        bar: { upColor, downColor, noChangeColor: neutral, upBorderColor: upColor, downBorderColor: downColor,
          noChangeBorderColor: neutral, upWickColor: upColor, downWickColor: downColor, noChangeWickColor: neutral },
        area: { lineColor: color("chart-line"), lineSize: 2, smooth: false,
          backgroundColor: [{ offset: 0, color: `${color("chart-area")}24` }, { offset: 1, color: `${color("chart-area")}00` }],
          point: { show: false, animation: false } },
        tooltip: { showRule: "none" },
        priceMark: { high: { show: false }, low: { show: false }, last: { show: options.technical, upColor, downColor, noChangeColor: neutral } },
      },
      xAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: text },
      yAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: text },
      indicator: { ohlc: { upColor, downColor, noChangeColor: neutral },
        bars: [{ upColor, downColor, noChangeColor: neutral }],
        tooltip: { title: { color: neutral, family: font, size: 10 }, legend: { color: neutral, family: font, size: 10 } } },
      separator: { color: color("border"), activeBackgroundColor: color("panel-subtle") },
      crosshair: { horizontal: { line: { color: color("chart-crosshair-soft") }, text: { backgroundColor: color("panel-subtle"), ...text } },
        vertical: { line: { color: color("chart-crosshair") }, text: { backgroundColor: color("panel-subtle"), ...text } } },
      overlay: { line: { color: color("chart-line"), size: 1.5 }, text: { color: neutral, backgroundColor: color("panel"), family: font } },
    };
    chart.setStyles(styles);
  };

  const crosshair = (value: unknown) => options.onCrosshair((value as Crosshair | undefined)?.kLineData);
  chart.subscribeAction("onCrosshairChange", crosshair);
  chart.setSymbol({ ticker: options.symbol, pricePrecision: 2, volumePrecision: 2 });
  chart.setPeriod(chartPeriod("30D"));
  updateColors();

  function fit() {
    if (!active) return;
    const width = chart!.getSize("candle_pane")?.width ?? container.clientWidth;
    chart!.setBarSpace(Math.max(1, Math.min(50, (width - 64) / Math.max(options.technical ? Math.min(data.length, 100) : data.length, 10))));
    chart!.setOffsetRightDistance(24);
    chart!.scrollToRealTime();
  }

  const observer = new ResizeObserver(() => { if (active) chart.resize(); });
  observer.observe(container);

  return {
    chart,
    update(bars: KLineData[], range: MarketChartRange, interval?: ChartInterval) {
      if (!active) return;
      data = bars;
      period = chartPeriod(range, interval);
      chart.setPeriod(period);
      chart.setDataLoader({ getBars: ({ type, callback }) => {
        // No implicit pagination: the stock store supplies the selected window.
        queueMicrotask(() => {
          if (!active) return;
          callback(type === "init" ? data : [], false);
          if (type === "init") fit();
        });
      } });
    },
    setMode(value: MarketChartMode) { if (!active) return; mode = value; updateColors(); },
    setIndicators(selected: ChartIndicator[], hasVolume: boolean) {
      if (!active) return;
      for (const indicator of INDICATORS) {
        const enabled = selected.includes(indicator.name) && (indicator.name !== "VOL" || hasVolume);
        const existing = chart.getIndicators({ name: indicator.name });
        if (!enabled && existing.length) chart.removeIndicator({ name: indicator.name });
        if (enabled && !existing.length) {
          const paneId = indicator.main ? "candle_pane" : `oren_${indicator.name}`;
          chart.createIndicator({ name: indicator.name, paneId, calcParams: indicator.params }, indicator.main);
          if (!indicator.main) chart.setPaneOptions({ id: paneId, height: indicator.name === "VOL" ? 50 : 70, minHeight: 40, dragEnabled: true });
        }
      }
    },
    cancelDrawing() {
      if (!active) return;
      if (pendingDrawing) chart.removeOverlay({ id: pendingDrawing });
      pendingDrawing = null;
      options.onDrawingEnd();
    },
    draw(name: DrawingTool) {
      if (!active) return;
      if (pendingDrawing) chart.removeOverlay({ id: pendingDrawing });
      pendingDrawing = chart.createOverlay({ name, paneId: "candle_pane", onDrawEnd: () => {
        pendingDrawing = null;
        options.onDrawingEnd();
      } }) as string | null;
    },
    clearDrawings() { if (!active) return; chart.removeOverlay(); pendingDrawing = null; options.onDrawingEnd(); },
    fit,
    updateColors,
    dispose() {
      active = false;
      observer.disconnect();
      chart.unsubscribeAction("onCrosshairChange", crosshair);
      library.dispose(chart);
    },
  };
}

export type KlineSession = ReturnType<typeof createKlineChart>;
