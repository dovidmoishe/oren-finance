"use client";

import { useId, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, InformationCircleIcon, Shield01Icon } from "@hugeicons/core-free-icons";
import type { GrantSettings } from "@/services/mcp-grant-authorization";
import { parseGrantSettings, type GrantDraft } from "@/services/mcp-grant-settings";
import styles from "./trade-grant.module.css";

export function TradeGrantEditor({ sellAvailable, busy, signerConfigured, onReview }: {
  sellAvailable: boolean;
  busy: boolean;
  signerConfigured: boolean;
  onReview: (settings: GrantSettings) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<GrantDraft>({ perTradeUsd: "25", dailyUsd: "50", slippagePercent: "0.5", durationHours: "24" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string>();
  function update(field: keyof GrantDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setAcknowledged(false);
    setError(undefined);
  }
  return (
    <form className={styles.editor} onSubmit={event => {
      event.preventDefault();
      if (busy || !acknowledged || !signerConfigured) return;
      try { void onReview(parseGrantSettings(draft, sellAvailable)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Check your trading limits."); }
    }}>
      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.srOnly}>Set your chat trading limits</legend>
        <div className={styles.permission}>
          <div>
            <span className={styles.label}>What your agent can do</span>
            <p>{sellAvailable ? "Buy and sell stocks within the limits you set." : "Buy stocks within the limits you set."}</p>
          </div>
          <span className={styles.badge}>{sellAvailable ? "Buy and sell" : "Buy only"}</span>
        </div>
        {!sellAvailable && <p className={styles.caption}>Selling in chat is not available yet. You can still review sells in Oren.</p>}
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Per trade</span>
            <span className={styles.inputWrap}><span aria-hidden="true">$</span><input aria-label="Maximum dollars per trade" aria-describedby={`${id}-trade`} type="number" inputMode="decimal" min="0.01" max="25" step="0.01" required value={draft.perTradeUsd} onChange={event => update("perTradeUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-trade`}>Up to $25 each trade</small>
          </label>
          <label className={styles.field}>
            <span>Per 24 hours</span>
            <span className={styles.inputWrap}><span aria-hidden="true">$</span><input aria-label="Maximum dollars per rolling 24 hours" aria-describedby={`${id}-daily`} type="number" inputMode="decimal" min="0.01" max="50" step="0.01" required value={draft.dailyUsd} onChange={event => update("dailyUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-daily`}>Up to $50 in any rolling 24 hours</small>
          </label>
          <label className={styles.field}>
            <span>Price tolerance</span>
            <span className={styles.inputWrap}><input aria-label="Maximum price tolerance percent" aria-describedby={`${id}-slippage`} type="number" inputMode="decimal" min="0.01" max="0.5" step="0.01" required value={draft.slippagePercent} onChange={event => update("slippagePercent", event.target.value)} /><span>%</span></span>
            <small id={`${id}-slippage`}>Maximum slippage from the quote</small>
          </label>
          <label className={styles.field}>
            <span>Permission expires after</span>
            <select value={draft.durationHours} onChange={event => update("durationHours", event.target.value)}>
              <option value="1">1 hour</option><option value="6">6 hours</option><option value="12">12 hours</option><option value="24">24 hours</option>
            </select>
            <small>Stops automatically. Revoke anytime.</small>
          </label>
        </div>
        <div className={styles.summary}>
          <HugeiconsIcon icon={Shield01Icon} size={20} strokeWidth={1.6} aria-hidden="true" />
          <div><strong>Your limits. Every trade.</strong><p>Each trade is checked against your permission before it can be signed.</p></div>
        </div>
        <p className={styles.caption}>Use a wallet with no existing signers. Revoking this permission removes every signer on the wallet.</p>
        <details className={styles.details}>
          <summary>How wallet permission works</summary>
          <p>This adds a limited signer to your embedded wallet. Enrollment requires no existing wallet signers. Revoking removes every signer from this wallet in Privy.</p>
          <p>After activation, continue your agent connection to approve trading within these limits.</p>
        </details>
        <label className={styles.checkbox}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I’ve reviewed these limits and allow my agent to {sellAvailable ? "buy and sell" : "buy"} within them.</span></label>
      </fieldset>
      {!signerConfigured && <p className={styles.warning} role="alert"><HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" /><span>Chat trading setup is temporarily unavailable. Oren’s trusted signer configuration needs an update. You can still review trades in Oren.</span></p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}>
        <span>You’ll review the exact permission next.</span>
        <button className={styles.primary} type="submit" disabled={busy || !acknowledged || !signerConfigured}>{busy ? "Preparing permission…" : "Review permission"}<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></button>
      </div>
    </form>
  );
}
