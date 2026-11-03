"use client";

import { useEffect } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { AppShell } from "@/components/shell";
import { Button, EmptyState } from "@/components/ui";
import { usePortfolioStore, useWalletStore } from "@/store";
import { ActivityList } from "./activity-list";

export function ActivityTimeline() {
  const auth = useOrenAuth();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const activity = usePortfolioStore((state) => state.activity);
  const error = usePortfolioStore((state) => state.error);
  const loadActivity = usePortfolioStore((state) => state.loadActivity);

  useEffect(() => {
    if (!wallet || !connected) return;
    void loadActivity(wallet);
  }, [connected, loadActivity, wallet]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl pb-20">
        <p className="text-sm text-muted">History</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">Activity</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          Trades for this wallet. Titan or Jupiter is shown when that route was saved with the trade.
        </p>
        <div className="mt-6">
          {!connected ? (
            <EmptyState
              action={auth.ready && !auth.authenticated ? <Button onClick={auth.open}>Sign in</Button> : undefined}
              description={auth.authenticated ? "Your trades will appear as soon as your wallet is ready." : "Sign in to see the routes used on your trades."}
              title={auth.authenticated ? "Preparing your wallet…" : "Sign in to see activity"}
            />
          ) : (
            <>
              {error ? <p className="mb-3 text-sm text-negative">{error}</p> : null}
              <ActivityList items={activity} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
