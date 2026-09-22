"use client";

import {
  AlertCircleIcon,
  Calendar03Icon,
  Clock01Icon,
  RefreshCwIcon,
  SafeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
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

function MetricTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-border p-5 shadow-[0_18px_60px_rgba(23,23,23,0.04)]",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-normal">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </section>
  );
}

export function VaultDashboard() {
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
    if (!connected || !wallet) return "Connect a wallet to preview a lock.";
    if (!selected) return "No available portfolio positions to lock.";
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return "Enter an amount greater than zero.";
    }
    if (parsedAmount > selected.availableQuantity) {
      return `Amount exceeds available quantity (${formatNumber(selected.availableQuantity)}).`;
    }
    if (!unlockDate) return "Choose an unlock date.";
    const unlockAt = new Date(`${unlockDate}T00:00:00.000Z`);
    if (Number.isNaN(unlockAt.getTime()) || unlockAt.getTime() <= Date.now()) {
      return "Unlock date must be in the future.";
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
        `${position.ticker ?? "Position"} unlocks in ${
          position.daysRemaining ?? daysUntil(position.unlockAt)
        } day(s). Early withdraw is not available.`,
      );
      return;
    }
    setFormError(undefined);
    setReview({
      mode: "unlock",
      ticker: position.ticker ?? "Asset",
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
      <div className="space-y-5 px-4 py-6 sm:px-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Vault</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">Locked positions</h1>
        </header>
        <EmptyState
          title="Connect a wallet"
          description="Connect a Solana wallet to preview timelocked positions and the lock review flow."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Vault</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">Locked positions</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Timelock tokenized equities until a future date. Locks are enforced onchain once the vault program is live.
          </p>
        </header>
        <Button
          disabled={isLoading || !wallet}
          onClick={() => {
            if (!wallet) return;
            void loadVaults(wallet);
            void loadPortfolio(wallet);
          }}
          variant="secondary"
        >
          <HugeiconsIcon
            className={cn(isLoading && "animate-spin")}
            color="currentColor"
            icon={RefreshCwIcon}
            size={16}
            strokeWidth={1.8}
          />
          Refresh
        </Button>
      </div>

      {!programLive ? (
        <div className="rounded-[20px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex gap-3">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={SafeIcon} size={18} strokeWidth={1.8} />
            <div>
              <p className="font-semibold">Vault program is not live yet</p>
              <p className="mt-1 leading-6 text-amber-900/85">
                You can explore the full lock and unlock experience here, but signing is disabled. Prepare and confirm
                routes return unavailable until the onchain program is deployed.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorState
          description={error}
          onRetry={() => wallet && void loadVaults(wallet)}
          title="Unable to load vault"
        />
      ) : null}

      {formError ? (
        <div className="rounded-[18px] border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex gap-3">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={16} strokeWidth={1.8} />
            <p>{formError}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile
          className="bg-accent-pink"
          detail={programLive ? "Indexed onchain locks" : "Preview only — program offline"}
          label="Total locked"
          value={isLoading && !summary ? "—" : formatCurrency(summary?.totalLockedValueUsd)}
        />
        <MetricTile
          className="bg-accent-lavender"
          detail={`${positions.length} active lock${positions.length === 1 ? "" : "s"}`}
          label="Active locks"
          value={isLoading && !summary ? "—" : String(positions.length)}
        />
        <MetricTile
          className="bg-accent-yellow"
          detail={
            upcoming[0]
              ? `${upcoming[0].ticker ?? "Asset"} · ${formatDate(upcoming[0].unlockAt)}`
              : "No upcoming unlocks"
          }
          label="Next unlock"
          value={
            upcoming[0] ? `${upcoming[0].daysRemaining ?? daysUntil(upcoming[0].unlockAt)}d` : "—"
          }
        />
      </div>

      {upcoming.length ? (
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">Upcoming unlocks</h2>
            <p className="text-sm text-muted">Soonest unlock dates across your indexed vault positions.</p>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {upcoming.map((position) => (
              <div
                className="rounded-[18px] border border-border bg-panel-subtle p-4"
                key={position.lockAddress}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{position.ticker ?? "Asset"}</p>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-semibold">
                    {position.daysRemaining ?? daysUntil(position.unlockAt)}d
                  </span>
                </div>
                <p className="mt-2 font-mono text-sm">
                  {formatNumber(position.quantity)} · {formatCurrency(position.valueUsd)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <HugeiconsIcon color="currentColor" icon={Calendar03Icon} size={12} strokeWidth={1.8} />
                  {formatDate(position.unlockAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">Lock ticket</h2>
            <p className="text-sm text-muted">Preview a timelock from your available portfolio balances.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && !portfolio ? <Skeleton className="h-40" /> : null}
            {!isLoading && lockable.length === 0 ? (
              <EmptyState
                description="Buy supported equities first, then return here to preview a lock."
                title="No available positions"
              />
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span className="font-semibold">Asset</span>
                  <select
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-medium outline-none focus:border-foreground"
                    onChange={(event) => setAssetId(event.target.value)}
                    value={selected?.assetId ?? ""}
                  >
                    {lockable.map((position) => (
                      <option key={position.assetId} value={position.assetId}>
                        {position.ticker} · avail {formatNumber(position.availableQuantity)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">Amount</span>
                    <button
                      className="text-xs font-semibold text-muted hover:text-foreground"
                      onClick={() => selected && setAmount(String(selected.availableQuantity))}
                      type="button"
                    >
                      Max {formatNumber(selected?.availableQuantity)}
                    </button>
                  </div>
                  <input
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-mono outline-none focus:border-foreground"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    type="number"
                    value={amount}
                  />
                </label>

                <label className="block space-y-2 text-sm">
                  <span className="font-semibold">Unlock date</span>
                  <input
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 outline-none focus:border-foreground"
                    min={minUnlockDate}
                    onChange={(event) => setUnlockDate(event.target.value)}
                    type="date"
                    value={unlockDate}
                  />
                </label>

                <div className="rounded-[16px] border border-border bg-panel-subtle p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Estimated value</span>
                    <span className="font-mono font-medium">{formatCurrency(estimatedValue)}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    Assets cannot be withdrawn before the unlock date once the program is live.
                  </p>
                </div>

                <Button className="h-12 w-full rounded-[16px]" onClick={openLockReview} variant="primary">
                  <HugeiconsIcon color="currentColor" icon={SafeIcon} size={16} strokeWidth={1.8} />
                  Review lock
                </Button>

                {!programLive ? (
                  <p className="flex items-start gap-2 text-xs leading-5 text-muted">
                    <HugeiconsIcon
                      className="mt-0.5 shrink-0"
                      color="currentColor"
                      icon={Clock01Icon}
                      size={14}
                      strokeWidth={1.8}
                    />
                    Review opens a preview only. Sign stays disabled while the vault program is offline.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">Active locks</h2>
            <p className="text-sm text-muted">Ticker, quantity, value, unlock date, and eligibility.</p>
          </CardHeader>
          <div className="overflow-x-auto">
            {isLoading && positions.length === 0 ? (
              <div className="p-6">
                <Skeleton className="h-40" />
              </div>
            ) : positions.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  description={
                    programLive
                      ? "Locks you create will appear here after confirmation."
                      : "No indexed locks yet. New locks cannot be created until the vault program is live."
                  }
                  title="No active locks"
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Unlock</TableHead>
                    <TableHead>Status</TableHead>
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
                            <p className="font-semibold">{position.ticker ?? "Asset"}</p>
                            <p className="text-xs text-muted">
                              {position.name ?? position.mint.slice(0, 8)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{formatNumber(position.quantity)}</TableCell>
                        <TableCell className="font-mono">{formatCurrency(position.valueUsd)}</TableCell>
                        <TableCell>
                          <div>
                            <p>{formatDate(position.unlockAt)}</p>
                            <p className="text-xs text-muted">
                              {eligible
                                ? "Eligible now"
                                : `${remaining} day${remaining === 1 ? "" : "s"} left`}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              eligible ? "bg-green-100 text-green-900" : "bg-panel-subtle text-muted",
                            )}
                          >
                            {eligible ? "Eligible" : "Locked"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            disabled={!eligible}
                            onClick={() => openUnlockReview(position)}
                            size="sm"
                            variant="secondary"
                          >
                            {eligible ? "Review unlock" : "Locked"}
                          </Button>
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
