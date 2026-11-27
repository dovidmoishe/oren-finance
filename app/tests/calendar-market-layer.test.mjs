import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function compile(path, resolve = () => undefined) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  // Same realm as the test, so arrays and objects compare structurally.
  new Function("exports", "require", code)(exports, (id) => resolve(id) ?? require(id));
  return exports;
}

const cn = (...values) => values.filter(Boolean).join(" ");
const layer = compile("../components/calendar/market-layer.ts");
const stubs = (id) => {
  if (id === "lucide-react") return new Proxy({}, { get: () => () => null });
  if (id === "@/components/ui/utils") return { cn };
  if (id === "@/components/ui")
    return {
      cn,
      formatDate: (date) => date,
      weekdayLabels: () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    };
  if (id === "./market-layer") return layer;
  return undefined;
};
const panel = compile("../components/calendar/day-panel.tsx", stubs);
const grid = compile("../components/calendar/month-grid.tsx", stubs);

// Intl separates the clock from AM/PM with a narrow no-break space.
const plain = (text) => text.replace(/\s/g, " ");
const render = (component, props) => plain(renderToStaticMarkup(createElement(component, props)));

const closures2026 = [
  { date: "2026-11-26", weekday: "Thu", kind: "full_close", name: "Thanksgiving Day", closeEt: null, closeUtc: null, source: "official", provisional: false },
  { date: "2026-11-27", weekday: "Fri", kind: "early_close", name: "Day after Thanksgiving", closeEt: "13:00", closeUtc: "2026-11-27T18:00:00.000Z", source: "official", provisional: false },
];

function release(overrides) {
  return {
    id: overrides.id ?? overrides.kind,
    family: "macro",
    kind: "cpi",
    title: "Consumer Price Index (CPI)",
    country: "US",
    agencyId: "bls",
    agency: "U.S. Bureau of Labor Statistics",
    scheduledAt: "2026-11-10T13:30:00.000Z",
    dateEt: "2026-11-10",
    timeEt: "08:30",
    timePrecision: "datetime",
    timeBasis: "published",
    dateBasis: "published",
    status: "released",
    actual: 0.4,
    previous: 0.6,
    unit: "percent_change",
    unitLabel: "% change from prior month",
    actualText: "+0.4%",
    previousText: "+0.6%",
    referencePeriod: "2026-10",
    referenceLabel: "October 2026",
    sourceUrl: "https://www.bls.gov/schedule/news_release/cpi.htm",
    dataSourceUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
    retrievedAt: "2026-11-10T13:45:00.000Z",
    updatedAt: "2026-11-10T13:45:00.000Z",
    ...overrides,
  };
}

const window = (startUtc, endUtc) => ({ startEt: "", endEt: "", startUtc, endUtc });
function hours(date, closeUtc = `${date}T21:00:00.000Z`) {
  return {
    date,
    tradingDay: true,
    earlyClose: !closeUtc.endsWith("T21:00:00.000Z"),
    holidayName: null,
    closedReason: null,
    provisional: false,
    regularOpenUtc: `${date}T14:30:00.000Z`,
    regularCloseUtc: closeUtc,
    sessions: {
      preMarket: window(`${date}T09:00:00.000Z`, `${date}T14:30:00.000Z`),
      regular: window(`${date}T14:30:00.000Z`, closeUtc),
      afterHours: window(closeUtc, `${date}T01:00:00.000Z`.replace(date, layer.addDays(date, 1))),
    },
  };
}

test("month dates and weekdays follow the civil calendar", () => {
  assert.equal(layer.monthDates("2026-02").length, 28);
  assert.equal(layer.monthDates("2028-02").at(-1), "2028-02-29");
  assert.deepEqual(layer.monthDates("2026-11").slice(0, 2), ["2026-11-01", "2026-11-02"]);
  assert.equal(layer.weekdayOf("2026-11-01"), 0);
  assert.equal(layer.weekdayOf("2026-11-27"), 5);
  assert.equal(layer.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(layer.civilDate("Pacific/Kiritimati", new Date("2026-11-27T12:00:00Z")), "2026-11-28");
  assert.equal(layer.civilDate("America/New_York", new Date("2026-11-28T03:00:00Z")), "2026-11-27");
});

test("NYSE status marks weekends, full closes and early closes", () => {
  const days = layer.marketDays(layer.monthDates("2026-11"), closures2026);
  assert.equal(days.get("2026-11-25").status, "open");
  assert.equal(days.get("2026-11-26").status, "holiday");
  assert.equal(days.get("2026-11-26").name, "Thanksgiving Day");
  assert.equal(days.get("2026-11-27").status, "early_close");
  assert.equal(days.get("2026-11-28").status, "weekend");
  assert.equal(layer.marketDays(["2026-11-26"], undefined), undefined, "no closures means unknown, not open");
});

test("session share is a full day, a 1 p.m. early close, or nothing", () => {
  const days = layer.marketDays(layer.monthDates("2026-11"), closures2026);
  assert.equal(layer.sessionShare(days.get("2026-11-25")), 1);
  assert.equal(layer.sessionShare(days.get("2026-11-27")).toFixed(3), (210 / 390).toFixed(3));
  assert.equal(layer.sessionShare(days.get("2026-11-26")), 0);
  assert.equal(layer.sessionShare(days.get("2026-11-28")), 0);
  assert.equal(layer.sessionShare(undefined), 0);
  assert.equal(layer.progressBetween("2026-11-27T16:15:00.000Z", "2026-11-27T14:30:00.000Z", "2026-11-27T18:00:00.000Z"), 0.5);
  assert.equal(layer.progressBetween("2026-11-27T20:00:00.000Z", "2026-11-27T14:30:00.000Z", "2026-11-27T18:00:00.000Z"), 1);
});

test("releases group by New York date, and only market movers count as high impact", () => {
  const byDate = layer.eventsByDate([
    release({ id: "claims", kind: "jobless_claims", dateEt: "2026-11-25", scheduledAt: "2026-11-25T13:30:00.000Z" }),
    release({ id: "gdp", kind: "gdp", dateEt: "2026-11-25", scheduledAt: "2026-11-25T13:30:00.000Z" }),
    release({ id: "pce", kind: "pce", dateEt: "2026-11-25", scheduledAt: "2026-11-25T15:00:00.000Z" }),
    release({ id: "cancelled", kind: "fomc_decision", dateEt: "2026-11-25", status: "cancelled" }),
  ]);
  assert.deepEqual(byDate.get("2026-11-25").map((event) => event.id), ["gdp", "claims", "pce"]);
  assert.deepEqual(["fomc_decision", "cpi", "employment_situation", "pce", "gdp"].map(layer.isHighImpact), [true, true, true, true, true]);
  assert.deepEqual(["ppi", "retail_sales", "jobless_claims"].map(layer.isHighImpact), [false, false, false]);
});

test("the current month loads two weeks of releases past its end", () => {
  assert.deepEqual(layer.eventsRange("2026-11", "2026-11-27"), { from: "2026-11-01", to: "2026-12-11" });
  assert.deepEqual(layer.eventsRange("2026-11", "2026-11-03"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(layer.eventsRange("2026-10", "2026-11-27"), { from: "2026-10-01", to: "2026-10-31" });
});

test("clocks drop :00 on the hour and compare with the viewer's zone", () => {
  assert.equal(plain(layer.formatShortClock("2026-11-27T18:00:00.000Z", "en-US", layer.NEW_YORK)), "1 PM");
  assert.equal(plain(layer.formatShortClock("2026-11-27T14:30:00.000Z", "en-US", layer.NEW_YORK)), "9:30 AM");
  assert.equal(layer.sharesNewYorkClock("2026-11-27T14:30:00.000Z", "America/Toronto"), true);
  assert.equal(layer.sharesNewYorkClock("2026-11-27T14:30:00.000Z", "Europe/London"), false);
});

test("the month grid draws session bars, hatches holidays and labels only market movers", () => {
  const dates = layer.monthDates("2026-11");
  const html = render(grid.MonthGrid, {
    dates,
    today: "2026-11-27",
    activeDate: "2026-11-10",
    onSelect() {},
    portfolioDays: new Map([["2026-11-10", { date: "2026-11-10", hasData: true, pnlUsd: 1234, returnPct: 1.2, significantEvents: [] }]]),
    marketDays: layer.marketDays(dates, closures2026),
    releases: layer.eventsByDate([
      release({}),
      release({ id: "claims", kind: "jobless_claims", dateEt: "2026-11-19", scheduledAt: "2026-11-19T13:30:00.000Z" }),
    ]),
    maxMove: 1234,
    todayProgress: 0.5,
  });
  // 30 days: 20 trading days with a bar, 19 full and one early close.
  assert.equal((html.match(/width:100%/g) ?? []).length, 19);
  assert.match(html, /width:53\.8\d*%/);
  assert.match(html, /width:50%/, "today's progress fills half of its bar");
  assert.equal((html.match(/repeating-linear-gradient\(135deg,var\(--color-border\)_0_1px/g) ?? []).length, 1, "only Thanksgiving is hatched");
  assert.ok(html.includes(">CPI<"));
  assert.ok(!html.includes(">Claims<"), "weekly claims get a dot, not a label");
  assert.ok(html.includes("+$1.2K"));
  assert.ok(html.includes("bg-heat-up-2"));
  assert.ok(!html.includes("heat-up-3"), "the saturated step is never used");
  assert.ok(html.includes('aria-label="Thu, Nov 26 · Closed for Thanksgiving Day"'));
  assert.ok(html.includes('title="Tue, Nov 10 · Your P&amp;L +$1,234.00 · Regular hours · CPI inflation"'), "hover says the whole day");
  for (const text of ["Your daily P&amp;L", "Market hours", "Early close", "Holiday", "Major release", "Other release"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes('aria-pressed="true"'));
});

test("a day is one timeline of releases and the viewer's trades; the strip carries open and close", () => {
  const html = render(panel.DayPanel, {
    date: "2026-11-10",
    timeZone: "Europe/London",
    showMarket: true,
    showPortfolio: true,
    hours: hours("2026-11-10"),
    marketDay: { date: "2026-11-10", status: "open", name: null, closeUtc: null, provisional: false },
    releases: [release({})],
    summary: { date: "2026-11-10", hasData: true, pnlUsd: 42.5, returnPct: 1.25, significantEvents: [] },
    day: {
      date: "2026-11-10",
      summary: { significantEvents: [] },
      walletActivity: [],
      contributors: [{ assetId: "nvda", ticker: "NVDA", valueChangeUsd: 30, valueChangePct: 2 }],
      trades: [{ id: "t1", type: "stock_purchase", ticker: "NVDA", amountUsd: 200, status: "confirmed", occurredAt: "2026-11-10T15:42:00.000Z" }],
    },
    now: Date.parse("2026-11-10T16:00:00.000Z"),
  });
  const order = ["CPI inflation", "Bought NVDA"].map((text) => html.indexOf(text));
  assert.ok(!html.includes("Market opens") && !html.includes("Market closes"));
  assert.ok(order.every((index) => index > 0), order.join(","));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const text of ["Tuesday, November 10", "Regular hours", "Your P&amp;L", "+$42.50", "+1.25%", "+0.4%", "prev +0.6%", "October 2026 · vs prior month", "$200.00", ">You<", "Pre-market", "Regular", "After hours", "Your biggest moves", "+$30.00", "8:30 AM"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('title="1:30 PM your time"'));
  assert.ok(html.includes('href="https://www.bls.gov/news.release/cpi.nr0.htm"') && html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('role="img"'), "the session strip is drawn");
});

test("a released figure Oren hasn't stored never shows a number", () => {
  const html = render(panel.DayPanel, {
    date: "2026-11-25",
    timeZone: "America/New_York",
    showMarket: true,
    showPortfolio: false,
    hours: hours("2026-11-25"),
    releases: [release({ kind: "gdp", actual: null, actualText: null, previousText: null, dataSourceUrl: null, dateEt: "2026-11-25" })],
  });
  assert.ok(html.includes("Pending"));
  assert.ok(!html.includes("—"));
  assert.ok(!html.includes("prev"));
  assert.ok(!html.includes("your time"), "New York viewers see one clock");
});

test("a closed day explains on-chain trading and draws no session", () => {
  const html = render(panel.DayPanel, {
    date: "2026-11-26",
    timeZone: "UTC",
    showMarket: true,
    showPortfolio: false,
    marketDay: { date: "2026-11-26", status: "holiday", name: "Thanksgiving Day", closeUtc: null, provisional: false },
    releases: [],
  });
  assert.ok(html.includes("Closed for Thanksgiving Day"));
  assert.ok(html.includes("still trade on-chain"));
  assert.ok(!html.includes('role="img"'));
  assert.ok(!html.includes("No releases or activity"));
});

test("agency notices render unchanged with every source", () => {
  const notices = [
    "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.",
    "This product uses the Bureau of Economic Analysis (BEA) Data API but is not endorsed or certified by BEA.",
  ];
  const html = render(panel.MarketSources, {
    response: {
      attribution: {
        sources: [
          { id: "bls", name: "U.S. Bureau of Labor Statistics", url: "https://www.bls.gov/" },
          { id: "bea", name: "U.S. Bureau of Economic Analysis", url: "https://www.bea.gov/" },
        ],
        notices,
      },
    },
  });
  for (const notice of notices) assert.ok(html.includes(notice), notice);
  assert.ok(html.includes("U.S. Bureau of Labor Statistics and U.S. Bureau of Economic Analysis"));
  assert.equal(render(panel.MarketSources, { response: { attribution: { sources: [], notices: [] } } }), "");
});

const recapModule = compile("../components/calendar/day-recap.tsx", stubs);

function move(ticker, changePct) {
  return { assetId: ticker.toLowerCase(), ticker, name: ticker, close: 100, previousClose: 100, previousDate: "2026-11-24", changePct };
}

test("the day recap shows index moves, movers and that day's headlines", () => {
  const recap = {
    date: "2026-11-25",
    status: "complete",
    indexes: [{ ...move("SPY", -0.29), name: "S&P 500" }, { ...move("QQQ", -0.94), name: "Nasdaq 100" }],
    gainers: [move("MSTR", 4.36)],
    losers: [move("ORCL", -4.8)],
    releases: [],
    headlines: [{ headline: "Stocks slip before the holiday", source: "Yahoo Finance", url: "https://example.com/a", publishedAt: "2026-11-25T21:00:00.000Z", ticker: "SPY" }],
    headlinesAvailable: true,
  };
  const html = render(recapModule.DayRecap, { date: "2026-11-25", recap });
  for (const text of ["The market", "Wed, Nov 25", "Indexes", "S&amp;P 500", "-0.29%", "Movers", ">Up<", "MSTR", "+4.36%", ">Down<", "ORCL", "-4.80%", "Headlines", "Stocks slip before the holiday", "Yahoo Finance · 4:00 PM ET"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('href="https://example.com/a"') && html.includes('rel="noopener noreferrer"'));
  const at = (extra) => render(recapModule.DayRecap, { date: "2026-11-25", recap: { ...recap, ...extra } });
  assert.ok(at({ status: "closed" }).includes("On-chain while closed"));
  assert.ok(at({ status: "in_progress" }).includes("The market so far"));
  assert.equal(at({ status: "upcoming" }), "");
  assert.equal(at({ indexes: [], gainers: [], losers: [], headlines: [] }), "");
  assert.equal(render(recapModule.DayRecap, { date: "2026-11-26", recap }), "", "a stale recap for another day never shows");
  assert.ok(render(recapModule.DayRecap, { date: "2026-11-25", failed: true }).includes("Market recap unavailable."));
});

test("the day panel offers Ask Oren only with a handler and a reminder on upcoming releases", () => {
  const base = {
    date: "2026-12-09",
    timeZone: "America/New_York",
    showMarket: true,
    showPortfolio: false,
    hours: hours("2026-12-09"),
    releases: [release({ id: "fomc", kind: "fomc_decision", status: "scheduled", actualText: null, scheduledAt: "2026-12-09T19:00:00.000Z", dateEt: "2026-12-09" })],
  };
  assert.ok(!render(panel.DayPanel, base).includes("Ask Oren about this day"));
  const html = render(panel.DayPanel, { ...base, onAsk() {}, reminder: (event) => createElement("button", { "data-reminder": event.id }) });
  assert.ok(html.includes("Ask Oren about this day"));
  assert.ok(html.includes('data-reminder="fomc"'));
});
