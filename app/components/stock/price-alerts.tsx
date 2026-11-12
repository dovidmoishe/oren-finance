"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { apiRequest } from "@/services/api-client";
import type { StockDetail } from "@/types";

type Alert = {
  id: string; variant: string; direction: "above" | "below"; target: string;
  state: "active" | "triggered";
};
type AlertList = { enabled: boolean; variants: string[]; alerts: Alert[] };
const inputClass = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";

export function StockPriceAlerts({ stock }: { stock: StockDetail }) {
  const auth = useOrenAuth();
  if (!auth.ready || !auth.authenticated || !auth.userId || stock.category !== "equity") return null;
  return <AlertPanel key={`${auth.userId}-${stock.assetId}`} stock={stock} getAccessToken={auth.getAccessToken} />;
}

function AlertPanel({ stock, getAccessToken }: {
  stock: StockDetail;
  getAccessToken: () => Promise<string | null>;
}) {
  const t = useT();
  const [result, setResult] = useState<AlertList>();
  const [opened, setOpened] = useState(false);
  const [mint, setMint] = useState("");
  const [direction, setDirection] = useState<Alert["direction"]>("above");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const tokenProvider = useRef(getAccessToken);
  useLayoutEffect(() => { tokenProvider.current = getAccessToken; }, [getAccessToken]);
  useLayoutEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void authenticated<AlertList>(tokenProvider.current, controller.signal, "", { assetId: stock.assetId })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => {})
      .finally(() => { if (request.current === controller) request.current = null; });
    return () => controller.abort();
  }, [stock.assetId]);

  async function mutate(body?: object, id?: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      if (id) {
        await authenticated(tokenProvider.current, controller.signal, `/${encodeURIComponent(id)}`, undefined, undefined, "DELETE");
      } else {
        await authenticated(tokenProvider.current, controller.signal, "", undefined, body, "POST");
      }
      const refreshed = await authenticated<AlertList>(tokenProvider.current, controller.signal, "", { assetId: stock.assetId });
      if (!controller.signal.aborted) {
        setResult(refreshed);
        if (!id) { setTarget(""); setOpened(false); }
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (!result || (!result.enabled && !result.alerts.length)) return null;
  const eligible = stock.variants.filter((variant) => result.variants.includes(variant.mint));
  const selectedMint = eligible.some((variant) => variant.mint === mint) ? mint : eligible[0]?.mint ?? "";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedMint) return;
    void mutate({ assetId: stock.assetId, mint: selectedMint, direction, target: target.trim().replace(",", ".") });
  }

  return (
    <section aria-labelledby="stock-alert-heading" className="space-y-3 rounded-3xl border border-border bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stock-alert-heading" className="font-display text-lg font-semibold">{t("priceAlerts.title")}</h2>
        {result.enabled && eligible.length > 0 && (
          <Button type="button" variant="secondary" size="sm" aria-expanded={opened} onClick={() => setOpened(!opened)}>
            {t("priceAlerts.open")}
          </Button>
        )}
      </div>
      {opened && result.enabled && eligible.length > 0 && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted">{t("priceAlerts.detail")}</p>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">{t("priceAlerts.variant")}
              <select className={inputClass} value={selectedMint} onChange={(event) => setMint(event.target.value)}>
                {eligible.map((variant) => (
                  <option key={variant.mint} value={variant.mint}>
                    {variant.name} ({variant.mint.slice(0, 5)}…{variant.mint.slice(-4)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">{t("priceAlerts.direction")}
              <select className={inputClass} value={direction} onChange={(event) => setDirection(event.target.value === "above" ? "above" : "below")}>
                <option value="above">{t("priceAlerts.above")}</option>
                <option value="below">{t("priceAlerts.below")}</option>
              </select>
            </label>
            <label className="text-sm font-medium">{t("priceAlerts.target")}
              <input className={inputClass} inputMode="decimal" maxLength={21} required value={target} onChange={(event) => setTarget(event.target.value)} />
            </label>
          </fieldset>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>{t("priceAlerts.create")}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-negative">{t("priceAlerts.error")}</p>}
      {result.alerts.length > 0 && (
        <ul className="divide-y divide-border">
          {result.alerts.map((alert) => (
            <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{alert.variant} · {t(`priceAlerts.${alert.direction}`)} ${alert.target} USD · {t(`priceAlerts.${alert.state}`)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(undefined, alert.id)}>
                {t("priceAlerts.cancel")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function authenticated<T>(
  getAccessToken: () => Promise<string | null>,
  signal: AbortSignal,
  path: string,
  query?: Record<string, string>,
  body?: object,
  method = "GET",
) {
  const token = await getAccessToken();
  signal.throwIfAborted();
  if (!token) throw new Error("Sign in to manage price alerts");
  return apiRequest<T>(`/me/price-alerts${path}`, {
    method, body, query, signal, cache: "no-store", headers: { Authorization: `Bearer ${token}` },
  });
}
