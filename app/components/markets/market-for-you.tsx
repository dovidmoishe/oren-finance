"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { getMarketForYou, type MarketForYouResult } from "@/services/market-service";
import { MarketStockLogo } from "./market-stock-logo";

export function MarketForYou() {
  const auth = useOrenAuth();
  if (!auth.ready || !auth.authenticated || !auth.userId) return null;
  return <ForYouSection key={auth.userId} getAccessToken={auth.getAccessToken} />;
}

function ForYouSection({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const t = useT();
  const [result, setResult] = useState<MarketForYouResult | "loading" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const tokenProvider = useRef(getAccessToken);
  const pending = useRef<AbortController | null>(null);

  useLayoutEffect(() => { tokenProvider.current = getAccessToken; }, [getAccessToken]);
  useLayoutEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void getMarketForYou(tokenProvider.current, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => {
      if (!controller.signal.aborted) setResult("error");
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section aria-labelledby="market-for-you-heading" className="rounded-3xl border border-border bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="market-for-you-heading" className="font-display text-lg font-semibold">{t("marketForYou.title")}</h2>
        {typeof result === "object" && result.state !== "no_preferences" && (
          <Button href="/app/settings/preferences" size="sm" variant="ghost">{t("marketForYou.edit")}</Button>
        )}
      </div>
      {result === "loading" && <p className="mt-2 text-sm text-muted" role="status">{t("markets.loadingData")}</p>}
      {result === "error" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted" role="status">{t("marketForYou.error")}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => {
            setResult("loading");
            setAttempt((value) => value + 1);
          }}>{t("preferences.retry")}</Button>
        </div>
      )}
      {typeof result === "object" && result.state === "no_preferences" && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">{t("marketForYou.chooseDetail")}</p>
          <Button href="/app/settings/preferences" size="sm" variant="secondary">{t("marketForYou.choose")}</Button>
        </div>
      )}
      {typeof result === "object" && result.state === "no_matches" && (
        <p className="mt-2 text-sm text-muted">{t("marketForYou.empty")}</p>
      )}
      {typeof result === "object" && result.state === "ready" && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((stock) => (
            <li key={stock.assetId} className="min-w-0">
              <Link
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2"
                href={`/app/stocks/${encodeURIComponent(stock.assetId)}`}
                prefetch={false}
              >
                <MarketStockLogo stock={stock} />
                <span className="min-w-0">
                  <span className="block truncate text-sm"><strong>{stock.ticker}</strong> <span className="text-muted">{stock.name}</span></span>
                  <span className="block truncate text-xs text-muted">{t(`preferences.sectors.${stock.sectorId}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
