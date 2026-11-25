"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocale } from "next-intl";
import {
  LEGACY_LOCALE_STORAGE_KEY,
  LOCALE_COOKIE,
  LOCALE_MAX_AGE,
  TIME_ZONE_COOKIE,
  cookieValue,
  isLocale,
  isPersonalizedPath,
  isTimeZone,
  type Locale,
} from "./locales";

/** Locale the switcher asked for, so a slower refresh cannot leave the previous language. */
let pendingLocale: Locale | null = null;
let pendingAttempts = 0;
let bootstrapped = false;

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readCookie(name: string) {
  return cookieValue(document.cookie, name);
}

/** Saves an explicit choice, including English, so Accept-Language cannot override it. */
export function rememberLocale(locale: Locale) {
  pendingLocale = locale;
  pendingAttempts = 0;
  writeCookie(LOCALE_COOKIE, locale);
  try {
    localStorage.setItem(LEGACY_LOCALE_STORAGE_KEY, locale);
  } catch {
    // The cookie still selects the language when storage is blocked.
  }
}

/**
 * Copies a saved `oren-locale` into the cookie once, remembers the time zone,
 * keeps `<html lang>` current, and follows a language change from another tab.
 * A browser that never chose a language keeps the one it asks for: other Oren
 * storage (theme, agent panel, analytics) says nothing about a language choice.
 * Only /app, /connect and /settings (`force`) refresh: marketing pages are static
 * English, so a refresh there re-downloads the same page. Their cookies still
 * reach the app on the next navigation.
 */
export function LocaleSync({ force = false }: { force?: boolean }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const enabled = force || !isPersonalizedPath(pathname);
  const refreshes = force;

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.lang = locale;
  }, [enabled, locale]);

  useEffect(() => {
    if (!enabled) return;
    if (!pendingLocale) return;
    if (pendingLocale === locale) {
      pendingAttempts = 0;
      return;
    }
    // A refresh that started before the latest click can still arrive. Retry
    // twice, then stop so a rejected cookie cannot refresh forever.
    if (!refreshes || pendingAttempts >= 2) return;
    pendingAttempts += 1;
    writeCookie(LOCALE_COOKIE, pendingLocale);
    router.refresh();
  }, [enabled, refreshes, locale, router]);

  useEffect(() => {
    if (!enabled || bootstrapped) return;
    bootstrapped = true;
    let refresh = false;
    try {
      const saved = localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
      const cookie = readCookie(LOCALE_COOKIE);
      // A saved choice whose cookie is missing: restore the cookie. Without a
      // saved choice the browser's language decides, on every visit.
      if (!pendingLocale && isLocale(saved) && !isLocale(cookie)) {
        writeCookie(LOCALE_COOKIE, saved);
        if (locale !== saved) refresh = true;
      }
    } catch {
      // Ignore blocked storage and keep the negotiated language.
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isTimeZone(zone) && readCookie(TIME_ZONE_COOKIE) !== zone) {
      writeCookie(TIME_ZONE_COOKIE, zone);
      refresh = true;
    }
    if (refresh && refreshes) router.refresh();
  }, [enabled, refreshes, locale, router]);

  useEffect(() => {
    if (!enabled) return;
    function onStorage(event: StorageEvent) {
      if (event.key !== LEGACY_LOCALE_STORAGE_KEY || !isLocale(event.newValue)) return;
      if (readCookie(LOCALE_COOKIE) === event.newValue) return;
      rememberLocale(event.newValue);
      if (refreshes) router.refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, refreshes, router]);

  return null;
}
