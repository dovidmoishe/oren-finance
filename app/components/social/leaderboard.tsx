"use client";

import {
  ArrowUpRight01Icon,
  Medal01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from "@/components/ui";
import {
  buildVisibilityMessage,
  normalizeTraderSlug,
  updateTraderVisibility,
} from "@/services";
import { useSocialStore, useWalletStore } from "@/store";
import type { LeaderboardRow, SocialTimeframe } from "@/types";

const timeframes: SocialTimeframe[] = ["7D", "30D", "90D", "ALL"];
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function TraderAvatar({ row }: { row: LeaderboardRow }) {
  if (row.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${row.displayName} avatar`}
        className="h-10 w-10 rounded-full border border-border object-cover"
        src={row.avatarUrl}
      />
    );
  }

  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground font-display text-sm font-semibold text-white">
      {row.displayName.slice(0, 2).toUpperCase()}
    </div>
  );
}

function PnlText({ row }: { row: LeaderboardRow }) {
  const positive = row.pnlPct >= 0;
  return (
    <div className={cn("font-mono font-semibold", positive ? "text-positive" : "text-negative")}>
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(row.pnlPct), false)}
    </div>
  );
}

function MetricBand({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  className: string;
}) {
  return (
    <section className={cn("rounded-[24px] p-6 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", className)}>
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-xs text-foreground/65">{detail}</p>
      <p className="mt-7 font-display text-3xl font-semibold tracking-normal">{value}</p>
    </section>
  );
}

function PublishProfilePanel({ onPublished }: { onPublished: () => void }) {
  const walletAddress = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const { signMessage } = useWallet();
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedDisplay = displayName.trim() || "Oren Trader";
  const normalizedSlug = normalizeTraderSlug(slug || normalizedDisplay, walletAddress);

  const handlePublish = async () => {
    if (!walletAddress || !connected) {
      setError("Connect your wallet first.");
      return;
    }
    if (!signMessage) {
      setError("This wallet does not support message signing.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);
    setStatus(undefined);

    try {
      const message = buildVisibilityMessage({
        walletAddress,
        isPublic: true,
        slug: normalizedSlug,
        displayName: normalizedDisplay,
      });
      const signature = await signMessage(new TextEncoder().encode(message));
      await updateTraderVisibility(walletAddress, {
        isPublic: true,
        displayName: normalizedDisplay,
        slug: normalizedSlug,
        message,
        signature: encodeBase58(signature),
      });
      setStatus("Profile published. Your wallet can now appear after Oren records portfolio snapshots.");
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to publish profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-display text-lg font-semibold">Go public</h2>
        <p className="mt-1 text-sm text-muted">Opt in with a signed wallet message before your performance can rank.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block text-xs font-semibold text-muted">
          Display name
          <input
            className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel-subtle px-3 text-sm text-foreground outline-none focus:border-border-strong"
            maxLength={48}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Oren Trader"
            value={displayName}
          />
        </label>
        <label className="block text-xs font-semibold text-muted">
          Slug
          <input
            className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel-subtle px-3 text-sm text-foreground outline-none focus:border-border-strong"
            maxLength={48}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={normalizedSlug}
            value={slug}
          />
        </label>
        <p className="text-xs text-muted">Public URL: /leaderboard/{normalizedSlug || "trader"}</p>
        {error ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{error}</p> : null}
        {status ? <p className="rounded-[12px] bg-green-50 p-3 text-xs text-green-900">{status}</p> : null}
        <Button className="w-full" disabled={isSubmitting || !connected} onClick={handlePublish} variant="primary">
          {isSubmitting ? "Signing..." : "Publish profile"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function Leaderboard() {
  const timeframe = useSocialStore((state) => state.timeframe);
  const leaderboard = useSocialStore((state) => state.leaderboard);
  const isLoading = useSocialStore((state) => state.isLoading);
  const error = useSocialStore((state) => state.error);
  const loadLeaderboard = useSocialStore((state) => state.loadLeaderboard);

  useEffect(() => {
    void loadLeaderboard("30D");
  }, [loadLeaderboard]);

  const rows = leaderboard?.rows ?? [];
  const stats = leaderboard?.stats;
  const topName = stats?.topPerformer?.displayName ?? "No leader yet";
  const topReturn = stats?.topPerformer ? formatPercent(stats.topPerformer.pnlPct) : "0.00%";
  const averageReturn = formatPercent(stats?.averagePnlPct ?? 0);

  const skeletonRows = useMemo(() => Array.from({ length: 8 }), []);

  return (
    <div className="mx-auto max-w-[1540px] space-y-7 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Social trading</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Opt-in trader rankings based on Oren-observed portfolio P&amp;L. Public rankings are not audited tax records.
          </p>
        </div>
        <Tabs ariaLabel="Leaderboard timeframe" items={timeframes} onValueChange={(value) => void loadLeaderboard(value)} value={timeframe} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricBand className="bg-accent-yellow" detail={topName} label="Top Performer" value={topReturn} />
        <MetricBand className="bg-accent-pink" detail="Opted-in trader profiles" label="Public Traders" value={formatNumber(stats?.totalPublicTraders ?? 0, 0)} />
        <MetricBand className="bg-accent-lavender" detail={`${timeframe} observed return`} label="Average P&L" value={averageReturn} />
      </div>

      {error ? <ErrorState description={error} onRetry={() => void loadLeaderboard(timeframe)} /> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold">Top wallets</h2>
              <p className="mt-1 text-sm text-muted">Ranked by {timeframe} P&amp;L percentage.</p>
            </div>
            <HugeiconsIcon className="text-muted" color="currentColor" icon={Medal01Icon} size={22} strokeWidth={1.8} />
          </CardHeader>

          <div className="hidden overflow-x-auto md:block">
            <div className="grid min-w-[940px] grid-cols-[80px_minmax(240px,1.3fr)_130px_130px_150px_150px_120px] bg-panel-subtle/70 px-4 py-3 text-xs font-semibold text-foreground">
              <div>Rank</div>
              <div>Trader</div>
              <div>P&amp;L %</div>
              <div>P&amp;L $</div>
              <div>Portfolio</div>
              <div>Top holding</div>
              <div>Risk</div>
            </div>
            {isLoading && rows.length === 0
              ? skeletonRows.map((_, index) => <Skeleton className="mx-4 my-3 h-14" key={index} />)
              : rows.map((row) => <LeaderboardTableRow key={row.slug} row={row} />)}
          </div>

          <div className="space-y-3 p-4 md:hidden">
            {isLoading && rows.length === 0
              ? skeletonRows.slice(0, 4).map((_, index) => <Skeleton className="h-32" key={index} />)
              : rows.map((row) => <LeaderboardMobileRow key={row.slug} row={row} />)}
          </div>

          {!isLoading && rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                description="Published trader profiles appear here after Oren has at least one portfolio snapshot to rank."
                title="No public traders yet"
              />
            </div>
          ) : null}
        </Card>

        <div className="space-y-5">
          <PublishProfilePanel onPublished={() => void loadLeaderboard(timeframe)} />
          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground text-white">
                  <HugeiconsIcon color="currentColor" icon={UserGroupIcon} size={20} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">Copy with review</p>
                  <p className="text-xs leading-5 text-muted">Copying creates a proportional basket proposal. You still review and sign every transaction.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTableRow({ row }: { row: LeaderboardRow }) {
  return (
    <Link
      className="grid min-w-[940px] grid-cols-[80px_minmax(240px,1.3fr)_130px_130px_150px_150px_120px] items-center border-t border-border px-4 py-4 text-sm transition-colors hover:bg-panel-subtle"
      href={`/leaderboard/${row.slug}`}
    >
      <div className="font-display text-xl font-semibold">#{row.rank}</div>
      <div className="flex min-w-0 items-center gap-3">
        <TraderAvatar row={row} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.displayName}</p>
          <p className="font-mono text-xs text-muted">{row.walletPreview}</p>
        </div>
      </div>
      <PnlText row={row} />
      <div className={cn("font-mono", row.pnlUsd >= 0 ? "text-positive" : "text-negative")}>{formatCurrency(row.pnlUsd)}</div>
      <div className="font-mono">{formatCurrency(row.totalValueUsd)}</div>
      <div className="font-mono">{row.topHolding?.ticker ?? "None"}</div>
      <div className="capitalize">{row.riskLabel}</div>
    </Link>
  );
}

function LeaderboardMobileRow({ row }: { row: LeaderboardRow }) {
  return (
    <Link className="block rounded-[20px] border border-border bg-panel p-4 shadow-sm" href={`/leaderboard/${row.slug}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TraderAvatar row={row} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">#{row.rank} {row.displayName}</p>
            <p className="font-mono text-xs text-muted">{row.walletPreview}</p>
          </div>
        </div>
        <HugeiconsIcon color="currentColor" icon={ArrowUpRight01Icon} size={17} strokeWidth={1.8} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Metric label="P&L" value={`${formatPercent(row.pnlPct)} · ${formatCurrency(row.pnlUsd)}`} />
        <Metric label="Portfolio" value={formatCurrency(row.totalValueUsd)} />
        <Metric label="Top holding" value={row.topHolding?.ticker ?? "None" } />
        <Metric label="Updated" value={formatDate(row.updatedAt)} />
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-panel-subtle p-3">
      <p className="text-muted">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
    </div>
  );
}

function encodeBase58(bytes: Uint8Array) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  for (const byte of bytes) {
    if (byte === 0) digits.push(0);
    else break;
  }

  return digits.reverse().map((digit) => base58Alphabet[digit]).join("");
}
