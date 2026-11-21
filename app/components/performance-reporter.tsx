"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { flushPerformanceMetrics, recordPerformanceMetric } from "@/lib/performance-client";
import { metricNames, routeBucket, type PerformanceMetric } from "@/lib/performance-schema";

// Web Vitals describe the document lifetime; soft-route read timings are
// attributed separately at request completion.
const documentRoute = typeof window === "undefined" ? "other" : routeBucket(window.location.pathname);
function report(metric: { name: string; value: number }) {
  if ((metricNames as readonly string[]).includes(metric.name)) {
    recordPerformanceMetric({ name: metric.name as PerformanceMetric["name"], value: metric.value, route: documentRoute });
  }
}

export function PerformanceReporter() {
  useReportWebVitals(report);
  useEffect(() => {
    const hidden = () => { if (document.hidden) flushPerformanceMetrics(); };
    window.addEventListener("pagehide", flushPerformanceMetrics);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flushPerformanceMetrics);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return null;
}
