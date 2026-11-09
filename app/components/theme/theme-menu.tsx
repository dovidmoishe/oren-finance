"use client";

import { ComputerIcon, Moon02Icon, Sun03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useId } from "react";
import { cn } from "@/components/ui";
import { setThemePreference, useResolvedTheme, useThemePreference, type ThemePreference } from "./theme";

const options: Array<{ value: ThemePreference; label: string; icon: IconSvgElement }> = [
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
];

/** Header button with a small popover to pick light, dark or the system theme. */
export function ThemeMenu() {
  const id = useId();
  const preference = useThemePreference();
  const resolved = useResolvedTheme();
  return (
    <>
      <button
        aria-label="Change theme"
        className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full text-muted transition-colors hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        popoverTarget={id}
        title="Theme"
        type="button"
      >
        <HugeiconsIcon aria-hidden="true" color="currentColor" icon={resolved === "dark" ? Moon02Icon : Sun03Icon} size={20} strokeWidth={1.6} />
      </button>
      <div aria-label="Theme" className="oren-account-menu w-48 overflow-hidden rounded-2xl border border-border bg-panel p-1.5 text-foreground shadow-xl" id={id} popover="auto" role="menu">
        {options.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              aria-checked={selected}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-panel-subtle focus-visible:outline-2",
                selected ? "text-foreground" : "text-muted",
              )}
              key={option.value}
              onClick={() => setThemePreference(option.value)}
              role="menuitemradio"
              type="button"
            >
              <HugeiconsIcon aria-hidden="true" color="currentColor" icon={option.icon} size={18} strokeWidth={1.6} />
              <span className="flex-1">{option.label}</span>
              {selected ? <HugeiconsIcon aria-hidden="true" color="currentColor" icon={Tick02Icon} size={16} strokeWidth={2} /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
