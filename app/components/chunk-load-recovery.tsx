"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/i18n";
import { isPersonalizedPath } from "@/i18n/locales";
import { installChunkLoadRecovery } from "@/lib/chunk-reload";

let blockedNow = false;
const listeners = new Set<() => void>();

function emitBlocked() {
  blockedNow = true;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  installChunkLoadRecovery(emitBlocked);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function chunkBlocked() {
  return blockedNow;
}

function chunkNotBlocked() {
  return false;
}

export function ChunkLoadRecovery({ banner = true }: { banner?: boolean }) {
  const t = useT();
  const blocked = useSyncExternalStore(subscribe, chunkBlocked, chunkNotBlocked);

  if (!banner || !blocked) return null;
  return (
    <div
      className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="alert"
    >
      <span>{t("auth.restoreSlow")}</span>
      <button className="font-semibold underline" onClick={() => window.location.reload()} type="button">
        {t("auth.reload")}
      </button>
    </div>
  );
}

/** Marketing pages render the banner here. Signed-in routes use the cookie locale instead. */
export function ChunkLoadRecoveryGate() {
  const pathname = usePathname();
  return <ChunkLoadRecovery banner={!isPersonalizedPath(pathname ?? "/")} />;
}
