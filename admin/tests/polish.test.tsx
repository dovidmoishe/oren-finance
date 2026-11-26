import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { monotonePath } from "../src/chart-path";
import {
  isOrenHost,
  rangeLabel,
  referrerBrand,
  referrerTone,
} from "../src/model";
import { ReferrerIcon } from "../src/reports";
import { ReportProvider } from "../src/state";
import { DateFilters } from "../src/ui";

describe("date range", () => {
  it("labels ranges compactly, with both years only when they differ", () => {
    expect(rangeLabel("2026-11-13", "2026-11-26")).toBe("13 Nov – 26 Nov 2026");
    expect(rangeLabel("2025-12-28", "2026-01-03")).toBe(
      "28 Dec 2025 – 3 Jan 2026",
    );
    expect(rangeLabel("2026-11-26", "2026-11-26")).toBe("26 Nov 2026");
    expect(rangeLabel("2026-11-26", "2026-11-01")).toBe("Choose dates");
  });
  it("shows one date button and a timezone switch instead of inputs", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ReportProvider>
          <DateFilters />
        </ReportProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("· Last 14 days");
    expect(html).not.toContain('type="date"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>WAT</);
  });
  it("names UTC days on reports that only use UTC", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ReportProvider>
          <DateFilters utcOnly />
        </ReportProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain("UTC days");
    expect(html).not.toContain(">WAT<");
  });
});

describe("referrer icons", () => {
  it("matches brands by host and subdomain, including Google's country sites", () => {
    expect(referrerBrand("t.co")?.title).toBe("X");
    expect(referrerBrand("mobile.twitter.com")?.title).toBe("X");
    expect(referrerBrand("mail.google.com")?.title).toBe("Gmail");
    expect(referrerBrand("com.google.android.gm")?.title).toBe("Gmail");
    expect(referrerBrand("google.co.uk")?.title).toBe("Google");
    expect(referrerBrand("news.ycombinator.com")?.title).toBe("Y Combinator");
    expect(referrerBrand("notgithub.com")).toBeUndefined();
    expect(referrerBrand("example.com")).toBeUndefined();
  });
  it("uses Oren's mark for its own sites and a stable tint for the rest", () => {
    expect(isOrenHost("docs.oren.finance")).toBe(true);
    expect(isOrenHost("oren.finance")).toBe(true);
    expect(isOrenHost("notoren.finance")).toBe(false);
    expect(referrerTone("example.com")).toBe(referrerTone("example.com"));
    expect(renderToStaticMarkup(<ReferrerIcon host="t.co" />)).toContain(
      'data-brand="X"',
    );
    expect(
      renderToStaticMarkup(<ReferrerIcon host="docs.oren.finance" />),
    ).toContain('src="/oren-mark.svg"');
    expect(renderToStaticMarkup(<ReferrerIcon host="example.com" />)).toContain(
      ">E</span>",
    );
  });
});

describe("chart curve", () => {
  it("never bends past the values it joins", () => {
    const points: [number, number][] = [
      [0, 80],
      [10, 20],
      [20, 25],
      [30, 90],
      [40, 90],
      [50, 10],
    ];
    const path = monotonePath(points);
    const controls = [...path.matchAll(/C([\d.,\s-]+)/g)].map((match) =>
      match[1]
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number)),
    );
    expect(controls).toHaveLength(points.length - 1);
    controls.forEach(([first, second], index) => {
      const low = Math.min(points[index][1], points[index + 1][1]);
      const high = Math.max(points[index][1], points[index + 1][1]);
      for (const [, y] of [first, second]) {
        expect(y).toBeGreaterThanOrEqual(low - 0.01);
        expect(y).toBeLessThanOrEqual(high + 0.01);
      }
    });
    expect(monotonePath([[0, 5]])).toBe("M0,5");
    expect(monotonePath([[0, 5], [10, 7]])).toBe("M0,5L10,7");
  });
});
