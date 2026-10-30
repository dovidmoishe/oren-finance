"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";

// Sign-in (Privy) loads after /app renders. Start that download as soon as the
// visitor shows intent, so the account restores sooner after they land.
let privyWarmed = false;
function warmPrivy() {
  if (privyWarmed) return;
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
      <svg aria-hidden className={`col-start-1 row-start-1 transition-[opacity,transform] group-hover:translate-x-0.5 ${busy ? "opacity-0" : "opacity-100"}`} fill="none" height="16" viewBox="0 0 16 16" width="16">
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      </svg>
      <span aria-hidden className={`col-start-1 row-start-1 h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-r-transparent motion-safe:animate-spin ${busy ? "opacity-100" : "opacity-0"}`} />
      <span aria-live="polite" className="sr-only">{busy ? "Opening Oren…" : ""}</span>
    </span>
  );
}
