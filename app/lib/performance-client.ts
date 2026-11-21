import { routeBucket, type PerformanceMetric } from "./performance-schema";

let enabled: boolean | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: PerformanceMetric[] = [];
let sent = 0;
const configuredRate = Number(process.env.NEXT_PUBLIC_PERFORMANCE_SAMPLE_RATE ?? "0.1");

export function flushPerformanceMetrics() {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0, 8));
  // No cookies, persistent identifiers, auth headers, retries or third parties.
  void fetch("/api/telemetry/performance", {
    method: "POST", body, keepalive: true, credentials: "omit",
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

export function recordPerformanceMetric(metric: Pick<PerformanceMetric, "name" | "value" | "resource"> & { route?: PerformanceMetric["route"] }) {
  if (typeof window === "undefined" || !Number.isFinite(metric.value) || metric.value < 0 || metric.value > 120_000) return;
  if (enabled === undefined) {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    enabled = navigator.doNotTrack !== "1" && !privacy.globalPrivacyControl && Number.isFinite(configuredRate)
      && Math.random() < Math.min(1, Math.max(0, configuredRate));
  }
  if (!enabled || sent >= 100) return;
  sent++;
  const agent = navigator.userAgent;
  queue.push({
    ...metric,
    route: metric.route ?? routeBucket(window.location.pathname),
    value: Math.round(metric.value * 1000) / 1000,
    device: window.innerWidth < 768 ? "phone" : window.innerWidth < 1024 ? "tablet" : "desktop",
    browser: /Firefox\//.test(agent) ? "firefox" : /Chrome\/|Chromium\/|CriOS\//.test(agent) ? "chromium" : /Safari\//.test(agent) ? "safari" : "other",
  });
  if (queue.length >= 8) flushPerformanceMetrics();
  else if (!timer) timer = setTimeout(flushPerformanceMetrics, 2000);
}
