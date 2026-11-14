"use client";

import { Globe as GlobeIcon, Check as CheckIcon } from "lucide-react";

import { useRouter } from "next/navigation";
import { useId, useRef } from "react";
import { cn } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import { rememberLocale } from "@/i18n/locale-sync";
import { LOCALES, type Locale } from "@/i18n/locales";
import { persistLocale } from "@/i18n/persist-locale";
import { useAnchoredPopover } from "@/hooks/use-anchored-popover";

/** Header globe button with a popover listing every supported language. */
export function LanguageMenu() {
  const id = useId();
  const { trigger, menu, onBeforeToggle, onToggle } = useAnchoredPopover();
  const router = useRouter();
  const { locale, t } = useI18n();
  const chosenAt = useRef(0);

  function choose(code: Locale, stamp: number) {
    const mark = stamp > 0 ? stamp : chosenAt.current + 1;
    // pointerdown and the click that may follow are one tap.
    if (chosenAt.current !== 0 && mark - chosenAt.current < 700) return;
    chosenAt.current = mark;
    menu.current?.hidePopover();
    if (code === locale) return;
    rememberLocale(code);
    // Set-Cookie lands before refresh, so Safari cannot refresh with the old locale.
    void persistLocale(code).finally(() => router.refresh());
  }

  return (
    <>
      <button
        aria-label={t("language.change")}
        className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full text-muted transition-colors hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        popoverTarget={id}
        ref={trigger}
        title={t("language.title")}
        type="button"
      >
        <GlobeIcon aria-hidden="true" color="currentColor" size={20} strokeWidth={1.6} />
      </button>
      <div aria-label={t("language.title")} className="oren-account-menu" id={id} onBeforeToggle={onBeforeToggle} onToggle={onToggle} popover="auto" ref={menu} role="menu">
        <div className="oren-account-menu-surface w-56 overflow-hidden rounded-2xl border border-border bg-panel p-1.5 text-foreground shadow-xl">
          {LOCALES.map((option) => {
            const selected = locale === option.code;
            return (
              <button
                aria-checked={selected}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-panel-subtle focus-visible:outline-2",
                  selected ? "text-foreground" : "text-muted",
                )}
                key={option.code}
                lang={option.code}
                onClick={(event) => choose(option.code, event.timeStamp)}
                onPointerDown={(event) => {
                  // iOS Safari light-dismisses a popover on touch and drops the click.
                  event.preventDefault();
                  choose(option.code, event.timeStamp);
                }}
                role="menuitemradio"
                type="button"
              >
                <span className="flex-1">{option.name}</span>
                {selected ? <CheckIcon aria-hidden="true" color="currentColor" size={16} strokeWidth={2} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
