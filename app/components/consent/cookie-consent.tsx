"use client";

import { Cookie as CookieIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/utils";
import { useT } from "@/i18n/i18n";
import { isPersonalizedPath } from "@/i18n/locales";
import { CONSENT_OPEN_EVENT, openConsentSettings, setConsent } from "@/lib/consent";

const previewBar = Boolean(process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "preview" && process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER);

// Equal widths; longer translations wrap onto two balanced lines.
const choice =
  "min-h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-panel px-3 py-2 text-[13px] font-medium leading-snug text-balance text-foreground transition-colors hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-11";

/**
 * Asks once whether analytics may run. Rendered on the server and hidden by CSS:
 * the head script marks `<html data-consent="pending">` before the first paint
 * when nothing is saved, so the notice arrives with the page rather than after
 * hydration. It is fixed, so showing or hiding it never moves the page.
 */
export function CookieConsent({ placement = "page" }: { placement?: "page" | "app" }) {
  const t = useT();
  const region = useRef<HTMLElement>(null);

  useEffect(() => {
    // Someone reopened the choice from a settings link; take keyboard focus.
    const focus = () => region.current?.querySelector("button")?.focus();
    window.addEventListener(CONSENT_OPEN_EVENT, focus);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, focus);
  }, []);

  return (
    <section
      aria-label={t("cookies.label")}
      className={cn(
        "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 hidden max-w-[26rem] flex-col gap-3 rounded-2xl border border-border bg-panel p-4 text-foreground shadow-[0_18px_48px_rgb(23_23_23/0.14)] sm:inset-x-auto sm:start-4 sm:bottom-4 [html[data-consent=pending]_&]:flex print:hidden",
        previewBar && "bottom-[max(3rem,env(safe-area-inset-bottom))] sm:bottom-12",
        // The app's sidebar keeps Settings in its bottom-left corner; stay over the content.
        placement === "app" && "lg:start-1/2 lg:-translate-x-1/2",
      )}
      ref={region}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-lavender/45 text-foreground">
          <CookieIcon size={16} strokeWidth={1.7} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-[-0.01em]">{t("cookies.title")}</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">{t("cookies.body")}</p>
        </div>
      </div>
      {/* Both choices carry the same weight and take one tap. */}
      <div className="flex gap-2">
        <button className={choice} onClick={() => setConsent("denied")} type="button">{t("cookies.reject")}</button>
        <button className={choice} onClick={() => setConsent("granted")} type="button">{t("cookies.accept")}</button>
      </div>
    </section>
  );
}

/** Marketing pages render the notice here; /app, /connect and /settings render it in their own language. */
export function CookieConsentGate() {
  const pathname = usePathname();
  return isPersonalizedPath(pathname ?? "/") ? null : <CookieConsent />;
}

/** Reopens the choice so it can be changed or withdrawn as easily as it was given. */
export function CookieSettingsButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button className={className} onClick={openConsentSettings} type="button">
      {children}
    </button>
  );
}
