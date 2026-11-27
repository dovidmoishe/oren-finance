"use client";

import { Bell, BellRing } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { cn } from "@/components/ui/utils";
import { useI18n } from "@/i18n/i18n";
import { useReleaseReminderStore } from "@/store/release-reminder-store";
import type { MarketEvent } from "@/types";

const CLOCK_MS = 30_000;
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** One shared 30-second clock, so every bell hides once its release time passes. */
function subscribeClock(listener: () => void) {
  listeners.add(listener);
  ticker ??= setInterval(() => listeners.forEach((notify) => notify()), CLOCK_MS);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}
const clockSnapshot = () => Math.floor(Date.now() / CLOCK_MS);
const serverClock = () => 0;

/**
 * Bell for one upcoming official release: an email 15 minutes before its
 * current time. Hidden when signed out, when the release is not upcoming, and
 * when reminders are off for the account (unless one is already on).
 */
export function ReleaseReminderButton({ event }: { event: MarketEvent }) {
  const auth = useOrenAuth();
  const { t } = useI18n();
  const tick = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);
  const owner = auth.ready && auth.authenticated ? auth.userId : undefined;
  const upcoming =
    event.status === "scheduled" && event.timePrecision === "datetime" && Date.parse(event.scheduledAt) > tick * CLOCK_MS;
  const ready = useReleaseReminderStore((state) => state.owner === owner && state.loaded);
  const enabled = useReleaseReminderStore((state) => state.enabled);
  const on = useReleaseReminderStore((state) => state.owner === owner && Boolean(state.reminders[event.id]));
  const busy = useReleaseReminderStore((state) => state.owner === owner && Boolean(state.busy[event.id]));
  const notice = useReleaseReminderStore((state) => (state.owner === owner ? state.notices[event.id] : undefined));
  const load = useReleaseReminderStore((state) => state.load);
  const toggle = useReleaseReminderStore((state) => state.toggle);
  const getAccessToken = auth.getAccessToken;

  useEffect(() => {
    if (owner && upcoming) void load(owner, getAccessToken);
  }, [getAccessToken, load, owner, upcoming]);

  if (!owner || !upcoming || !ready || (!enabled && !on)) return null;
  const name = t(`calendar.market.kind.${event.kind}`);
  const label = t("calendar.reminder.set", { name });

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-live="polite" className="text-[11px] leading-tight text-muted empty:hidden" role="status">
        {notice ? t(`calendar.reminder.${notice}`) : null}
      </span>
      <button
        aria-label={label}
        aria-pressed={on}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-panel-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-wait",
          on ? "text-brand" : "text-muted hover:text-foreground",
        )}
        disabled={busy}
        onClick={() => void toggle(owner, event.id, getAccessToken)}
        title={on ? t("calendar.reminder.on", { name }) : label}
        type="button"
      >
        {on ? <BellRing aria-hidden size={14} strokeWidth={2} /> : <Bell aria-hidden size={14} strokeWidth={2} />}
      </button>
    </span>
  );
}
