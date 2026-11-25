// Explicit loopback-only browser fixture. Never imported by the application or Docker build.
import http from "node:http";
if (!process.argv.includes("--local-fixture"))
  throw new Error("Pass --local-fixture to run the disposable sample API");
const credential = "local-preview-only";
let loggedIn = false;
let mustChangePassword = false;
const accounts = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.test",
    isMaster: true,
    status: "active",
    mustChangePassword: false,
    permissions: ["reports.read", "dashboard.access"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "research@example.test",
    isMaster: false,
    status: "active",
    mustChangePassword: false,
    permissions: ["reports.read"],
  },
];
const stamp = "2026-11-07T17:30:00Z";
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3072");
  response.setHeader("Cache-Control", "no-store");
  const send = (data, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  let raw = "";
  for await (const part of request) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  const path = url.pathname.replace("/api/admin/", "");
  if (path === "auth/session" && request.method === "POST") {
    if (body.email !== "admin@example.test" || body.password !== credential)
      return send(
        { message: "Use the documented local fixture credentials." },
        401,
      );
    loggedIn = true;
    response.setHeader(
      "Set-Cookie",
      "oren_admin_fixture=1; HttpOnly; SameSite=Lax; Path=/api/admin",
    );
    return send({ csrfToken: "fixture-csrf", mustChangePassword });
  }
  if (!loggedIn || !request.headers.cookie?.includes("oren_admin_fixture=1"))
    return send({ message: "Sign in to the local fixture" }, 401);
  if (path === "auth/session" && request.method === "GET")
    return send({
      ...accounts[0],
      mustChangePassword,
      csrfToken: "fixture-csrf",
      preview: true,
    });
  if (path === "auth/session/logout") {
    loggedIn = false;
    response.setHeader(
      "Set-Cookie",
      "oren_admin_fixture=; Max-Age=0; Path=/api/admin",
    );
    response.writeHead(204);
    return response.end();
  }
  if (path === "auth/accounts" && request.method === "GET")
    return send(accounts);
  if (path === "auth/accounts" && request.method === "POST") {
    if (!body.permissions?.length)
      return send({ message: "Choose at least one permission." }, 400);
    accounts.push({
      id: crypto.randomUUID(),
      email: body.email,
      isMaster: false,
      status: "invited",
      mustChangePassword: true,
      permissions: body.permissions,
    });
    return send({
      email: body.email,
      temporaryPassword: "sample-temporary-password",
      expiresAt: "2026-11-08T17:30:00Z",
    });
  }
  if (/auth\/accounts\/.+\/revoke/.test(path)) {
    const account = accounts.find((item) => item.id === path.split("/")[2]);
    if (account) account.status = "revoked";
    response.writeHead(204);
    return response.end();
  }
  if (/auth\/accounts\/.+\/temporary-password/.test(path))
    return send({
      temporaryPassword: "sample-replacement-password",
      expiresAt: "2026-11-08T17:30:00Z",
    });
  const from = url.searchParams.get("from") || "2026-10-24",
    to = url.searchParams.get("to") || "2026-11-06";
  const days = [];
  for (
    let date = new Date(from);
    date <= new Date(to) && days.length < 366;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const index = days.length;
    days.push({
      day: date.toISOString().slice(0, 10),
      status: "exact",
      value: Math.round(180 + index * 13 + Math.sin(index * 0.72) * 70),
      source: "beacon",
    });
  }
  const count = (value) => ({ status: "exact", value });
  const traffic = {
    timezone: url.searchParams.get("timezone") || "Africa/Lagos",
    daily: days,
    pageviews: count(days.reduce((sum, day) => sum + day.value, 0)),
    dailyUniques: {
      days: days.map((day) => ({
        day: day.day,
        value: Math.floor(day.value * 0.54),
      })),
    },
    distinctDurableVisitorsFirstSeenInRange: count(1024),
  };
  if (path === "dashboard/activity")
    return send({ volumeUsd: 10842.50, trades: 81, chats: 47, messages: 119 });
  if (path === "reports/traffic") return send(traffic);
  if (path === "reports/breakdowns") {
    const rows = (entries) =>
      entries.map(([key, visits]) => ({ key, visits, pageviews: Math.round(visits * 2.4) }));
    const referrers = rows([
      ["t.co", 412], ["google.com", 238], ["com.google.android.gm", 61], ["news.ycombinator.com", 44],
      ["reddit.com", 37], ["docs.oren.finance", 29], ["github.com", 18], ["linkedin.com", 11],
      ["duckduckgo.com", 7], ["bing.com", 6], ["youtube.com", 4], ["t.me", 3],
    ]);
    const countries = rows([
      ["NG", 611], ["US", 284], ["GB", 121], ["IN", 74], ["DE", 52], ["CA", 41],
      ["GH", 33], ["FR", 21], ["KE", 17], ["ZA", 12], ["BR", 9], ["AE", 6],
    ]);
    const total = (list) => list.reduce((sum, item) => sum + item.visits, 0);
    return send({
      timezone: traffic.timezone,
      unit: "visits",
      note: "A visit is a session. One that crosses midnight counts on each day.",
      referrers: { total: total(referrers), rows: referrers, otherVisits: 0, missing: 532 },
      countries: { total: total(countries), rows: countries, otherVisits: 0, missing: 88 },
      geolocation: { provider: "DB-IP", attributionUrl: "https://db-ip.com", database: "2026-11" },
    });
  }
  if (path === "reports/daily") {
    response.writeHead(200, { "Content-Type": "text/csv" });
    return response.end(
      "day,status,pageviews\n" +
        days.map((day) => `${day.day},${day.status},${day.value}`).join("\n"),
    );
  }
  const slice = {
    key: `${from}:${to}`,
    setupEvents: 148,
    setupSessions: 126,
    connections: 58,
    connectedAccounts: 47,
    activeConnections: 52,
    revokedGrants: 6,
    oauthRefused: 9,
    oauthFailed: 3,
    oauthExpired: 2,
    researchCalls: 91,
    researchAccounts: 32,
    repeatResearchAccounts: 14,
    mcpResearchActivation: { calls: 5, accounts: 3 },
    mcpStockContext: { calls: 213, accounts: 38 },
  };
  if (path === "reports/funnel" || path === "reports/retention")
    return send({
      slices: [slice],
      trades: {
        preparations: { browser: 23, delegated: 17, unlinkedBrowser: 0 },
        confirmed: { browser: 15, delegated: 12, unlinkedBrowser: 0 },
        uniqueActivatedAccounts: 14,
      },
      researchRetention7d: { ...count(12), retained: 12, denominator: 28 },
      researchRetention30d: {
        status: "unavailable",
        value: null,
        denominator: 0,
        reason: "window_not_elapsed_or_empty_cohort",
      },
    });
  if (path === "reports/compare")
    return send({
      denominator:
        url.searchParams.get("dimension") === "campaign"
          ? "pageviews"
          : "unavailable",
      minimumSample: 30,
      inference: "Rates are descriptive. No significance is claimed.",
      rows: ["mcp-launch", "community", "research-weekly", "(none)"].map(
        (key, index) => ({
          key,
          sampleSize: 560 - index * 120,
          connections: 21 - index * 5,
          researchAccounts: 14 - index * 3,
          connectionRate: 0.0375 - index * 0.004,
          researchRate: 0.025,
          significance: {
            status: "unavailable",
            reason: "significance_not_computed",
          },
        }),
      ),
    });
  if (path === "reports/coverage")
    return send({
      rawRetentionDays: 30,
      identityRetentionDays: 400,
      idempotencyRetentionDays: 90,
      attribution: { model: "first", windowDays: 7 },
      collectors: [{ source: "beacon", startedAt: "2026-10-29T00:25:00Z" }],
      definitions: {
        pageview:
          "One accepted document navigation after bot, prefetch, asset and internal filters.",
        dailyUniques:
          "Distinct durable visitor IDs that day. Never summed into lifetime uniques.",
        connection:
          "A server-confirmed OAuth grant. A click is not a connection.",
        research:
          "Successful in-app getStockResearch only. MCP stock context is counted separately.",
      },
    });
  if (path.startsWith("dashboard/")) {
    const view = path.split("/")[1];
    const index = Number(url.searchParams.get("page") || "1");
    const rows = Array.from({ length: index === 1 ? 8 : 3 }, (_, i) => {
      const userId = `did:privy:sample-account-${index}-${i}`;
      if (view === "users")
        return {
          userId,
          connections: 1 + (i % 3),
          activeConnections: 1,
          firstConnectedAt: "2026-10-29T10:00:00Z",
          lastConnectedAt: stamp,
        };
      if (view === "connections")
        return {
          grantId: `sample-grant-${i}`,
          clientId: [
            "claude-sample-client",
            "codex-sample-client",
            "cursor-sample-client",
          ][i % 3],
          userId,
          wallet: "sample-wallet-identifier",
          scopes: "oren.read oren.trade.prepare",
          createdAt: stamp,
          revokedAt: i === 4 ? stamp : null,
        };
      if (view === "trades")
        return {
          id: `sample-intent-${i}`,
          userId,
          ticker: ["NVDA", "AAPL", "TSLA", "SPCX"][i % 4],
          side: i % 2 ? "sell" : "buy",
          mode: i % 3 ? "browser" : "delegated",
          amountUsd: "20.00",
          amountShares: "0.05",
          status: ["confirmed", "confirmed", "prepared", "failed"][i % 4],
          createdAt: stamp,
          expiresAt: "2026-11-07T17:31:00Z",
        };
      return {
        id: `sample-audit-${i}`,
        actorId: accounts[0].id,
        targetId: accounts[1].id,
        action: ["login_succeeded", "invited", "password_changed", "revoked"][
          i % 4
        ],
        createdAt: stamp,
      };
    });
    return send({
      rows,
      page: index,
      hasNext: index === 1,
      note: "Disposable local fixture data. No production users, permissions or trades are affected.",
    });
  }
  send({ message: "Fixture endpoint not implemented" }, 404);
});
server.listen(3072, "127.0.0.1", () =>
  console.log(
    "Local sample API http://127.0.0.1:3072 · admin@example.test / local-preview-only",
  ),
);
