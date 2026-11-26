import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrafficChart } from "../src/reports";
import type { Day } from "../src/types";

const day = (date: string, value: number | null): Day =>
  value == null
    ? { day: date, status: "unavailable", value: null }
    : { day: date, status: "exact", value };

describe("daily pageviews chart", () => {
  it("keeps a dot on days whose neighbours have no data", () => {
    const html = renderToStaticMarkup(
      <TrafficChart
        days={[
          day("2026-11-01", 5),
          day("2026-11-02", null),
          day("2026-11-03", 7),
          day("2026-11-04", null),
          day("2026-11-05", 9),
          day("2026-11-06", 4),
        ]}
      />,
    );
    // 1 and 3 Nov stand alone and 6 Nov is the latest. 5 Nov is on a line.
    expect(html.match(/<circle/g)).toHaveLength(3);
    expect(html).toContain("2026-11-01: 5 pageviews (exact)");
    expect(html).toContain("2026-11-03: 7 pageviews (exact)");
    expect(html).not.toContain("2026-11-05: 9 pageviews");
    // Pageviews are counts, so the axis has no fractional ticks.
    expect(html).not.toMatch(/>\d+\.\d+</);
  });
});
