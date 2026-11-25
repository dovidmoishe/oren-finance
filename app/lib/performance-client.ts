import { analyticsAllowed, currentConsent, subscribeConsent } from "./consent";
import { routeBucket, type PerformanceMetric } from "./performance-schema";

let enabled: boolean | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: PerformanceMetric[] = [];
let sent = 0;
let watching = false;
const configuredRate = Number(process.env.NEXT_PUBLIC_PERFORMANCE_SAMPLE_RATE ?? "0.1");
/** Timings held in memory while the visitor has not chosen; nothing is stored. */
const UNDECIDED_LIMIT = 24;

export function flushPerformanceMetrics() {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length || !analyticsAllowed()) return;
  const body = JSON.stringify(queue.splice(0, 8));
  // No cookies, persistent identifiers, auth headers, retries or third parties.
  void fetch("/api/telemetry/performance", {
    method: "POST", body, keepalive: true, credentials: "omit",
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

/** Accepting sends what this page already measured; refusing drops it. */
function watchConsent() {
  if (watching) return;
  watching = true;
  subscribeConsent(() => {
    const consent = currentConsent();
    if (consent === "denied") queue.length = 0;
    else if (consent === "granted") for (let batch = 0; batch < UNDECIDED_LIMIT / 8 && queue.length; batch++) flushPerformanceMetrics();
  });
}

export function recordPerformanceMetric(metric: Pick<PerformanceMetric, "name" | "value" | "resource"> & { route?: PerformanceMetric["route"] }) {
  if (typeof window === "undefined" || !Number.isFinite(metric.value) || metric.value < 0 || metric.value > 120_000) return;
  if (enabled === undefined) {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    enabled = navigator.doNotTrack !== "1" && !privacy.globalPrivacyControl && Number.isFinite(configuredRate)
      && Math.random() < Math.min(1, Math.max(0, configuredRate));
  }
  if (!enabled || sent >= 100 || currentConsent() === "denied") return;
  watchConsent();
  const allowed = analyticsAllowed();
  if (!allowed && queue.length >= UNDECIDED_LIMIT) return;
  sent++;
  const agent = navigator.userAgent;
  queue.push({
    ...metric,
    route: metric.route ?? routeBucket(window.location.pathname),
    value: Math.round(metric.value * 1000) / 1000,
    device: window.innerWidth < 768 ? "phone" : window.innerWidth < 1024 ? "tablet" : "desktop",
    browser: /Firefox\//.test(agent) ? "firefox" : /Chrome\/|Chromium\/|CriOS\//.test(agent) ? "chromium" : /Safari\//.test(agent) ? "safari" : "other",
  });
  if (!allowed) return;
  if (queue.length >= 8) flushPerformanceMetrics();
  else if (!timer) timer = setTimeout(flushPerformanceMetrics, 2000);
}
