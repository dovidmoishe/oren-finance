"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePortfolioStore, useAgentStore } from "@/store";
import {
  predictionSearchKey,
  usePredictionsStore,
} from "@/store/predictions-store";
import type { PredictionSearch } from "@/types/predictions";
import { Button } from "@/components/ui";
import { PoweredByPanta, PredictionCard } from "./prediction-cards";

import { CreationRecovery } from "./creation-proposal";

export function PredictionsOverview() {
  const prefill = useAgentStore((s) => s.prefillPrompt);
  const router = useRouter(),
    params = useSearchParams();
  const marketId = params.get("marketId");
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const portfolio = usePortfolioStore((s) => s.portfolio),
    portfolioWallet = usePortfolioStore((s) => s.wallet);
  const loadPortfolio = usePortfolioStore((s) => s.loadPortfolio);
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [phase, setPhase] = useState(""),
    [holdings, setHoldings] = useState(false),
    [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("oren:predictions-refresh", refresh);
    return () =>
      window.removeEventListener("oren:predictions-refresh", refresh);
  }, []);
  const search = usePredictionsStore((s) => s.search),
    loadDetail = usePredictionsStore((s) => s.detail);
  const dialog = useRef<HTMLDialogElement>(null);
  const assetIds =
    holdings && wallet === portfolioWallet
      ? portfolio?.positions.map((p) => p.assetId).join(",")
      : undefined;
  useEffect(() => {
    if (wallet && holdings) void loadPortfolio(wallet);
  }, [wallet, holdings, loadPortfolio]);
  const input = useMemo(
    () => ({
      q,
      category: (category as PredictionSearch["category"]) || undefined,
      phase: (phase as PredictionSearch["phase"]) || undefined,
      page,
      assetIds: assetIds?.split(","),
    }),
    [q, category, phase, page, assetIds],
  );
  const key = predictionSearchKey(input);
  const entry = usePredictionsStore((s) => s.searches[key]);
  const detailEntry = usePredictionsStore((s) =>
    marketId ? s.details[marketId] : undefined,
  );
  const waitingHoldings =
    holdings && (!wallet || assetIds === undefined || !assetIds);
  const error = waitingHoldings
    ? !wallet
      ? "Connect a wallet to filter by holdings."
      : assetIds === undefined
        ? "Holdings are not available yet."
        : "No equity holdings to match."
    : entry?.error;
  const data = waitingHoldings ? undefined : entry?.data,
    loading = !waitingHoldings && (!entry || entry.loading);
  const detail = detailEntry?.data,
    detailError = detailEntry?.error;
  useEffect(() => {
    if (waitingHoldings) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void search(input, abort.signal);
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [input, search, waitingHoldings, revision]);
  useEffect(() => {
    if (!marketId) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    const abort = new AbortController();
    void loadDetail(marketId, abort.signal);
    return () => abort.abort();
  }, [marketId, loadDetail]);
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("marketId");
    router.replace(
      `/app/predictions${next.size ? "?" + next.toString() : ""}`,
      { scroll: false },
    );
  };
  return (
    <div className="space-y-6">
      <header>
        <Button
          variant="primary"
          className="float-right"
          onClick={() =>
            prefill(
              "Create a prediction market about [describe an investing event, assets, observation dates and sources]. Research it and prepare an editable proposal for my review.",
            )
          }
        >
          Create market
        </Button>
        <p className="text-sm text-muted">
          Events that matter to your portfolio
        </p>
        <h1 className="font-display text-4xl font-semibold">Predictions</h1>
        <p className="mt-2 text-sm text-muted">
          Discover investing events. Ask Oren to research the evidence when you
          want to go deeper.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 min-w-48">
          <span className="sr-only">Search events</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            maxLength={200}
            placeholder="Search stocks, inflation, interest rates…"
            className="w-full rounded-xl border border-border bg-panel p-3 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-border bg-panel p-3 text-sm"
          >
            <option value="">All investing</option>
            <option value="finance">Finance</option>
            <option value="crypto">Crypto</option>
            <option value="world">Macro economy</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Market phase</span>
          <select
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-border bg-panel p-3 text-sm"
          >
            <option value="">Active</option>
            {["primary", "secondary", "resolved", "cancelled"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={holdings}
          disabled={!wallet}
          onChange={(e) => {
            setHoldings(e.target.checked);
            setPage(1);
          }}
        />
        Relevant to my holdings{!wallet ? " · Connect a wallet" : ""}
      </label>
      <CreationRecovery />
      <PoweredByPanta />
      {error ? (
        <div role="alert" className="rounded-xl border border-border p-4">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setRevision((n) => n + 1)}>
            Retry discovery
          </Button>
        </div>
      ) : null}
      {loading ? <p role="status">Finding investing events…</p> : null}
      {data ? (
        <>
          <div className="text-xs text-muted">
            Scanned {data.coverage.scanned} catalog rows ·{" "}
            {data.coverage.complete
              ? "Eligible category scans complete"
              : "Partial catalog coverage"}
            {data.coverage.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((m) => (
              <PredictionCard key={m.marketId} market={m} />
            ))}
          </div>
          {!data.items.length ? (
            <div className="rounded-2xl border border-border p-8 text-center">
              <h2 className="font-display text-xl">No matching events</h2>
              <p className="mt-2 text-sm text-muted">
                No eligible markets matched this search within the scanned
                catalog. Try a broader search or another category.
              </p>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm">Page {page}</span>
            <Button
              variant="secondary"
              disabled={!data.hasMore || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="prediction-detail-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l border-border bg-background p-5 text-foreground backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="prediction-detail-title" className="font-display text-xl">
            Event details
          </h2>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </div>
        {detail ? (
          <PredictionCard market={detail} detail onResearch={close} />
        ) : detailError ? (
          <p role="alert">{detailError}</p>
        ) : (
          <p role="status">Loading event…</p>
        )}
      </dialog>
    </div>
  );
}
