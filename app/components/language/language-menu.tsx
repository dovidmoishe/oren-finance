"use client";

import { Globe02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useId, useRef } from "react";
import { cn } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import { rememberLocale } from "@/i18n/locale-sync";
import { LOCALES } from "@/i18n/locales";

/** Header globe button with a popover listing every supported language. */
export function LanguageMenu() {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { locale, t } = useI18n();
  return (
    <>
      <button
        aria-label={t("language.change")}
        className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full text-muted transition-colors hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        popoverTarget={id}
        title={t("language.title")}
        type="button"
      >
        <HugeiconsIcon aria-hidden="true" color="currentColor" icon={Globe02Icon} size={20} strokeWidth={1.6} />
      </button>
      <div aria-label={t("language.title")} className="oren-account-menu w-56 overflow-hidden rounded-2xl border border-border bg-panel p-1.5 text-foreground shadow-xl" id={id} popover="auto" ref={menu} role="menu">
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
              onClick={() => {
                menu.current?.hidePopover();
                if (selected) return;
                rememberLocale(option.code);
                router.refresh();
              }}
              role="menuitemradio"
              type="button"
            >
              <span className="flex-1">{option.name}</span>
              {selected ? <HugeiconsIcon aria-hidden="true" color="currentColor" icon={Tick02Icon} size={16} strokeWidth={2} /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
