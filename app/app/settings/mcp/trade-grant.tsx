"use client";

import { useCallback, useEffect, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { mcpApiOrigin } from "@/services/mcp-api-origin";

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

export function TradeGrant() {
  const auth = useOrenAuth();
  const { authenticated, ready, getAccessToken } = auth;
  const apiOrigin = mcpApiOrigin();
  const [grant, setGrant] = useState<GrantState>();
  const [pending, setPending] = useState<PendingGrant>();
  const [allowSell, setAllowSell] = useState(false);
  const [perTradeUsd, setPerTradeUsd] = useState(25);
  const [dailyUsd, setDailyUsd] = useState(50);
  const [maxSlippageBps, setMaxSlippageBps] = useState(50);
  const [durationHours, setDurationHours] = useState(24);
  const [acknowledged, setAcknowledged] = useState(false);
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
    if (!response.ok)
      throw new Error(
        "The signer grant could not be verified. Check your wallet and try again.",
      );
    return response.json() as Promise<T>;
  }

  async function prepare() {
    if (!acknowledged || busy || !auth.address) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await post<PendingGrant>("prepare", {
        allowSell,
        perTradeUsd,
        dailyUsd,
        maxSlippageBps,
        durationHours,
      });
      if (saved.wallet !== auth.address)
        throw new Error("Your active wallet changed. Refresh before granting.");
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

  async function addSigner() {
    if (!pending || busy || pending.wallet !== auth.address) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await auth.addTradeSigner(
        pending.wallet,
        pending.signerId,
        pending.policyId,
      );
      await post("activate", { delegationId: pending.delegationId });
      setPending(undefined);
      await refresh();
      setNotice(
        "Chat trading permission is active. Connect Claude again to grant execute access.",
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
      await post("activate", { delegationId: pending.delegationId });
      setPending(undefined);
      await refresh();
      setNotice(
        "Privy signer and policy were verified. Connect Claude again for execute access.",
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
      await post("revoke", { delegationId: targetId });
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
    <section className="mt-10 rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-xl font-semibold">Chat trading permission</h2>
      <p className="mt-2 text-sm text-muted">
        Grant a revocable, limited signer to your embedded wallet. Claude needs
        a fresh connection after activation. Other agent clients stay read-only.
      </p>
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
            disabled={busy || !revokeAcknowledged}
            onClick={() => void revoke()}
          >
            Revoke chat trading
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
            Review the exact grant for wallet{" "}
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
            className="mt-4 rounded-xl bg-foreground px-4 py-2 text-white disabled:opacity-50"
            type="button"
            disabled={busy || pending.wallet !== auth.address}
            onClick={() => void addSigner()}
          >
            Add signer in Privy and activate
          </button>
          <button
            className="ml-3 mt-4 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void verifySigner()}
          >
            Verify an added signer
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
      {!grant?.enabled && !pending && grant?.canEnroll && (
        <div className="mt-5 grid gap-3 text-sm">
          <label>
            Permission
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background p-2"
              value={allowSell ? "both" : "buy"}
              onChange={(event) => setAllowSell(event.target.value === "both")}
            >
              <option value="buy">Buy only</option>
              {grant.sellAvailable && (
                <option value="both">Buy and sell</option>
              )}
            </select>
          </label>
          <label>
            Maximum USD per trade
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background p-2"
              type="number"
              min="0.01"
              max="25"
              step="0.01"
              value={perTradeUsd}
              onChange={(event) => setPerTradeUsd(Number(event.target.value))}
            />
          </label>
          <label>
            Maximum USD per rolling 24 hours
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background p-2"
              type="number"
              min="0.01"
              max="50"
              step="0.01"
              value={dailyUsd}
              onChange={(event) => setDailyUsd(Number(event.target.value))}
            />
          </label>
          <label>
            Maximum slippage, basis points
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background p-2"
              type="number"
              min="1"
              max="50"
              step="1"
              value={maxSlippageBps}
              onChange={(event) =>
                setMaxSlippageBps(Number(event.target.value))
              }
            />
          </label>
          <label>
            Grant duration, hours
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background p-2"
              type="number"
              min="1"
              max="24"
              step="1"
              value={durationHours}
              onChange={(event) => setDurationHours(Number(event.target.value))}
            />
          </label>
          <p className="text-muted">
            Enrollment requires a wallet with zero existing signers. Privy
            currently removes every signer on revocation.
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I want to prepare these limits for my embedded wallet.</span>
          </label>
          <button
            className="w-fit rounded-xl bg-foreground px-4 py-2 text-white disabled:opacity-50"
            type="button"
            disabled={busy || !acknowledged}
            onClick={() => void prepare()}
          >
            Review signer grant
          </button>
        </div>
      )}
      {!grant?.enabled && !pending && grant && !grant.canEnroll && (
        <p className="mt-4 text-sm text-muted">
          Chat trading is not available for this account yet. Browser trade
          review remains available.
        </p>
      )}
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
