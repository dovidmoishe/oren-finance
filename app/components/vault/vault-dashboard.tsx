"use client";

import { financialExecutionEnabled } from "@/services/environment";

import {
  CircleAlert as CircleAlertIcon,
  RefreshCw as RefreshCwIcon,
  Vault as VaultIcon,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { RestoreActions, restoreBlocked } from "@/components/auth/restore-actions";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/components/ui";
import { usePortfolioStore, useVaultStore, useWalletStore } from "@/store";
import type { VaultPosition } from "@/types";
import { useI18n } from "@/i18n/i18n";
import { VaultReviewModal, type VaultReviewDetails } from "./vault-review-modal";

function defaultUnlockDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function minimumUnlockDate() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function isEligible(unlockAt: string) {
  return new Date(unlockAt).getTime() <= Date.now();
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 break-words font-money text-2xl font-medium tracking-tight tabular-nums">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-muted">{detail}</dd> : null}
    </div>
  );
}

export function VaultDashboard() {
  const auth = useOrenAuth();
  const { locale, timeZone, t } = useI18n();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);

  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);

  const summary = useVaultStore((state) => state.summary);
  const positions = useVaultStore((state) => state.positions);
  const programLive = useVaultStore((state) => state.programLive);
  const isLoading = useVaultStore((state) => state.isLoading);
  const error = useVaultStore((state) => state.error);
  const loadVaults = useVaultStore((state) => state.loadVaults);
  const resetVault = useVaultStore((state) => state.reset);

  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [unlockDate, setUnlockDate] = useState(defaultUnlockDate);
  const [minUnlockDate] = useState(minimumUnlockDate);
  const [formError, setFormError] = useState<string>();
  const [review, setReview] = useState<VaultReviewDetails>();

  const lockable = useMemo(
    () => (portfolio?.positions ?? []).filter((position) => position.availableQuantity > 0),
    [portfolio?.positions],
  );
  const selected = lockable.find((position) => position.assetId === assetId) ?? lockable[0];

  useEffect(() => {
    if (!wallet || !connected) {
      resetVault();
      return;
    }
    void loadVaults(wallet);
    void loadPortfolio(wallet);
  }, [connected, loadPortfolio, loadVaults, resetVault, wallet]);

  const upcoming = useMemo(
    () =>
      [...positions]
        .sort((a, b) => new Date(a.unlockAt).getTime() - new Date(b.unlockAt).getTime())
        .slice(0, 3),
    [positions],
  );

  const parsedAmount = Number(amount);
  const estimatedValue =
    selected && Number.isFinite(parsedAmount) ? parsedAmount * selected.priceUsd : undefined;

  function validateLock() {
    if (!connected || !wallet) return auth.authenticated ? t("vault.walletPreparing") : t("vault.signInToPreview");
    if (!selected) return t("vault.noLockable");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return t("vault.amountPositive");
    }
    if (parsedAmount > selected.availableQuantity) {
      return t("vault.amountExceeds", { available: formatNumber(selected.availableQuantity, locale) });
    }
    if (!unlockDate) return t("vault.chooseDate");
    const unlockAt = new Date(`${unlockDate}T00:00:00.000Z`);
    if (Number.isNaN(unlockAt.getTime()) || unlockAt.getTime() <= Date.now()) {
      return t("vault.dateFuture");
    }
    return undefined;
  }

  function openLockReview() {
    const validationError = validateLock();
    setFormError(validationError);
    if (validationError || !selected) return;

    const unlockAt = new Date(`${unlockDate}T00:00:00.000Z`).toISOString();
    setReview({
      mode: "lock",
      ticker: selected.ticker,
      name: selected.name,
      quantity: parsedAmount,
      valueUsd: estimatedValue,
      unlockAt,
      daysRemaining: daysUntil(unlockAt),
    });
  }

  function openUnlockReview(position: VaultPosition) {
    const eligible = isEligible(position.unlockAt);
    if (!eligible) {
      setFormError(
        t("vault.earlyWithdraw", {
          ticker: position.ticker ?? t("vault.position"),
          count: position.daysRemaining ?? daysUntil(position.unlockAt),
        }),
      );
      return;
    }
    setFormError(undefined);
    setReview({
      mode: "unlock",
      ticker: position.ticker ?? t("vault.asset"),
      name: position.name,
      quantity: position.quantity,
      valueUsd: position.valueUsd,
      unlockAt: position.unlockAt,
      lockAddress: position.lockAddress,
      daysRemaining: 0,
    });
  }

  if (!connected) {
    return (
      <div className="mx-auto max-w-[75rem] space-y-5 @lg:space-y-6">
        <header>
          <h1 className="text-2xl font-medium tracking-tight">{t("vault.title")}</h1>
        </header>
        <EmptyState
          className="min-h-[45dvh] rounded-xl border-solid shadow-none"
          icon={<VaultIcon className="mb-3 text-muted" size={28} strokeWidth={1.5} />}
          action={restoreBlocked(auth) ? <RestoreActions signInLabel={t("common.signIn")} /> : !auth.authenticated && auth.ready ? <Button disabled={auth.configured === false} onClick={auth.open}>{t("common.signIn")}</Button> : undefined}
          description={restoreBlocked(auth) ? t("auth.restoreSlow") : auth.authenticated ? auth.error || t("vault.preparingDescription") : t("vault.signInDescription")}
          title={restoreBlocked(auth) ? t("auth.restoreSlowTitle") : !auth.ready ? t("vault.restoring") : auth.authenticated ? t("vault.preparing") : t("vault.signInTitle")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[75rem] space-y-5 @lg:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <header>
          <h1 className="text-2xl font-medium tracking-tight">{t("vault.title")}</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
            {t("vault.intro")}
          </p>
        </header>
        <Button
          disabled={!financialExecutionEnabled || isLoading || !wallet}
          onClick={() => {
            if (!wallet) return;
            void loadVaults(wallet);
            void loadPortfolio(wallet, true);
          }}
          variant="secondary"
        >
          <RefreshCwIcon
            className={cn(isLoading && "animate-spin")}
            color="currentColor"
            size={16}
            strokeWidth={1.8}
          />
          {t("vault.refresh")}
        </Button>
      </div>

      {!programLive ? (
        <div className="rounded-xl border border-border bg-panel-subtle px-4 py-3 text-sm text-muted">
          <div className="flex gap-3">
            <VaultIcon className="mt-0.5 shrink-0" color="currentColor" size={18} strokeWidth={1.8} />
            <div>
              <p className="font-medium">{t("vault.offlineTitle")}</p>
              <p className="mt-1 text-xs leading-5">
                {t("vault.previewNote")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorState
          description={error}
          onRetry={() => wallet && void loadVaults(wallet)}
          title={t("vault.loadFailed")}
        />
      ) : null}

      {formError ? (
        <div role="alert" className="rounded-xl border border-error-border bg-error-surface p-4 text-sm text-error">
          <div className="flex gap-3">
            <CircleAlertIcon className="mt-0.5 shrink-0" color="currentColor" size={16} strokeWidth={1.8} />
            <p>{formError}</p>
          </div>
        </div>
      ) : null}

      <Card>
        <dl className="grid divide-y divide-border @md:grid-cols-3 @md:divide-x @md:divide-y-0">
          <Metric
            label={t("vault.totalLocked")}
            value={isLoading && !summary ? "—" : formatCurrency(summary?.totalLockedValueUsd, locale)}
          />
          <Metric
            label={t("vault.activeLocks")}
            value={isLoading && !summary ? "—" : String(positions.length)}
          />
          <Metric
            detail={
              upcoming[0]
                ? `${upcoming[0].ticker ?? t("vault.asset")} · ${formatDate(upcoming[0].unlockAt, locale, timeZone, t("common.notUpdated"))}`
                : t("vault.noUpcoming")
            }
            label={t("vault.nextUnlock")}
            value={
              upcoming[0] ? t("vault.daysShort", { count: upcoming[0].daysRemaining ?? daysUntil(upcoming[0].unlockAt) }) : "—"
            }
          />
        </dl>
      </Card>

      <div className="grid items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">{t("vaultReview.lockPosition")}</h2>
            <p className="text-sm text-muted">{t("vault.ticketSubtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && !portfolio ? <Skeleton className="h-40 rounded-lg" /> : lockable.length === 0 ? (
              <EmptyState
                className="min-h-48 rounded-lg border-0 bg-panel-subtle p-5 shadow-none"
                description={t("vault.noAvailableDescription")}
                title={t("vault.noAvailableTitle")}
              />
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span className="font-medium">{t("vault.asset")}</span>
                  <select
                    className="h-10 w-full min-w-0 rounded-lg border border-border bg-panel px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
                    onChange={(event) => setAssetId(event.target.value)}
                    value={selected?.assetId ?? ""}
                  >
                    {lockable.map((position) => (
                      <option key={position.assetId} value={position.assetId}>
                        {t("vault.availableOption", { ticker: position.ticker, available: formatNumber(position.availableQuantity, locale) })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{t("vault.amount")}</span>
                    <button
                      className="rounded text-xs font-medium text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
                      onClick={() => selected && setAmount(String(selected.availableQuantity))}
                      type="button"
                    >
                      {t("vault.max", { amount: formatNumber(selected?.availableQuantity, locale) })}
                    </button>
                  </div>
                  <input
                    className="h-10 w-full min-w-0 rounded-lg border border-border bg-panel px-3 font-money text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-focus"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    type="number"
                    value={amount}
                  />
                </label>

                <label className="block space-y-2 text-sm">
                  <span className="font-medium">{t("vault.unlockDate")}</span>
                  <input
                    className="h-10 w-full min-w-0 rounded-lg border border-border bg-panel px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
                    min={minUnlockDate}
                    onChange={(event) => setUnlockDate(event.target.value)}
                    type="date"
                    value={unlockDate}
                  />
                </label>

                <div className="border-t border-border pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{t("vault.estimatedValue")}</span>
                    <span className="font-money font-medium tabular-nums">{formatCurrency(estimatedValue, locale)}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {t("vault.noEarlyWithdraw")}
                  </p>
                </div>

                <Button className="w-full" disabled={!financialExecutionEnabled} onClick={openLockReview} variant="primary">
                  <VaultIcon color="currentColor" size={16} strokeWidth={1.8} />
                  {t("vault.reviewLock")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="text-base font-medium">{t("vault.activeLocks")}</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            {isLoading && positions.length === 0 ? (
              <div className="p-4">
                <Skeleton className="h-40" />
              </div>
            ) : positions.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  className="min-h-64 rounded-lg border-0 shadow-none"
                  description={
                    programLive
                      ? t("vault.emptyLive")
                      : t("vault.emptyOffline")
                  }
                  title={t("vault.emptyTitle")}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vault.asset")}</TableHead>
                    <TableHead>{t("vault.colQuantity")}</TableHead>
                    <TableHead>{t("vault.colValue")}</TableHead>
                    <TableHead>{t("vault.colUnlock")}</TableHead>
                    <TableHead>{t("vault.colStatus")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((position) => {
                    const eligible = isEligible(position.unlockAt);
                    const remaining = position.daysRemaining ?? daysUntil(position.unlockAt);
                    return (
                      <TableRow key={position.lockAddress}>
                        <TableCell>
                          <div>
                            <p className="font-semibold">{position.ticker ?? t("vault.asset")}</p>
                            <p className="text-xs text-muted">
                              {position.name ?? position.mint.slice(0, 8)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-money tabular-nums">{formatNumber(position.quantity, locale)}</TableCell>
                        <TableCell className="font-money tabular-nums">{formatCurrency(position.valueUsd, locale)}</TableCell>
                        <TableCell>
                          <div>
                            <p>{formatDate(position.unlockAt, locale, timeZone, t("common.notUpdated"))}</p>
                            <p className="text-xs text-muted">
                              {eligible
                                ? t("vault.eligibleNow")
                                : t("vault.daysLeft", { count: remaining })}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              eligible ? "bg-success-surface text-success" : "bg-panel-subtle text-muted",
                            )}
                          >
                            {eligible ? t("vault.eligible") : t("vault.locked")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {eligible ? <Button
                            disabled={!financialExecutionEnabled}
                            onClick={() => openUnlockReview(position)}
                            size="sm"
                            variant="secondary"
                          >
                            {t("vault.reviewUnlock")}
                          </Button> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <VaultReviewModal
        details={review}
        onClose={() => setReview(undefined)}
        open={Boolean(review)}
        programLive={programLive}
      />
    </div>
  );
}
