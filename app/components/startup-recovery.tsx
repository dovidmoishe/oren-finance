"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/i18n";

const subscribe = () => () => {};
const hydrated = () => true;
const server = () => false;

/** Server-rendered recovery must work before the JavaScript it is recovering. */
export function StartupRecovery() {
  const ready = useSyncExternalStore(subscribe, hydrated, server);
  const t = useT();
  if (ready) return null;
  return (
    <div className="invisible fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl animate-[startup-recovery_0s_15s_forwards] items-center justify-between gap-4 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning shadow-sm" role="status">
      <span>{t("auth.restoreStillLoading")}</span>
      {/* Native navigation remains usable before React or the SDK can run. */}
      <a className="shrink-0 font-semibold underline" href="">{t("auth.reload")}</a>
    </div>
  );
}
