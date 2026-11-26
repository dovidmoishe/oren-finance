import { describe, expect, it } from "vitest";
import {
  activePreset,
  axisLabel,
  countryFlag,
  countryName,
  formatCount,
  formatMetric,
  formatUsd,
  hasPermission,
  niceScale,
  referrerInitial,
  referrerLabel,
  initialRange,
  trafficCoverage,
  percent,
  totalSlice,
  validRange,
} from "../src/model";
import type { Session } from "../src/types";

describe("report presentation", () => {
  it("keeps missing metrics distinct from measured zero", () => {
    expect(formatCount({ status: "unavailable", value: null })).toBe("—");
    expect(formatCount({ status: "unavailable", value: 99 })).toBe("—");
    expect(formatCount({ status: "exact", value: 0 })).toBe("0");
    expect(formatCount({ status: "partial", value: 12 })).toBe("12");
    expect(percent(null)).toBe("—");
    expect(percent(0)).toBe("0.0%");
  });
  it("includes the current report day in Lagos and UTC", () => {
    expect(
      initialRange("Africa/Lagos", new Date("2026-11-07T23:30:00Z")),
    ).toEqual({ from: "2026-10-26", to: "2026-11-08" });
    expect(initialRange("UTC", new Date("2026-11-07T23:30:00Z"))).toEqual({
      from: "2026-10-25",
      to: "2026-11-07",
    });
  });
  it("shows recorded pageviews when the range includes gaps and a partial day", () => {
    const missing = {
      day: "2026-11-23",
      status: "unavailable",
      value: null,
    } as const;
    expect(trafficCoverage([missing])).toEqual({
      recordedPageviews: null,
      partial: false,
      missing: 1,
    });
    expect(
      trafficCoverage([
        missing,
        { day: "2026-11-24", status: "exact", value: 0 },
        { day: "2026-11-25", status: "partial", value: 22 },
      ]),
    ).toEqual({
      recordedPageviews: 22,
      partial: true,
      missing: 1,
    });
  });
  it("offers 7, 14, 30 and 90 day presets ending today", () => {
    const now = new Date("2026-11-07T23:30:00Z");
    expect(initialRange("Africa/Lagos", now, 7)).toEqual({
      from: "2026-11-02",
      to: "2026-11-08",
    });
    expect(initialRange("UTC", now, 90)).toEqual({
      from: "2026-08-10",
      to: "2026-11-07",
    });
    expect(activePreset("2026-10-26", "2026-11-08", "Africa/Lagos", now)).toBe(14);
    // The same dates are a different window in UTC, so no preset is selected.
    expect(activePreset("2026-10-26", "2026-11-08", "UTC", now)).toBeUndefined();
  });
  it("draws round axis steps and keeps small axes in whole numbers", () => {
    expect(niceScale(393)).toEqual({ max: 400, step: 100 });
    expect(niceScale(2)).toEqual({ max: 2, step: 1 });
    expect(niceScale(9)).toEqual({ max: 10, step: 5 });
    expect(niceScale(0.4)).toEqual({ max: 1, step: 1 });
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect(niceScale(12_400)).toEqual({ max: 15_000, step: 5_000 });
    expect(axisLabel(5_000, 15_000)).toBe("5K");
    expect(axisLabel(5_000, 9_000)).toBe("5,000");
  });
  it("shows stat values in full until they need compacting", () => {
    expect(formatMetric(99_999)).toBe("99,999");
    expect(formatMetric(128_400)).toBe("128.4K");
    expect(formatUsd(1_234.5)).toBe("$1,234.50");
    expect(formatUsd(10_842.5)).toBe("$10,843");
    expect(formatUsd(4_200_000)).toBe("$4.2M");
  });
  it("rejects invalid dates and ranges beyond the API limit", () => {
    expect(validRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(validRange("2026-11-08", "2026-11-07")).toBe(false);
    expect(validRange("2025-01-01", "2026-01-02")).toBe(false);
    expect(validRange("", "2026-11-07")).toBe(false);
    expect(validRange("2026-11-07", "2026-11-07")).toBe(true);
  });
  it("does not add grouped distinct-account counts", () => {
    expect(totalSlice([])).toBeUndefined();
  });
});

describe("access presentation", () => {
  const session = {
    permissions: ["dashboard.access"],
    mustChangePassword: false,
    isMaster: true,
  } as Session;
  it("keeps dashboard access separate from report permission, including for masters", () => {
    expect(hasPermission(session, "dashboard.access")).toBe(true);
    expect(hasPermission(session, "reports.read")).toBe(false);
    expect(
      hasPermission(
        { ...session, mustChangePassword: true },
        "dashboard.access",
      ),
    ).toBe(false);
  });
});

describe("audience labels", () => {
  it("names countries and draws flags from ISO codes", () => {
    expect(countryName("NG")).toBe("Nigeria");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryFlag("NG")).toBe("\u{1F1F3}\u{1F1EC}");
    expect(countryFlag("(unknown)")).toBe("");
  });
  it("names the referrers that hide where a visit came from", () => {
    expect(referrerLabel("t.co")).toBe("X (t.co)");
    expect(referrerLabel("com.google.android.gm")).toBe("Gmail app");
    expect(referrerLabel("news.ycombinator.com")).toBe("news.ycombinator.com");
  });
  it("badges each referrer with the first letter of its name", () => {
    expect(referrerInitial("t.co")).toBe("X");
    expect(referrerInitial("google.com")).toBe("G");
    expect(referrerInitial("com.google.android.gm")).toBe("G");
  });
});
