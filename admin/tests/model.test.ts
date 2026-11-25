import { describe, expect, it } from "vitest";
import {
  formatCount,
  hasPermission,
  initialRange,
  trafficCoverage,
  percent,
  totalSlice,
  validRange,
} from "../src/model";
import type { Session } from "../src/types";

describe("report presentation", () => {
  it("keeps missing metrics distinct from measured zero", () => {
    expect(formatCount({ status: "unavailable", value: null })).toBe("?");
    expect(formatCount({ status: "unavailable", value: 99 })).toBe("?");
    expect(formatCount({ status: "exact", value: 0 })).toBe("0");
    expect(formatCount({ status: "partial", value: 12 })).toBe("12");
    expect(percent(null)).toBe("?");
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
