"use client";
import { ArrowRight as ArrowRightIcon, LoaderCircle as LoaderCircleIcon } from "lucide-react";

import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";
import { browserHasPrivySession } from "@/components/auth/privy-session-hint";

// A saved session restores as soon as /app loads. Start that download when the
// visitor shows intent, so it is ready sooner. Signed-out visitors skip it: the
// app shows Sign in without Privy and loads it only when they choose to sign in.
let privyWarmed = false;
function warmPrivy() {
  if (privyWarmed || !browserHasPrivySession()) return;
  privyWarmed = true;
  void import("@/components/auth/privy-auth").catch(() => { privyWarmed = false; });
}

/**
 * Arrow for the "Launch" links that turns into a spinner while the link
 * navigates. Must be rendered inside a `next/link` Link. Clicks are tracked too,
 * because Next skips the link status for prefetched routes even while their
 * JavaScript downloads.
 */
export function LaunchArrow() {
  const { pending } = useLinkStatus();
  const [clicked, setClicked] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const link = anchor?.closest("a");
    if (!link) return;
    let timer: number | undefined;
    const onClick = (event: MouseEvent) => {
      // Modified clicks open a new tab; the current page is not navigating.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      warmPrivy();
      setClicked(true);
      window.clearTimeout(timer);
      // Fall back to the arrow if navigation never completes.
      timer = window.setTimeout(() => setClicked(false), 15_000);
    };
    // Returning with the back button can restore this page from the bfcache.
    const onPageShow = () => setClicked(false);
    link.addEventListener("click", onClick);
    link.addEventListener("pointerenter", warmPrivy);
    link.addEventListener("touchstart", warmPrivy, { passive: true });
    link.addEventListener("focus", warmPrivy);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      link.removeEventListener("click", onClick);
      link.removeEventListener("pointerenter", warmPrivy);
      link.removeEventListener("touchstart", warmPrivy);
      link.removeEventListener("focus", warmPrivy);
      window.removeEventListener("pageshow", onPageShow);
      window.clearTimeout(timer);
    };
  }, [anchor]);

  const busy = pending || clicked;
  return (
    <span className="relative inline-grid h-4 w-4 place-items-center" ref={setAnchor}>
      <ArrowRightIcon size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className={`col-start-1 row-start-1 transition-[opacity,transform] group-hover:translate-x-0.5 ${busy ? "opacity-0" : "opacity-100"}`} />
      {busy ? <LoaderCircleIcon size={14} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="col-start-1 row-start-1 motion-safe:animate-spin" /> : null}
      <span aria-live="polite" className="sr-only">{busy ? "Opening Oren…" : ""}</span>
    </span>
  );
}
