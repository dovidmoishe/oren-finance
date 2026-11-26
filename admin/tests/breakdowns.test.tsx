import type { UseQueryResult } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudiencePanels } from "../src/reports";
import type { Breakdowns } from "../src/types";

const report: Breakdowns = {
  timezone: "Africa/Lagos",
  unit: "visits",
  note: "A visit is a session.",
  referrers: {
    total: 16,
    rows: [
      { key: "t.co", visits: 10, pageviews: 31 },
      { key: "google.com", visits: 4, pageviews: 6 },
      { key: "news.ycombinator.com", visits: 2, pageviews: 2 },
    ],
    otherVisits: 0,
    missing: 4,
  },
  countries: {
    total: 20,
    rows: [
      { key: "NG", visits: 15, pageviews: 40 },
      { key: "US", visits: 5, pageviews: 9 },
    ],
    otherVisits: 0,
    missing: 1,
  },
  geolocation: {
    provider: "DB-IP",
    attributionUrl: "https://db-ip.com",
    database: "2026-11",
  },
};

function render(data: Breakdowns) {
  const query = {
    isPending: false,
    error: null,
    data,
    refetch: () => undefined,
  } as unknown as UseQueryResult<Breakdowns>;
  return renderToStaticMarkup(<AudiencePanels query={query} rows={2} />);
}

describe("audience panels", () => {
  it("lists referring sites and countries with their share of visits", () => {
    const html = render(report);
    expect(html).toContain("X (t.co)");
    expect(html).toContain("google.com");
    // The third referrer waits behind the expand control.
    expect(html).not.toContain("news.ycombinator.com");
    expect(html).toContain("Show all 3");
    // Referrer share counts direct visits in the whole: 10 of 20.
    expect(html).toContain("50.0%");
    expect(html).toContain("4 direct visits had no referring site.");
    expect(html).toContain("Nigeria");
    // Country share is of visits with a country: 15 of 20.
    expect(html).toContain("75.0%");
    expect(html).toContain("1 visit has no country");
    expect(html).toContain('href="https://db-ip.com"');
    expect(html).toContain("IP Geolocation by DB-IP");
    // Flags use the bundled Twemoji font, credited under CC BY 4.0.
    expect(html).toContain("font-flag");
    expect(html).toContain("\u{1F1F3}\u{1F1EC}");
    expect(html).toContain('href="https://github.com/twitter/twemoji"');
    expect(html).toContain("CC BY 4.0");
  });

  it("links to the full lists from the overview instead of expanding", () => {
    const query = {
      isPending: false,
      error: null,
      data: report,
      refetch: () => undefined,
    } as unknown as UseQueryResult<Breakdowns>;
    // "View all" is a router link, so this render needs a router.
    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/traffic" }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const html = renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <AudiencePanels query={query} rows={2} overview />
      </RouterContextProvider>,
    );
    expect(html).toContain('href="/traffic"');
    expect(html).not.toContain("Show all 3");
  });

  it("says when countries are not being recorded", () => {
    const html = render({
      ...report,
      countries: { total: 0, rows: [], otherVisits: 0, missing: 7 },
      referrers: { total: 0, rows: [], otherVisits: 0, missing: 0 },
      geolocation: { ...report.geolocation, database: null },
    });
    expect(html).toContain("Countries aren’t being recorded yet.");
    expect(html).toContain("The location database isn’t loaded");
    expect(html).toContain("No visits came from another site in these dates.");
    expect(html).not.toContain("direct visit");
  });
});
