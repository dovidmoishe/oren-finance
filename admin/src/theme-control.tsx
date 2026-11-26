import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Icon } from "./ui";

type ThemeChoice = "system" | "light" | "dark";
const choices = [
  { value: "system", label: "System", glyph: Monitor },
  { value: "light", label: "Light", glyph: Sun },
  { value: "dark", label: "Dark", glyph: Moon },
] as const;

/** Appearance as a segmented control. Follows the system until a choice is saved. */
export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const saved = document.documentElement.dataset.themeChoice;
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        choice === "system" ? (media.matches ? "dark" : "light") : choice;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [choice]);

  function change(next: ThemeChoice) {
    setChoice(next);
    document.documentElement.dataset.themeChoice = next;
    try {
      localStorage.setItem("oren-admin-theme", next);
    } catch {
      // The selection still works for this page.
    }
  }

  return (
    <div
      className={`grid grid-cols-3 gap-0.5 rounded-xl border border-border bg-panel p-0.5 ${compact ? "w-fit" : ""}`}
      role="group"
      aria-label="Appearance"
    >
      {choices.map(({ value, label, glyph }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          title={label}
          className={`flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] text-xs font-medium transition-colors pointer-coarse:h-9 ${compact ? "w-8" : "px-2"} ${choice === value ? "bg-surface text-foreground shadow-xs" : "text-muted hover:text-foreground"}`}
          onClick={() => change(value)}
        >
          <Icon icon={glyph} size={14} />
          <span className={compact ? "sr-only" : ""}>{label}</span>
        </button>
      ))}
    </div>
  );
}
