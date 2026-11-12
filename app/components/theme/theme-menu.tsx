"use client";

import { ComputerIcon, Moon02Icon, Sun03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useId, useRef } from "react";
import { cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n/i18n";
import { setThemePreference, useResolvedTheme, useThemePreference, type ThemePreference } from "./theme";

const options: Array<{ value: ThemePreference; label: MessageKey; icon: IconSvgElement }> = [
  { value: "system", label: "theme.system", icon: ComputerIcon },
  { value: "light", label: "theme.light", icon: Sun03Icon },
  { value: "dark", label: "theme.dark", icon: Moon02Icon },
];

export function ThemeMenu() {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const preference = useThemePreference();
  const resolved = useResolvedTheme();

  function choose(value: ThemePreference) {
    setThemePreference(value);
    popover.current?.hidePopover();
    trigger.current?.focus();
  }

  return (
    <>
      <button
        aria-label={t("theme.change")}
        className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full text-muted transition-colors hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        popoverTarget={id}
        ref={trigger}
        title={t("theme.title")}
        type="button"
      >
        <HugeiconsIcon aria-hidden="true" color="currentColor" icon={resolved === "dark" ? Moon02Icon : Sun03Icon} size={20} strokeWidth={1.6} />
      </button>
      <div className="oren-account-menu" id={id} popover="auto" ref={popover}>
        <div aria-label={t("theme.title")} className="oren-account-menu-surface w-48 overflow-hidden rounded-2xl border border-border bg-panel p-1.5 text-foreground shadow-xl" role="group">
          {options.map((option) => {
            const selected = preference === option.value;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-medium hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus",
                  selected ? "text-foreground" : "text-muted",
                )}
                key={option.value}
                onClick={() => choose(option.value)}
                onPointerDown={(event) => {
                  // Safari can light-dismiss a native popover before dispatching a touch click.
                  if (event.pointerType !== "touch") return;
                  event.preventDefault();
                  choose(option.value);
                }}
                type="button"
              >
                <HugeiconsIcon aria-hidden="true" color="currentColor" icon={option.icon} size={18} strokeWidth={1.6} />
                <span className="flex-1">{t(option.label)}</span>
                {selected ? <HugeiconsIcon aria-hidden="true" color="currentColor" icon={Tick02Icon} size={16} strokeWidth={2} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
