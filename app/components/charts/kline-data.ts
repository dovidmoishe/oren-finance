import type { KLineData, Period } from "klinecharts";
import type { ChartInterval } from "@/types";

export interface MarketLinePoint { timestamp: string; value: number }
export interface MarketCandlePoint { timestamp: string; open: number; high: number; low: number; close: number; volume?: number }
export type MarketChartRange = "24H" | "7D" | "30D" | "90D" | "1Y";
export type MarketChartMode = "line" | "candles";
export type ChartIndicator = "MA" | "EMA" | "BOLL" | "VOL" | "RSI" | "MACD";
export type DrawingTool = "segment" | "horizontalStraightLine" | "fibonacciLine";

function uniqueSorted(points: KLineData[]): KLineData[] {
  return [...new Map(points.map(point => [point.timestamp, point])).values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function buildCandleData(points: MarketCandlePoint[]): KLineData[] {
  return uniqueSorted(points.flatMap(point => {
    const timestamp = Date.parse(point.timestamp);
    if (![timestamp, point.open, point.high, point.low, point.close].every(Number.isFinite) ||
      point.high < Math.max(point.open, point.close, point.low) || point.low > Math.min(point.open, point.close)) return [];
    return [{ timestamp, open: point.open, high: point.high, low: point.low, close: point.close,
      ...(typeof point.volume === "number" && Number.isFinite(point.volume) && point.volume >= 0 ? { volume: point.volume } : {}) }];
  }));
}

// A portfolio supplies observations, not OHLC. These bars are rendered only as an area.
export function buildLineData(points: MarketLinePoint[]): KLineData[] {
  return uniqueSorted(points.flatMap(point => {
    const timestamp = Date.parse(point.timestamp);
    return Number.isFinite(timestamp) && Number.isFinite(point.value)
      ? [{ timestamp, open: point.value, high: point.value, low: point.value, close: point.value }] : [];
  }));
}

export function chartPeriod(range: MarketChartRange, interval?: ChartInterval): Period {
  if (interval) {
    return interval.endsWith("m") ? { type: "minute", span: parseInt(interval) } : interval.endsWith("H") ? { type: "hour", span: parseInt(interval) } : { type: "day", span: 1 };
  }
  // These are the API's candle intervals, not the selected lookback's length.
  return range === "24H" ? { type: "hour", span: 1 } : range === "7D" ? { type: "hour", span: 4 } : { type: "day", span: 1 };
}

export const INDICATORS: { name: ChartIndicator; label: string; params: number[]; minimum: number; main: boolean }[] = [
  { name: "MA", label: "SMA 20 / 50", params: [20, 50], minimum: 20, main: true },
  { name: "EMA", label: "EMA 20", params: [20], minimum: 20, main: true },
  { name: "BOLL", label: "BOLL 20, 2", params: [20, 2], minimum: 20, main: true },
  { name: "VOL", label: "VOL", params: [], minimum: 1, main: false },
  { name: "RSI", label: "RSI 14", params: [14], minimum: 15, main: false },
  { name: "MACD", label: "MACD 12, 26, 9", params: [12, 26, 9], minimum: 35, main: false },
];
