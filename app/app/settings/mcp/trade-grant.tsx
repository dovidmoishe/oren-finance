"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Shield01Icon } from "@hugeicons/core-free-icons";
import { TradeGrantEditor } from "./trade-grant-editor";
import { ConnectionNextStep } from "./connection-next-step";
import styles from "./trade-grant.module.css";
import { useOrenAuth } from "@/components/auth/auth-context";
import { mcpApiOrigin } from "@/services/mcp-api-origin";
import { validateGrantPermission, validateTrustedTradeSigner, type GrantSettings } from "@/services/mcp-grant-authorization";

type PendingGrant = {
  delegationId: string;
  wallet: string;
  signerId: string;
  policyId: string;
  perTradeUsd: string;
  dailyUsd: string;
  maxSlippageBps: number;
  allowSell: boolean;
  expiresAt: string;
};
type GrantState = {
  enabled: boolean;
  reenrollmentRequired?: boolean;
  canEnroll?: boolean;
  sellAvailable?: boolean;
  pendingGrant?: PendingGrant;
  delegationId?: string;
  wallet?: string;
  perTradeUsd?: string;
  dailyUsd?: string;
  usedTodayUsd?: string;
  maxSlippageBps?: number;
  sides?: string[];
  expiresAt?: string;
};

export function TradeGrant({ connectionUid }: { connectionUid?: string }) {
  const auth = useOrenAuth();
  const { authenticated, ready, getAccessToken } = auth;
  const apiOrigin = mcpApiOrigin();
  const trustedSigner = {
    signerId: process.env.NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID ?? "",
    policyId: process.env.NEXT_PUBLIC_MCP_SIGNER_POLICY_ID ?? "",
  };
  const [grant, setGrant] = useState<GrantState>();
  const [pending, setPending] = useState<PendingGrant>();
  const [revokeAcknowledged, setRevokeAcknowledged] = useState(false);
  const [cleanupWallet, setCleanupWallet] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    if (!apiOrigin || !authenticated) return;
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in again to manage chat trading.");
    const response = await fetch(`${apiOrigin}/mcp/delegation`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Unable to load chat trading permission.");
    const value = (await response.json()) as GrantState;
    setGrant(value);
    setPending(value.pendingGrant);
  }, [apiOrigin, authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void (async () => {
      try {
        await refresh();
      } catch {
        setError("Unable to load chat trading permission.");
      }
    })();
  }, [ready, authenticated, refresh]);

  async function post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!apiOrigin) throw new Error("Chat trading is unavailable.");
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Sign in again to manage chat trading.");
    const response = await fetch(`${apiOrigin}/mcp/delegation/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      const code =
        typeof body?.error === "string" && /^[a-z_]{1,40}$/.test(body.error)
          ? `, ${body.error}`
          : "";
      throw new Error(
        `The signer grant could not be verified (HTTP ${response.status}${code}). Check your wallet and try again.`,
      );
    }
    return response.json() as Promise<T>;
  }

  async function prepare(settings: GrantSettings) {
    if (busy || !auth.address) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const authorization = await ownerAuthorization("prepare", settings);
      const saved = await post<PendingGrant>("prepare", { settings, authorization });
      if (saved.wallet !== auth.address)
        throw new Error("Your active wallet changed. Refresh before granting.");
      validateTrustedTradeSigner(saved, trustedSigner);
      setPending(saved);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to prepare permission.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function ownerAuthorization(action: "prepare" | "activate" | "revoke",
    review: GrantSettings | PendingGrant | { delegationId: string }) {
    if (!auth.address) throw new Error("Select your wallet before continuing.");
    if (action !== "revoke") validateTrustedTradeSigner(trustedSigner, trustedSigner);
    const request = action === "prepare" ? { action, settings: review, ...trustedSigner }
      : { action, delegationId: (review as { delegationId: string }).delegationId };
    const { message } = await post<{ message: string }>("authorization", request);
    validateGrantPermission(message, auth.address, process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "", action, review, trustedSigner);
    const signature = await auth.signTradePermission(auth.address, message);
    return { message, signature };
  }

  async function addSigner() {
    if (!pending || busy || pending.wallet !== auth.address) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      validateTrustedTradeSigner(pending, trustedSigner);
      const authorization = await ownerAuthorization("activate", pending);
      await auth.addTradeSigner(
        pending.wallet,
        pending.signerId,
        pending.policyId,
      );
      await post("activate", { delegationId: pending.delegationId, authorization });
      setPending(undefined);
      await refresh();
      setNotice(
        "Chat trading permission is active.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to activate permission.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifySigner() {
    if (!pending || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const authorization = await ownerAuthorization("activate", pending);
      await post("activate", { delegationId: pending.delegationId, authorization });
      setPending(undefined);
      await refresh();
      setNotice(
        "Your trading permission was verified.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Privy signer verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const targetId = grant?.delegationId ?? pending?.delegationId;
    const targetWallet = grant?.wallet ?? pending?.wallet;
    if (!targetId || !targetWallet || busy || !revokeAcknowledged) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const authorization = await ownerAuthorization("revoke", { delegationId: targetId });
      await post("revoke", { delegationId: targetId, authorization });
      setCleanupWallet(targetWallet);
      setGrant({ enabled: false, canEnroll: false });
      setPending(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to revoke the gate permission.",
      );
      setBusy(false);
      return;
    }
    try {
      await auth.removeTradeSigners(targetWallet);
      setCleanupWallet(undefined);
      await refresh();
      setNotice(
        "Permission revoked and Privy reported all wallet signers removed.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gate permission is revoked. Privy signer removal needs another attempt.",
      );
      setNotice(
        "The gate is disabled. Remove every wallet signer in Privy before enrolling again.",
      );
    } finally {
      setBusy(false);
      setRevokeAcknowledged(false);
    }
  }

  async function retrySignerRemoval() {
    if (!cleanupWallet || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.removeTradeSigners(cleanupWallet);
      setCleanupWallet(undefined);
      await refresh();
      setNotice("Privy reported all wallet signers removed.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Privy signer removal failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!auth.authenticated) return null;
  return (
    <section id="chat-trading" aria-labelledby="chat-trading-title" className={styles.card}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}><HugeiconsIcon icon={Shield01Icon} size={22} strokeWidth={1.5} aria-hidden="true" /></span>
        <div><h2 id="chat-trading-title">Chat trading limits</h2><p>Set limits for all connected apps with chat trading access. Review your permission before activating it.</p></div>
      </div>
      {grant?.reenrollmentRequired && <p className="mt-4 text-sm">
        Renew your chat trading permission to use the new security checks. Revoke
        this permission and remove its wallet signers, then review a new grant.
      </p>}
      {grant?.enabled && (
        <div className="mt-5 text-sm">
          <p>Allowed: {grant.sides?.join(" and ")}</p>
          <p>
            Up to ${grant.perTradeUsd} per trade and ${grant.dailyUsd} in a
            rolling 24 hours. Charged: ${grant.usedTodayUsd}.
          </p>
          <p>Maximum slippage: {(grant.maxSlippageBps ?? 0) / 100}%.</p>
          <p>
            Expires:{" "}
            {grant.expiresAt
              ? new Date(grant.expiresAt).toLocaleString()
              : "unknown"}
            .
          </p>
        </div>
      )}
      {(grant?.enabled || grant?.reenrollmentRequired) && (
        <div className="mt-5 text-sm">
          <p className="mt-3 text-muted">
            Privy removes every signer on this wallet when you revoke.
          </p>
          <label className="mt-3 flex gap-2">
            <input
              type="checkbox"
              checked={revokeAcknowledged}
              onChange={(event) => setRevokeAcknowledged(event.target.checked)}
            />
            <span>I understand every wallet signer will be removed.</span>
          </label>
          <button
            className="mt-3 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || !revokeAcknowledged || !grant?.delegationId || grant.wallet !== auth.address}
            onClick={() => void revoke()}
          >
            {busy ? "Revoking…" : grant?.reenrollmentRequired ? "Revoke old permission to set new limits" : "Revoke chat trading"}
          </button>
        </div>
      )}
      {cleanupWallet && (
        <div className="mt-5 text-sm">
          <p>
            The gate permission is revoked. Privy must remove every signer on
            wallet <span className="break-all">{cleanupWallet}</span>.
          </p>
          <button
            className="mt-3 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || cleanupWallet !== auth.address}
            onClick={() => void retrySignerRemoval()}
          >
            Retry Privy signer removal
          </button>
        </div>
      )}
      {!grant?.enabled && pending && (
        <div className="mt-5 text-sm">
          <p>
            Review permission for wallet{" "}
            <span className="break-all">{pending.wallet}</span>.
          </p>
          <p>
            {pending.allowSell ? "Buy and sell" : "Buy only"}; $
            {pending.perTradeUsd} per trade; ${pending.dailyUsd} per rolling
            day; {pending.maxSlippageBps / 100}% maximum slippage; expires{" "}
            {new Date(pending.expiresAt).toLocaleString()}.
          </p>
          <p className="mt-2 text-muted">
            Signer {pending.signerId}; policy {pending.policyId}. Privy checks
            each route. Oren’s separate gate enforces whole-transaction and
            daily limits.
          </p>
          <button
            className="mt-4 rounded-xl bg-foreground px-4 py-2 text-background disabled:opacity-50"
            type="button"
            disabled={busy || pending.wallet !== auth.address}
            onClick={() => void addSigner()}
          >
            Confirm in wallet and activate
          </button>
          <button
            className="ml-3 mt-4 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void verifySigner()}
          >
            Already added? Verify permission
          </button>
          <p className="mt-3 text-muted">
            Canceling this grant removes every signer on the wallet in Privy.
          </p>
          <label className="mt-2 flex gap-2">
            <input
              type="checkbox"
              checked={revokeAcknowledged}
              onChange={(event) => setRevokeAcknowledged(event.target.checked)}
            />
            <span>I understand every wallet signer will be removed.</span>
          </label>
          <button
            className="mt-2 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || !revokeAcknowledged}
            onClick={() => void revoke()}
          >
            Cancel grant and remove signers
          </button>
        </div>
      )}
      {!grant?.enabled && !grant?.reenrollmentRequired && !pending && grant?.canEnroll && (
        <TradeGrantEditor key={String(grant.sellAvailable)} sellAvailable={grant.sellAvailable === true} busy={busy}
          signerConfigured={Boolean(trustedSigner.signerId && trustedSigner.policyId)} onReview={prepare} />
      )}
      {!grant?.enabled && !grant?.reenrollmentRequired && !pending && grant && !grant.canEnroll && (
        <p className="mt-4 text-sm text-muted">
          Chat trading is not available for this account yet. Browser trade
          review remains available.
        </p>
      )}
      {!apiOrigin && <p className="mt-4 text-sm text-muted" role="status">Chat trading settings are unavailable right now.</p>}
      {apiOrigin && !grant && !error && <p className="mt-4 text-sm text-muted" role="status">Loading chat trading permission…</p>}
      {grant?.enabled && <ConnectionNextStep uid={connectionUid} />}
      {error && (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 text-sm" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
