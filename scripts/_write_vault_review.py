from pathlib import Path

Path("app/components/vault").mkdir(parents=True, exist_ok=True)

vault_review = r'''"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  SecureIcon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Modal, Toast, cn, formatCurrency, formatDate, formatNumber } from "@/components/ui";

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
      <span className="text-right font-mono font-medium">{value}</span>
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
  const isLock = details?.mode === "lock";
  const title = isLock ? "Review lock" : "Review unlock";

  return (
    <Modal open={open} onClose={onClose} side="right" title={title}>
      {!details ? (
        <Toast title="Nothing to review" description="Choose an asset and unlock date first." tone="error" />
      ) : (
        <div className="space-y-5">
          <div className="rounded-[24px] border border-border bg-panel-subtle p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-muted">
              {isLock ? "Lock position" : "Unlock position"}
            </p>
            <h3 className="mt-1 font-display text-2xl font-semibold">{details.ticker}</h3>
            {details.name ? <p className="mt-1 text-sm text-muted">{details.name}</p> : null}
            <div className="mt-5 space-y-3">
              <Row label="Quantity" value={formatNumber(details.quantity)} />
              <Row label="Est. value" value={formatCurrency(details.valueUsd)} />
              <Row label="Unlock date" value={formatDate(details.unlockAt)} />
              {typeof details.daysRemaining === "number" ? (
                <Row
                  label="Time remaining"
                  value={
                    details.daysRemaining <= 0
                      ? "Eligible now"
                      : `${details.daysRemaining} day${details.daysRemaining === 1 ? "" : "s"}`
                  }
                />
              ) : null}
              {details.lockAddress ? (
                <Row label="Lock address" value={`${details.lockAddress.slice(0, 4)}…${details.lockAddress.slice(-4)}`} />
              ) : null}
            </div>
          </div>

          <div className="rounded-[18px] border border-border bg-panel p-4 text-sm leading-6 text-muted">
            {isLock
              ? "Locked assets cannot be withdrawn before the unlock date. The timelock is enforced onchain once the vault program is live."
              : "Unlock returns tokens to your wallet only after the unlock date. Premature withdraw is never available."}
          </div>

          {!programLive ? (
            <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="flex gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={SecureIcon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">Vault program is not live yet</p>
                  <p className="mt-1 text-amber-900/80">
                    You can review this flow, but wallet signing is disabled until the onchain program is deployed.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <Toast title="Vault error" description={error} tone="error" /> : null}

          <Button className="h-12 w-full rounded-[16px]" disabled variant="primary">
            <HugeiconsIcon color="currentColor" icon={programLive ? Wallet02Icon : Clock01Icon} size={16} strokeWidth={1.8} />
            {programLive ? "Sign in wallet" : "Signing unavailable"}
          </Button>

          {!programLive ? (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted">
              <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={14} strokeWidth={1.8} />
              Prepare and confirm endpoints stay blocked while the program is offline. No wallet popup will open.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted">
              <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={14} strokeWidth={1.8} />
              When live, Oren prepares an unsigned transaction and you sign it in your wallet.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
'''

Path("app/components/vault/vault-review-modal.tsx").write_text(vault_review, encoding="utf-8")
print("wrote review modal")
