"use client";

import { useId, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, InformationCircleIcon, Shield01Icon } from "@hugeicons/core-free-icons";
import type { GrantSettings } from "@/services/mcp-grant-authorization";
import { parseGrantSettings, type GrantDraft } from "@/services/mcp-grant-settings";
import styles from "./trade-grant.module.css";
import { useT } from "@/i18n/i18n";

export function TradeGrantEditor({ sellAvailable, busy, signerConfigured, onReview }: {
  sellAvailable: boolean;
  busy: boolean;
  signerConfigured: boolean;
  onReview: (settings: GrantSettings) => Promise<void>;
}) {
  const id = useId();
  const t = useT();
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
      catch (cause) { setError(cause instanceof Error ? cause.message : t("grant.checkLimits")); }
    }}>
      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.srOnly}>{t("grant.setLimits")}</legend>
        <div className={styles.permission}>
          <div>
            <span className={styles.label}>{t("grant.whatAgentCanDo")}</span>
            <p>{sellAvailable ? t("grant.canBuySell") : t("grant.canBuy")}</p>
          </div>
          <span className={styles.badge}>{sellAvailable ? t("grant.buyAndSell") : t("grant.buyOnly")}</span>
        </div>
        {!sellAvailable && <p className={styles.caption}>{t("grant.sellUnavailable")}</p>}
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>{t("grant.perTrade")}</span>
            <span className={styles.inputWrap}><span aria-hidden="true">$</span><input aria-label={t("grant.perTradeAria")} aria-describedby={`${id}-trade`} type="number" inputMode="decimal" min="0.01" max="25" step="0.01" required value={draft.perTradeUsd} onChange={event => update("perTradeUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-trade`}>{t("grant.perTradeHint")}</small>
          </label>
          <label className={styles.field}>
            <span>{t("grant.perDay")}</span>
            <span className={styles.inputWrap}><span aria-hidden="true">$</span><input aria-label={t("grant.perDayAria")} aria-describedby={`${id}-daily`} type="number" inputMode="decimal" min="0.01" max="50" step="0.01" required value={draft.dailyUsd} onChange={event => update("dailyUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-daily`}>{t("grant.perDayHint")}</small>
          </label>
          <label className={styles.field}>
            <span>{t("grant.tolerance")}</span>
            <span className={styles.inputWrap}><input aria-label={t("grant.toleranceAria")} aria-describedby={`${id}-slippage`} type="number" inputMode="decimal" min="0.01" max="0.5" step="0.01" required value={draft.slippagePercent} onChange={event => update("slippagePercent", event.target.value)} /><span>%</span></span>
            <small id={`${id}-slippage`}>{t("grant.toleranceHint")}</small>
          </label>
          <label className={styles.field}>
            <span>{t("grant.expiresAfter")}</span>
            <select value={draft.durationHours} onChange={event => update("durationHours", event.target.value)}>
              {[1, 6, 12, 24].map((hours) => <option key={hours} value={String(hours)}>{t("grant.hours", { count: hours })}</option>)}
            </select>
            <small>{t("grant.stopsAutomatically")}</small>
          </label>
        </div>
        <div className={styles.summary}>
          <HugeiconsIcon icon={Shield01Icon} size={20} strokeWidth={1.6} aria-hidden="true" />
          <div><strong>{t("grant.summaryTitle")}</strong><p>{t("grant.summaryBody")}</p></div>
        </div>
        <p className={styles.caption}>{t("grant.noSigners")}</p>
        <details className={styles.details}>
          <summary>{t("grant.howItWorks")}</summary>
          <p>{t("grant.howItWorks1")}</p>
          <p>{t("grant.howItWorks2")}</p>
        </details>
        <label className={styles.checkbox}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{sellAvailable ? t("grant.ackBuySell") : t("grant.ackBuy")}</span></label>
      </fieldset>
      {!signerConfigured && <p className={styles.warning} role="alert"><HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" /><span>{t("grant.setupUnavailable")}</span></p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}>
        <span>{t("grant.reviewNext")}</span>
        <button className={styles.primary} type="submit" disabled={busy || !acknowledged || !signerConfigured}>{busy ? t("grant.preparing") : t("grant.review")}<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></button>
      </div>
    </form>
  );
}
