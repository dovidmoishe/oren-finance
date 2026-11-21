export const metricNames = ["LCP", "INP", "CLS", "TTFB", "FCP", "read", "account-ready"] as const;
export const routeNames = ["landing", "markets", "stock", "portfolio", "explore", "app-other", "other"] as const;
export const resourceNames = ["stocks", "chart", "stock", "analysis", "news", "portfolio", "history", "activity", "other"] as const;
export type PerformanceMetric = {
  name: (typeof metricNames)[number];
  value: number;
  route: (typeof routeNames)[number];
  device: "phone" | "tablet" | "desktop";
  browser: "chromium" | "safari" | "firefox" | "other";
  resource?: (typeof resourceNames)[number];
};

export function routeBucket(path: string): PerformanceMetric["route"] {
  if (path === "/") return "landing";
  if (path === "/app/markets") return "markets";
  if (path.startsWith("/app/stocks/")) return "stock";
  if (["/app", "/app/portfolio", "/app/overview"].includes(path)) return "portfolio";
  if (path === "/app/explore") return "explore";
  return path.startsWith("/app/") ? "app-other" : "other";
}

export function resourceBucket(path: string): NonNullable<PerformanceMetric["resource"]> {
  if (/\/stocks\/[^/]+\/chart$/.test(path)) return "chart";
  if (/\/stocks\/[^/]+\/analysis$/.test(path)) return "analysis";
  if (/\/stocks\/[^/]+\/news$/.test(path)) return "news";
  if (/\/stocks\/[^/]+$/.test(path)) return "stock";
  if (/\/stocks$/.test(path)) return "stocks";
  if (/\/portfolio\/[^/]+\/history$/.test(path)) return "history";
  if (/\/portfolio\/[^/]+\/activity$/.test(path)) return "activity";
  if (/\/portfolio\/[^/]+$/.test(path)) return "portfolio";
  return "other";
}

/** Strict, low-cardinality allowlist: never forward URLs, IDs or SDK payloads. */
export function parsePerformanceBatch(value: unknown): PerformanceMetric[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 8) return;
  const metrics: PerformanceMetric[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !["name", "value", "route", "device", "browser", "resource"].includes(key))) return;
    const m = item as PerformanceMetric;
    if (!(metricNames as readonly string[]).includes(m.name) || !(routeNames as readonly string[]).includes(m.route)
      || !["phone", "tablet", "desktop"].includes(m.device) || !["chromium", "safari", "firefox", "other"].includes(m.browser)
      || typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < 0 || m.value > (m.name === "CLS" ? 100 : 120_000)
      || (m.resource !== undefined && !(resourceNames as readonly string[]).includes(m.resource))) return;
    metrics.push({ name: m.name, value: m.value, route: m.route, device: m.device, browser: m.browser, ...(m.resource ? { resource: m.resource } : {}) });
  }
  return metrics;
}
