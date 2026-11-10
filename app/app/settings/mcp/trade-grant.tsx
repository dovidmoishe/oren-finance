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
import { useI18n } from "@/i18n/i18n";

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
  const { locale, t } = useI18n();
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
    if (!token) throw new Error(t("grant.signInAgain"));
    const response = await fetch(`${apiOrigin}/mcp/delegation`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(t("grant.loadFailed"));
    const value = (await response.json()) as GrantState;
    setGrant(value);
    setPending(value.pendingGrant);
    // `t` only labels errors; a language change must not refetch the grant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiOrigin, authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void (async () => {
      try {
        await refresh();
      } catch {
        setError(t("grant.loadFailed"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, refresh]);

  async function post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!apiOrigin) throw new Error(t("grant.unavailable"));
    const token = await auth.getAccessToken();
    if (!token) throw new Error(t("grant.signInAgain"));
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
      throw new Error(t("grant.verifyFailed", { status: response.status, code }));
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
        throw new Error(t("grant.walletChanged"));
      validateTrustedTradeSigner(saved, trustedSigner);
      setPending(saved);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("grant.prepareFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function ownerAuthorization(action: "prepare" | "activate" | "revoke",
    review: GrantSettings | PendingGrant | { delegationId: string }) {
    if (!auth.address) throw new Error(t("grant.selectWallet"));
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
      setNotice(t("grant.active"));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("grant.activateFailed"),
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
      setNotice(t("grant.verified"));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("grant.signerVerifyFailed"),
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
          : t("grant.revokeGateFailed"),
      );
      setBusy(false);
      return;
    }
    try {
      await auth.removeTradeSigners(targetWallet);
      setCleanupWallet(undefined);
      await refresh();
      setNotice(t("grant.revokedAll"));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("grant.removalRetry"),
      );
      setNotice(t("grant.gateDisabled"));
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
      setNotice(t("grant.signersRemoved"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("grant.removalFailed"),
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
        <div><h2 id="chat-trading-title">{t("grant.title")}</h2><p>{t("grant.intro")}</p></div>
      </div>
      {grant?.reenrollmentRequired && <p className="mt-4 text-sm">
        {t("grant.renew")}
      </p>}
      {grant?.enabled && (
        <div className="mt-5 text-sm">
          <p>{t("grant.allowed", { sides: (grant.sides ?? []).map((side) => side === "buy" ? t("grant.sideBuy") : side === "sell" ? t("grant.sideSell") : side).join(t("grant.and")) })}</p>
          <p>
            {t("grant.limits", { perTrade: grant.perTradeUsd ?? "", daily: grant.dailyUsd ?? "", used: grant.usedTodayUsd ?? "" })}
          </p>
          <p>{t("grant.maxSlippage", { percent: (grant.maxSlippageBps ?? 0) / 100 })}</p>
          <p>
            {t("grant.expires", {
              date: grant.expiresAt
                ? new Date(grant.expiresAt).toLocaleString(locale)
                : t("grant.unknown"),
            })}
          </p>
        </div>
      )}
      {(grant?.enabled || grant?.reenrollmentRequired) && (
        <div className="mt-5 text-sm">
          <p className="mt-3 text-muted">
            {t("grant.privyRemoves")}
          </p>
          <label className="mt-3 flex gap-2">
            <input
              type="checkbox"
              checked={revokeAcknowledged}
              onChange={(event) => setRevokeAcknowledged(event.target.checked)}
            />
            <span>{t("grant.understand")}</span>
          </label>
          <button
            className="mt-3 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || !revokeAcknowledged || !grant?.delegationId || grant.wallet !== auth.address}
            onClick={() => void revoke()}
          >
            {busy ? t("grant.revoking") : grant?.reenrollmentRequired ? t("grant.revokeOld") : t("grant.revokeChat")}
          </button>
        </div>
      )}
      {cleanupWallet && (
        <div className="mt-5 text-sm">
          <p className="break-all">
            {t("grant.cleanup", { wallet: cleanupWallet })}
          </p>
          <button
            className="mt-3 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || cleanupWallet !== auth.address}
            onClick={() => void retrySignerRemoval()}
          >
            {t("grant.retryRemoval")}
          </button>
        </div>
      )}
      {!grant?.enabled && pending && (
        <div className="mt-5 text-sm">
          <p className="break-all">
            {t("grant.reviewFor", { wallet: pending.wallet })}
          </p>
          <p>
            {t("grant.pendingSummary", {
              sides: pending.allowSell ? t("grant.buyAndSell") : t("grant.buyOnly"),
              perTrade: pending.perTradeUsd,
              daily: pending.dailyUsd,
              slippage: pending.maxSlippageBps / 100,
              date: new Date(pending.expiresAt).toLocaleString(locale),
            })}
          </p>
          <p className="mt-2 text-muted">
            {t("grant.signerNote", { signer: pending.signerId, policy: pending.policyId })}
          </p>
          <button
            className="mt-4 rounded-xl bg-foreground px-4 py-2 text-white disabled:opacity-50"
            type="button"
            disabled={busy || pending.wallet !== auth.address}
            onClick={() => void addSigner()}
          >
            {t("grant.confirmActivate")}
          </button>
          <button
            className="ml-3 mt-4 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void verifySigner()}
          >
            {t("grant.alreadyAdded")}
          </button>
          <p className="mt-3 text-muted">
            {t("grant.cancelNote")}
          </p>
          <label className="mt-2 flex gap-2">
            <input
              type="checkbox"
              checked={revokeAcknowledged}
              onChange={(event) => setRevokeAcknowledged(event.target.checked)}
            />
            <span>{t("grant.understand")}</span>
          </label>
          <button
            className="mt-2 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
            type="button"
            disabled={busy || !revokeAcknowledged}
            onClick={() => void revoke()}
          >
            {t("grant.cancelGrant")}
          </button>
        </div>
      )}
      {!grant?.enabled && !grant?.reenrollmentRequired && !pending && grant?.canEnroll && (
        <TradeGrantEditor key={String(grant.sellAvailable)} sellAvailable={grant.sellAvailable === true} busy={busy}
          signerConfigured={Boolean(trustedSigner.signerId && trustedSigner.policyId)} onReview={prepare} />
      )}
      {!grant?.enabled && !grant?.reenrollmentRequired && !pending && grant && !grant.canEnroll && (
        <p className="mt-4 text-sm text-muted">
          {t("grant.notAvailable")}
        </p>
      )}
      {!apiOrigin && <p className="mt-4 text-sm text-muted" role="status">{t("grant.settingsUnavailable")}</p>}
      {apiOrigin && !grant && !error && <p className="mt-4 text-sm text-muted" role="status">{t("grant.loading")}</p>}
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
