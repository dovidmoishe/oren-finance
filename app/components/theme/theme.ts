"use client";

import { useSyncExternalStore } from "react";
import { DARK_QUERY, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from "./theme-script";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

function readPreference(): ThemePreference {
  const preference = document.documentElement.dataset.themePreference;
  return preference === "dark" || preference === "light" ? preference : "system";
}

function readResolved(): ResolvedTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The document still keeps the preference for the current visit.
  }
  const { dataset } = document.documentElement;
  dataset.themePreference = preference;
  dataset.theme = preference === "system" ? (matchMedia(DARK_QUERY).matches ? "dark" : "light") : preference;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, readResolved, () => "light");
}

function readPrimaryColor(): `#${string}` | undefined {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return color.startsWith("#") ? color as `#${string}` : undefined;
}

export function useThemePrimaryColor() {
  return useSyncExternalStore(subscribe, readPrimaryColor, () => undefined);
}
