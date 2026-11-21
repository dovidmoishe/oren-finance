"use client";

import {
  CircleAlert as CircleAlertIcon,
  CircleCheck as CircleCheckIcon,
  Clock as ClockIcon,
  Vault as VaultIcon,
  WalletCards as WalletCardsIcon,
} from "lucide-react";
import { InterfaceIcon } from "@/components/ui/interface-icon";

import { Button, Card, CardContent, Modal, Toast, formatCurrency, formatDate, formatNumber } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";

export type VaultReviewMode = "lock" | "unlock";

export interface VaultReviewDetails {
  mode: VaultReviewMode;
  ticker: string;
  name?: string;
  quantity: number;
  valueUsd?: number;
  unlockAt: string;
  lockAddress?: string;
  daysRemaining?: number;
}

interface VaultReviewModalProps {
  open: boolean;
  details?: VaultReviewDetails;
  programLive: boolean;
  error?: string;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-end font-money font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function VaultReviewModal({
  open,
  details,
  programLive,
  error,
  onClose,
}: VaultReviewModalProps) {
  const { locale, timeZone, t } = useI18n();
  const isLock = details?.mode === "lock";
  const title = isLock ? t("vaultReview.reviewLock") : t("vaultReview.reviewUnlock");

  return (
    <Modal open={open} onClose={onClose} side="right" title={title}>
      {!details ? (
        <Toast title={t("vaultReview.nothingTitle")} description={t("vaultReview.nothingDescription")} tone="error" />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardContent>
              <p className="text-xs text-muted">
                {isLock ? t("vaultReview.lockPosition") : t("vaultReview.unlockPosition")}
              </p>
              <h3 className="mt-1 text-xl font-medium tracking-tight">{details.ticker}</h3>
              {details.name ? <p className="mt-1 text-sm text-muted">{details.name}</p> : null}
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <Row label={t("vaultReview.quantity")} value={formatNumber(details.quantity, locale)} />
                <Row label={t("vaultReview.estValue")} value={formatCurrency(details.valueUsd, locale)} />
                <Row label={t("vaultReview.unlockDate")} value={formatDate(details.unlockAt, locale, timeZone, t("common.notUpdated"))} />
                {typeof details.daysRemaining === "number" ? (
                  <Row
                    label={t("vaultReview.timeRemaining")}
                    value={
                      details.daysRemaining <= 0
                        ? t("vaultReview.eligibleNow")
                        : t("vaultReview.days", { count: details.daysRemaining })
                    }
                  />
                ) : null}
                {details.lockAddress ? (
                  <Row label={t("vaultReview.lockAddress")} value={`${details.lockAddress.slice(0, 4)}…${details.lockAddress.slice(-4)}`} />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <p className="text-sm leading-6 text-muted">
            {isLock
              ? t("vaultReview.lockNote")
              : t("vaultReview.unlockNote")}
          </p>

          {!programLive ? (
            <div className="rounded-xl border border-warning-border bg-warning-surface p-4 text-sm text-warning">
              <div className="flex gap-3">
                <VaultIcon className="mt-0.5 shrink-0" color="currentColor" size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">{t("vaultReview.offlineTitle")}</p>
                  <p className="mt-1 text-warning/80">
                    {t("vaultReview.offlineBody")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <Toast title={t("vaultReview.error")} description={error} tone="error" /> : null}

          <Button className="w-full" disabled variant="primary">
            <InterfaceIcon color="currentColor" icon={programLive ? WalletCardsIcon : ClockIcon} size={16} strokeWidth={1.8} />
            {programLive ? t("vaultReview.reviewSign") : t("vaultReview.signingUnavailable")}
          </Button>

          {!programLive ? (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted">
              <CircleAlertIcon className="mt-0.5 shrink-0" color="currentColor" size={14} strokeWidth={1.8} />
              {t("vaultReview.offlineFooter")}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted">
              <CircleCheckIcon className="mt-0.5 shrink-0" color="currentColor" size={14} strokeWidth={1.8} />
              {t("vaultReview.liveFooter")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
