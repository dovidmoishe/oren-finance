"use client";

import { useId, useRef } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";

export function AccountMenu() {
  const auth = useOrenAuth();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  if (!auth.configured) return <span className="text-xs text-muted">Sign-in unavailable</span>;
  if (!auth.ready) return <span className="text-xs text-muted" role="status">Loading account…</span>;
  if (!auth.authenticated) return <Button onClick={auth.open} size="sm">Sign in</Button>;
  const initial = (auth.email?.[0] || "U").toUpperCase();
  const close = () => menu.current?.hidePopover();
  return <>
    <button aria-label="Open account menu" className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full bg-[#6860f5] text-base font-semibold text-white outline-offset-4 focus-visible:outline-2" popoverTarget={id} type="button">
      {initial}
    </button>
    <div className="oren-account-menu w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border bg-panel p-0 text-foreground shadow-xl" id={id} popover="auto" ref={menu}>
      <div className="flex items-center gap-3 border-b border-border p-4">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#6860f5] font-semibold text-white">{initial}</span>
        <div className="min-w-0"><p className="font-semibold">Your account</p><p className="mt-1 truncate text-sm text-muted">{auth.email || "Signed in"}</p></div>
      </div>
      <div aria-label="Account actions" className="p-2">
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-background focus-visible:outline-2" onClick={() => { close(); auth.openDeposit(); }} type="button"><svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 7v11h11" /></svg> Deposit</button>
      </div>
      <div className="border-t border-border p-2">
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => { close(); void auth.signOut(); }} type="button"><svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4" /></svg> Sign out</button>
      </div>
      {auth.error && <p className="px-5 pb-4 text-xs text-red-700" role="alert">{auth.error}</p>}
    </div>
  </>;
}
