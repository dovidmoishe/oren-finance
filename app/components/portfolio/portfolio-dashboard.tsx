"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { MarketChartRange } from "@/components/charts/market-chart";
import { Button, EmptyState, ErrorState } from "@/components/ui";
import { OrenLogo } from "@/components/brand/oren-logo";
import { usePortfolioRefresh } from "@/hooks/use-portfolio-refresh";
import { useOrenAuth } from "@/components/auth/auth-context";
import { RestoreActions, restoreBlocked } from "@/components/auth/restore-actions";
import { useT } from "@/i18n/i18n";
import { usePortfolioStore, useWalletStore } from "@/store";
import type { PortfolioRange } from "@/types";
import { PortfolioSkeleton } from "./portfolio-skeleton";
import { PortfolioAllocation, PortfolioSummaryCard } from "./portfolio-summary-card";
import { PortfolioTables } from "./portfolio-tables";

const MarketChart = dynamic(() => import("@/components/charts/market-chart").then((mod) => mod.MarketChart));
const chartRangeToPortfolioRange: Record<MarketChartRange, PortfolioRange> = {
  "24H": "1D",
  "7D": "1W",
  "30D": "1M",
  "90D": "3M",
  "1Y": "1Y",
};

export function PortfolioDashboard() {
  const auth = useOrenAuth();
  const t = useT();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const history = usePortfolioStore((state) => state.history);
  const activity = usePortfolioStore((state) => state.activity);
  const isLoading = usePortfolioStore((state) => state.isLoading);
  const error = usePortfolioStore((state) => state.error);
  const reset = usePortfolioStore((state) => state.reset);
  const [range, setRange] = useState<MarketChartRange>("7D");
  const [hidden, setHidden] = useState(false);
  const refresh = usePortfolioRefresh(chartRangeToPortfolioRange[range]);

  useEffect(() => {
    if (!wallet || !connected) {
      reset();
      return;
    }
    void refresh();
  }, [connected, refresh, reset, wallet]);

  const chartData = useMemo(() => history.map((snapshot) => ({
    timestamp: snapshot.timestamp,
    value: snapshot.totalValueUsd,
  })), [history]);

  if (!connected) {
    if (!auth.ready && !restoreBlocked(auth)) {
      return (
        <div className="space-y-4">
          <p className="sr-only" role="status">{t("portfolio.restoringTitle")}</p>
          <PortfolioSkeleton />
        </div>
      );
    }
    return (
      <EmptyState
        className="min-h-[55dvh] border-solid border-accent-lavender/40 bg-linear-to-b from-accent-lavender/20 via-panel to-panel shadow-none [&>h3]:mt-4 [&>h3]:text-2xl [&>h3]:font-medium [&>h3]:tracking-tight [&>p]:mt-3 [&>p]:leading-6 [&>div]:mt-6"
        icon={<OrenLogo size={40} />}
        action={
          restoreBlocked(auth) ? <RestoreActions signInLabel={t("portfolio.signIn")} />
            : auth.authenticated
              ? auth.error && <Button disabled={auth.busy} onClick={() => void auth.createWallet()}>{t("portfolio.retryWallet")}</Button>
              : <Button disabled={auth.configured === false} onClick={auth.open}>{t("portfolio.signIn")}</Button>
        }
        description={restoreBlocked(auth) ? t("auth.restoreSlow") : auth.authenticated ? auth.error || t("portfolio.preparingDescription") : auth.configured === false ? t("account.signInUnavailable") : t("portfolio.signedOutDescription")}
        title={restoreBlocked(auth) ? t("auth.restoreSlowTitle") : auth.authenticated ? auth.error ? t("portfolio.walletRetryTitle") : t("portfolio.preparingTitle") : t("portfolio.signedOutTitle")}
      />
    );
  }

  const current = portfolio?.wallet === wallet ? portfolio : undefined;
  if (!current) {
    return error && !isLoading ? <ErrorState description={error} onRetry={() => void refresh()} /> : <PortfolioSkeleton />;
  }

  return (
    <div className="mx-auto max-w-[75rem] space-y-5 @lg:space-y-7">
      {error ? <ErrorState description={error} onRetry={() => void refresh()} /> : null}
      <PortfolioSummaryCard
        hidden={hidden}
        onDeposit={auth.openDeposit}
        onToggleHidden={() => setHidden(!hidden)}
        portfolio={current}
      />
      <PortfolioTables
        activity={activity}
        allocation={<PortfolioAllocation hidden={hidden} portfolio={current} />}
        hidden={hidden}
        history={!hidden ? (
          <MarketChart
            activeRange={range}
            className="rounded-none border-0 shadow-none"
            compact
            lineData={chartData}
            loading={isLoading && history.length === 0}
            mode="line"
            onRangeChange={setRange}
            showSummary={false}
          />
        ) : undefined}
        isLoading={isLoading}
        onRefresh={() => void refresh()}
        positions={current.positions}
      />
    </div>
  );
}
