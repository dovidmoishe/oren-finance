"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAgentStore } from "@/store";
import type { PredictionMarket, PredictionResearch } from "@/types/predictions";
import { Button } from "@/components/ui";

export function PoweredByPanta() {
  return (
    <p className="text-xs text-muted">
      Powered by{" "}
      <a
        href="https://www.panta.market"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Panta
      </a>
    </p>
  );
}
export function ResearchButton({
  market,
  onPrepared,
}: {
  market: PredictionMarket;
  onPrepared?: () => void;
}) {
  const { connected } = useWallet();
  const prefill = useAgentStore((s) => s.prefillPrompt);
  return (
    <Button
      variant="secondary"
      disabled={!connected}
      onClick={() => {
        prefill(
          `Research Panta market ${market.marketId}: ${market.title}. Explain the evidence, counterarguments, uncertainty and relevance to my holdings.`,
        );
        onPrepared?.();
      }}
    >
      {connected ? "Research with Oren" : "Connect wallet to research"}
    </Button>
  );
}
export function PredictionCard({
  market,
  detail = false,
  onResearch,
}: {
  market: PredictionMarket;
  detail?: boolean;
  onResearch?: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border bg-panel p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="capitalize">
          {market.category ?? "Investing"} · {market.phase}
        </span>
        {market.source.stale ? <span>Stale data</span> : null}
      </div>
      <h3 className="font-display text-lg font-semibold leading-snug">
        {market.title}
      </h3>
      <p className="text-xs text-muted">{market.relevance.reason}</p>
      <div className="grid grid-cols-2 gap-2">
        {market.outcomes.map((side) => (
          <div key={side.side} className="rounded-xl bg-panel-subtle px-3 py-2">
            <span className="text-xs font-semibold">{side.side}</span>
            <p className="font-mono text-sm">
              {side.priceUsdc === null
                ? "Price unavailable"
                : `${side.priceUsdc} USDC/share`}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Event end:{" "}
        {market.endTime
          ? new Date(market.endTime).toLocaleString(undefined, {
              timeZoneName: "short",
            })
          : "Unavailable"}
      </p>
      <p className="text-xs text-muted">
        Observed{" "}
        {new Date(market.source.observedAt).toLocaleString(undefined, {
          timeZoneName: "short",
        })}
      </p>
      {detail ? (
        <>
          {market.description ? (
            <p className="text-sm whitespace-pre-wrap">{market.description}</p>
          ) : null}
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="font-semibold">Resolution rules</dt>
              <dd>{market.resolutionRule ?? "Unavailable from Panta"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Resolution sources</dt>
              <dd>
                {market.sourcesOfTruth?.join(", ") ?? "Unavailable from Panta"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Resolution time</dt>
              <dd>
                {market.resolutionTime
                  ? new Date(market.resolutionTime).toLocaleString(undefined, {
                      timeZoneName: "short",
                    })
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">
                Winning payout, fees, liquidity and order depth
              </dt>
              <dd>Unavailable; prices are not win probabilities.</dd>
            </div>
          </dl>
          <a
            className="text-sm underline"
            href={`https://www.panta.market/market/${encodeURIComponent(market.marketId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Panta
          </a>
        </>
      ) : (
        <Link
          href={`/app/predictions?marketId=${encodeURIComponent(market.marketId)}`}
          className="inline-block text-sm font-semibold underline"
        >
          View event details
        </Link>
      )}
      <ResearchButton market={market} onPrepared={onResearch} />
      <PoweredByPanta />
    </article>
  );
}

export function PredictionBrief({ brief }: { brief: PredictionResearch }) {
  const evidence = (label: string, items: PredictionResearch["supporting"]) => (
    <section>
      <h4 className="font-semibold">{label}</h4>
      {items.length ? (
        <ul className="mt-2 space-y-3">
          {items.map((item, i) => (
            <li key={i}>
              <p className="text-sm">{item.text}</p>
              <div className="flex flex-wrap gap-2">
                {item.sourceIds.map((id) => {
                  const source = brief.sources.find((s) => s.id === id);
                  return source ? (
                    <a
                      key={id}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline"
                    >
                      {source.title}
                    </a>
                  ) : null;
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No source-backed evidence returned.
        </p>
      )}
    </section>
  );
  return (
    <article className="rounded-2xl border border-border bg-panel p-5 space-y-4">
      <h3 className="font-display text-lg font-semibold">
        {brief.market.title}
      </h3>
      <p className="text-xs text-muted">
        {brief.status === "researched"
          ? "Event research"
          : "Insufficient evidence"}{" "}
        ·{" "}
        {new Date(brief.generatedAt).toLocaleString(undefined, {
          timeZoneName: "short",
        })}
      </p>
      <p className="text-sm">{brief.summary}</p>
      {evidence("Supporting evidence", brief.supporting)}
      {evidence("Counterarguments", brief.counterarguments)}
      {brief.portfolioRelevance.length ? (
        <section>
          <h4 className="font-semibold">Your holdings</h4>
          {brief.portfolioRelevance.map((stock) => (
            <p key={stock.assetId} className="text-sm">
              {stock.ticker} · {stock.allocationPct.toFixed(1)}% allocation ·{" "}
              {stock.kind === "direct"
                ? "Direct event relevance"
                : "Possible macro context; impact not quantified"}
            </p>
          ))}
        </section>
      ) : null}
      {[
        ["Uncertainty", brief.uncertainty],
        ["Unresolved questions", brief.unresolvedQuestions],
        ["Limitations", brief.warnings],
      ].map(([label, items]) => (
        <section key={label as string}>
          <h4 className="font-semibold">{label as string}</h4>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {(items as string[]).map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h4 className="font-semibold">Sources</h4>
        {brief.sources.map((source) => (
          <div key={source.id} className="mt-2 text-xs">
            <a
              href={source.url}
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.title}
            </a>
            <p className="text-muted">
              {source.kind === "official"
                ? "Official government source"
                : source.kind === "secondary"
                  ? "Secondary reporting"
                  : "Source type unverified"}{" "}
              · Published {source.publishedAt ?? "date unavailable"} · Retrieved{" "}
              {new Date(source.retrievedAt).toLocaleString(undefined, {
                timeZoneName: "short",
              })}
            </p>
          </div>
        ))}
      </section>
      <PoweredByPanta />
    </article>
  );
}
