"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui";
import { useAgentStore } from "@/store";
import { usePredictionCreationStore } from "@/store/prediction-creation-store";
import type {
  CreationTerms,
  PredictionCreationDraft,
} from "@/types/prediction-creation";
import {
  clearPendingCreation,
  confirmCreation,
  creationAuthorized,
  decimalUnits,
  getCreationDraft,
  pendingCreation,
  prepareCreation,
  quoteCreationDraft,
  releaseExpiredCreation,
  submitCreationTransaction,
  reviseCreationDraft,
  verifyCreationWallet,
} from "@/services/prediction-creation-service";
import { PoweredByPanta } from "./prediction-cards";

export function CreationWalletVerification({
  intent,
  draftId,
}: {
  intent?: string;
  draftId?: string;
}) {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const prefill = useAgentStore((s) => s.prefillPrompt);
  async function verify() {
    if (!wallet || !signMessage) return;
    setBusy(true);
    setError(undefined);
    try {
      await verifyCreationWallet(wallet, signMessage);
      prefill(
        draftId
          ? `Restore my prediction creation draft ${draftId}.`
          : `Create a prediction market: ${intent ?? "help me define an investing event"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet verification failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <PoweredByPanta />
      <p className="text-sm">
        Verify wallet ownership to research and restore private creation
        proposals. This message authorizes no transaction.
      </p>
      <Button
        variant="secondary"
        disabled={!wallet || !signMessage || busy}
        onClick={() => void verify()}
      >
        {busy ? "Verifying…" : "Verify wallet for creation"}
      </Button>
      {!signMessage && wallet ? (
        <p className="text-xs text-muted">
          This wallet must support message signing.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function CreationProposalCard({
  draft,
}: {
  draft: PredictionCreationDraft;
}) {
  const open = usePredictionCreationStore((s) => s.open);
  const wallet = useWallet().publicKey?.toBase58();
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-panel p-4">
      <PoweredByPanta />
      <h3 className="font-display text-lg">{draft.terms.title}</h3>
      <p className="text-xs text-muted">
        Proposal v{draft.version} · {draft.evidence.generatedAt}
      </p>
      <p className="text-sm">{draft.evidence.summary}</p>
      {draft.publicationBlockers.map((issue) => (
        <p className="text-xs text-muted" key={issue}>
          {issue}
        </p>
      ))}
      <Button
        variant="primary"
        disabled={wallet !== draft.wallet}
        onClick={() => open(draft)}
      >
        Review creation proposal
      </Button>
    </section>
  );
}
export function CreationRecovery() {
  const wallet = useWallet().publicKey?.toBase58();
  const open = usePredictionCreationStore((s) => s.open);
  const [error, setError] = useState<string>();
  const pending = wallet ? pendingCreation(wallet) : null;
  if (!pending) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <p className="text-sm">
        A submitted creation signature needs recovery. Do not submit another
        payment.
      </p>
      <CreationWalletVerification draftId={pending.draftId} />
      <Button
        variant="secondary"
        onClick={() => {
          if (wallet)
            void getCreationDraft(wallet, pending.draftId)
              .then(open)
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Recovery failed"),
              );
        }}
      >
        Resume pending creation
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function CreationReviewSheet({
  draft,
  onClose,
}: {
  draft: PredictionCreationDraft;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="creation-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-5 text-foreground backdrop:bg-black/40"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="creation-title" className="font-display text-xl">
          Review creation proposal
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </header>
      <CreationReviewForm key={`${draft.id}:${draft.version}`} draft={draft} />
    </dialog>
  );
}
function CreationReviewForm({
  draft: initial,
}: {
  draft: PredictionCreationDraft;
}) {
  const { publicKey, signTransaction } = useWallet(),
    { connection } = useConnection();
  const wallet = publicKey?.toBase58();
  const currentWallet = useRef(wallet);
  useEffect(() => {
    currentWallet.current = wallet;
  }, [wallet]);
  const [draft, setDraft] = useState(initial),
    [terms, setTerms] = useState(initial.terms),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [allowDuplicate, setAllowDuplicate] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const open = usePredictionCreationStore((s) => s.open);
  function owner() {
    if (
      !wallet ||
      wallet !== draft.wallet ||
      currentWallet.current !== wallet ||
      !creationAuthorized(wallet)
    )
      throw new Error("Verify the connected proposal owner before continuing");
    return wallet;
  }
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation request failed");
    } finally {
      setBusy(false);
    }
  }
  function update<K extends keyof CreationTerms>(
    key: K,
    value: CreationTerms[K],
  ) {
    setTerms((t) => ({ ...t, [key]: value }));
    setDirty(true);
    setReviewed(false);
  }
  async function reload() {
    const updated = await getCreationDraft(owner(), draft.id);
    setDraft(updated);
    if (updated.version !== draft.version) open(updated);
  }
  async function save(research: boolean) {
    const updated = await reviseCreationDraft(owner(), draft.id, {
      version: draft.version,
      terms,
      research,
    });
    open(updated);
  }
  async function prepareReview() {
    const w = owner(),
      quote = draft.quote;
    if (!quote || dirty || !reviewed)
      throw new Error("Review current quoted terms first");
    await prepareCreation(w, {
      draftId: draft.id,
      version: draft.version,
      createId: quote.createId,
      payloadHash: quote.payloadHash,
      paymentUsdc: quote.paymentUsdc,
      allowDuplicate,
    });
    await reload();
    setReviewed(false);
  }
  async function recover() {
    const w = owner(),
      pending = pendingCreation(w);
    const attempt = draft.attempt;
    const signature =
      attempt?.signature ??
      (pending?.draftId === draft.id ? pending.signature : undefined);
    const attemptId = attempt?.id ?? pending?.attemptId;
    if (!signature || !attemptId)
      throw new Error("No submitted signature to recover");
    const result = await confirmCreation(w, {
      draftId: draft.id,
      attemptId,
      signature,
    });
    if (result.status === "registered" || result.status === "failed")
      clearPendingCreation(w);
    await reload();
  }
  async function sign() {
    const w = owner(),
      quote = draft.quote;
    if (
      !signTransaction ||
      !quote ||
      dirty ||
      !reviewed ||
      Date.parse(quote.expiresAt) <= Date.now()
    )
      throw new Error("Review a current quote before signing");
    if (pendingCreation(w))
      throw new Error(
        "Recover the saved signature before submitting another payment",
      );
    const prepared = await prepareCreation(w, {
      draftId: draft.id,
      version: draft.version,
      createId: quote.createId,
      payloadHash: quote.payloadHash,
      paymentUsdc: quote.paymentUsdc,
      allowDuplicate,
    });
    const unsigned = VersionedTransaction.deserialize(
      Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
    );
    try {
      await submitCreationTransaction(w, draft.id, prepared, unsigned, {
        currentWallet: () => currentWallet.current,
        genesis: () => connection.getGenesisHash(),
        height: () => connection.getBlockHeight("confirmed"),
        sign: signTransaction,
        broadcast: (bytes) =>
          connection.sendRawTransaction(bytes, {
            skipPreflight: false,
            maxRetries: 0,
          }),
      });
    } finally {
      await reload();
    }
  }
  const submitted = Boolean(draft.attempt?.signature),
    locked = Boolean(draft.attempt && draft.attempt.status !== "failed");
  const dates = (value: number) =>
    new Intl.DateTimeFormat("en", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: terms.timezone,
    }).format(new Date(value * 1000));
  return (
    <div className="mt-5 space-y-5">
      <PoweredByPanta />
      {wallet !== draft.wallet ? (
        <p role="alert">Connect the wallet that owns this draft.</p>
      ) : null}
      {!creationAuthorized(wallet) ? (
        <CreationWalletVerification draftId={draft.id} />
      ) : null}
      <p className="text-xs text-muted">
        Draft {draft.id} · Version {draft.version}
      </p>
      <fieldset disabled={busy || locked} className="space-y-3">
        {(
          [
            "title",
            "question",
            "description",
            "resolutionRule",
            "measurement",
            "observationPolicy",
            "missingDataPolicy",
            "timezone",
          ] as const
        ).map((key) => (
          <label className="block text-xs" key={key}>
            {(
              {
                title: "Title",
                question: "Question",
                description: "Description",
                timezone: "Timezone",
                resolutionRule: "YES / NO resolution rules",
                measurement:
                  "Exact instrument, currency, operator / statistic and units",
                observationPolicy:
                  "Observation sessions / first publication or revisions",
                missingDataPolicy: "Missing observations / suspensions policy",
              } as Record<string, string>
            )[key] ?? key}
            <textarea
              value={terms[key]}
              onChange={(e) => update(key, e.target.value)}
              maxLength={
                key === "description"
                  ? 4000
                  : key === "resolutionRule"
                    ? 2048
                    : 600
              }
              rows={key === "resolutionRule" ? 4 : 2}
              className="mt-1 w-full rounded-xl border border-border bg-panel p-3 text-sm"
            />
          </label>
        ))}
        <label className="block text-xs">
          Template
          <select
            className="ml-2 rounded-lg border border-border p-2"
            value={terms.template}
            onChange={(e) => {
              const template = e.target.value as CreationTerms["template"];
              update("template", template);
              update(
                "category",
                template === "macro"
                  ? "world"
                  : template === "crypto_threshold"
                    ? "crypto"
                    : "finance",
              );
            }}
          >
            {[
              "stock_threshold",
              "stock_versus",
              "crypto_threshold",
              "macro",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Canonical stock IDs (comma separated)
          <input
            className="mt-1 w-full rounded-xl border border-border p-3"
            value={terms.assetIds.join(",")}
            onChange={(e) =>
              update(
                "assetIds",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label className="block text-xs">
          Resolution sources (one HTTPS URL per line)
          <textarea
            className="mt-1 w-full rounded-xl border border-border p-3"
            value={terms.sourcesOfTruth.join("\n")}
            onChange={(e) =>
              update(
                "sourcesOfTruth",
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        {(["startTime", "endTime", "resolutionTime"] as const).map((key) => (
          <label className="block text-xs" key={key}>
            {key} (absolute Unix seconds)
            <input
              className="ml-2 rounded-lg border border-border p-2"
              type="number"
              value={terms[key]}
              onChange={(e) => update(key, Number(e.target.value))}
            />
            <p className="mt-1 text-muted">
              {Number.isFinite(terms[key]) && terms.timezone
                ? (() => {
                    try {
                      return dates(terms[key]);
                    } catch {
                      return "Invalid date or timezone";
                    }
                  })()
                : "Unavailable"}{" "}
              · {terms.timezone}
            </p>
          </label>
        ))}
        <p className="text-xs text-muted">
          Standard market · Exact tie: NO · Global
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void action(() => save(false))}
            disabled={!dirty}
          >
            Save edits
          </Button>
          <Button
            variant="primary"
            onClick={() => void action(() => save(true))}
          >
            Save and research this version
          </Button>
        </div>
      </fieldset>
      {/* eslint-disable-next-line @next/next/no-img-element -- deterministic PNG preview is supplied by the owned draft */}
      <img
        src={draft.artwork.previewDataUrl}
        alt="Creation artwork preview"
        width={1024}
        height={1024}
        className="max-h-72 w-full rounded-2xl object-contain"
      />
      {draft.artwork.warnings.map((w) => (
        <p className="text-xs text-muted" key={w}>
          {w}
        </p>
      ))}
      <section className="space-y-2">
        <h3 className="font-semibold">Research evidence</h3>
        <p className="text-xs text-muted">
          {draft.evidence.generatedAt} · {draft.evidence.status}
        </p>
        <p className="text-sm">{draft.evidence.summary}</p>
        {[...draft.evidence.supporting, ...draft.evidence.counterarguments].map(
          (item, i) => (
            <p className="text-sm" key={i}>
              {item.text}
              {item.sourceIds.map((id) => {
                const source = draft.evidence.sources.find((s) => s.id === id);
                return source ? (
                  <a
                    className="ml-2 underline"
                    key={id}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.title} (
                    {source.publishedAt ?? "publication date unknown"})
                  </a>
                ) : null;
              })}
            </p>
          ),
        )}
        {[
          ...draft.evidence.uncertainty,
          ...draft.evidence.unresolvedQuestions,
        ].map((text) => (
          <p className="text-xs text-muted" key={text}>
            {text}
          </p>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Duplicate candidates</h3>
        <p className="text-xs">
          Scanned {draft.duplicates.coverage.scanned} rows ·{" "}
          {draft.duplicates.coverage.complete
            ? "eligible scan complete"
            : "partial coverage; duplicates may exist"}
        </p>
        {draft.duplicates.coverage.warnings.map((w) => (
          <p key={w} className="text-xs text-muted">
            {w}
          </p>
        ))}
        {draft.duplicates.items.map((m) => (
          <p className="text-sm" key={m.marketId}>
            <a
              href={`https://www.panta.market/market/${m.marketId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {m.title}
            </a>
            {m.exact ? " · Exact match" : ""}
          </p>
        ))}
        {draft.duplicates.items.some((m) => m.exact) ? (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowDuplicate}
              onChange={(e) => {
                setAllowDuplicate(e.target.checked);
                setReviewed(false);
              }}
            />
            Create another despite the exact match
          </label>
        ) : null}
      </section>
      {[...draft.blockingIssues, ...draft.publicationBlockers].map((issue) => (
        <p className="rounded-xl bg-panel-subtle p-3 text-xs" key={issue}>
          {issue}
        </p>
      ))}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Exact Panta payload
        </summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-panel-subtle p-3 text-xs">
          {JSON.stringify(
            draft.payload ?? {
              wallet: draft.wallet,
              ...terms,
              imageUrl: "Available after artwork upload; no quote yet",
            },
            null,
            2,
          )}
        </pre>
        {!draft.payload ? (
          <p className="text-xs text-muted">
            Preview terms. The exact provider payload becomes available with the
            quote.
          </p>
        ) : null}
      </details>
      <Button
        variant="secondary"
        disabled={
          busy ||
          dirty ||
          locked ||
          draft.blockingIssues.length > 0 ||
          draft.publicationBlockers.length > 0 ||
          (draft.duplicates.items.some((m) => m.exact) && !allowDuplicate)
        }
        onClick={() =>
          void action(async () => {
            setDraft(
              await quoteCreationDraft(owner(), draft.id, draft.version),
            );
            setReviewed(false);
          })
        }
      >
        Get creation quote
      </Button>
      {draft.quote ? (
        <section className="space-y-2 rounded-2xl border border-border p-4">
          <h3 className="font-semibold">Creation cost</h3>
          <p>
            Liquidity funding:{" "}
            {decimalUnits(draft.quote.liquidityInjectionUsdc)} USDC
          </p>
          <p>
            Provider revenue fee:{" "}
            {decimalUnits(draft.quote.platformRevenueUsdc)} USDC
          </p>
          <p>
            Total approved payment: {decimalUnits(draft.quote.paymentUsdc)} USDC
          </p>
          <p>
            Network fee:{" "}
            {draft.attempt
              ? `${decimalUnits(draft.attempt.prepared.networkFeeLamports, 9)} SOL`
              : "Available after transaction preparation; displayed before signing"}
          </p>
          <p className="text-xs">Quote expires {draft.quote.expiresAt}</p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed this version, dates, artwork, rules, exact payload and
            USDC payment.
          </label>
          <Button
            variant="primary"
            disabled={
              busy ||
              dirty ||
              !reviewed ||
              submitted ||
              !signTransaction ||
              Date.parse(draft.quote.expiresAt) <= clock ||
              (draft.duplicates.items.some((m) => m.exact) && !allowDuplicate)
            }
            onClick={() =>
              void action(
                draft.attempt?.status === "prepared" ? sign : prepareReview,
              )
            }
          >
            {draft.attempt?.status === "prepared"
              ? "Sign and submit creation"
              : "Review transaction and network fee"}
          </Button>
        </section>
      ) : null}
      {draft.attempt ? (
        <section className="space-y-2">
          <p className="font-semibold">
            {draft.attempt.status.replaceAll("_", " ")}
          </p>
          <p className="text-sm">{draft.attempt.warning}</p>
          {draft.attempt.signature ? (
            <p className="break-all text-xs">
              Signature: {draft.attempt.signature}
            </p>
          ) : null}
          {draft.attempt.status === "registered" && draft.attempt.marketId ? (
            <>
              <a
                href={`https://www.panta.market/market/${draft.attempt.marketId}`}
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open verified Panta market
              </a>
              <Button
                variant="secondary"
                onClick={() =>
                  window.dispatchEvent(new Event("oren:predictions-refresh"))
                }
              >
                Refresh Discover
              </Button>
            </>
          ) : null}
        </section>
      ) : null}
      {draft.attempt?.status === "prepared" && !submitted ? (
        <Button
          variant="secondary"
          disabled={busy || Boolean(wallet && pendingCreation(wallet))}
          onClick={() =>
            void action(async () => {
              setDraft(await releaseExpiredCreation(owner(), draft.id));
              setReviewed(false);
            })
          }
        >
          Release expired unsigned preparation
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void action(reload)}
        >
          Reload current proposal
        </Button>
        {submitted || Boolean(wallet && pendingCreation(wallet)) ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void action(recover)}
          >
            Recover same signature
          </Button>
        ) : null}
      </div>
      {busy ? <p role="status">Working on this proposal…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
