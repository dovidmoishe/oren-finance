import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Icon } from "./ui";

type ThemeChoice = "system" | "light" | "dark";
const glyphs = { system: Monitor, light: Sun, dark: Moon };

export function ThemeControl() {
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
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-muted">
      <Icon icon={glyphs[choice]} size={15} />
      <span className="sr-only">Appearance</span>
      <select
        className="min-h-8 cursor-pointer text-xs text-foreground"
        value={choice}
        onChange={(event) => change(event.target.value as ThemeChoice)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
