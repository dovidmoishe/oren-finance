import { afterEach, describe, expect, it, vi } from "vitest";
import { api, post, setCsrfToken, ApiError } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken("");
});
describe("admin requests", () => {
  it("uses same-origin cookies and an in-memory CSRF token, never a bearer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "admin" })));
    vi.stubGlobal("fetch", fetch);
    setCsrfToken("fixture-csrf");
    await post("auth/accounts", { email: "team@example.test" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/admin/auth/accounts");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.headers.get("X-Oren-Admin")).toBe("1");
    expect(init.headers.get("X-CSRF-Token")).toBe("fixture-csrf");
    expect(init.headers.has("Authorization")).toBe(false);
  });
  it("handles empty mutation responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    expect(await post("auth/session/logout")).toBeUndefined();
  });
  it("expires the visible session when a protected resource returns 401", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(api("dashboard/trades")).rejects.toBeInstanceOf(ApiError);
    expect(dispatchEvent.mock.calls[0][0].type).toBe("admin-session-expired");
  });
  it("preserves authorization failures instead of interpreting them as empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
        }),
      ),
    );
    await expect(api("reports/traffic")).rejects.toMatchObject({
      status: 403,
      message: "Forbidden",
    });
  });
});
