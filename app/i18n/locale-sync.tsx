"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocale } from "next-intl";
import {
  LEGACY_LOCALE_STORAGE_KEY,
  LOCALE_COOKIE,
  LOCALE_MAX_AGE,
  TIME_ZONE_COOKIE,
  isLocale,
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
  const prefix = `${name}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  if (!found) return undefined;
  try {
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return undefined;
  }
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
 * Copies a saved `oren-locale` into the cookie once, remembers the browser
 * time zone, keeps `<html lang>` current, and follows a language change made
 * in another tab.
 */
export function LocaleSync() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!pendingLocale) return;
    if (pendingLocale === locale) {
      pendingAttempts = 0;
      return;
    }
    // A refresh that started before the latest click can still arrive. Retry
    // twice, then stop so a rejected cookie cannot refresh forever.
    if (pendingAttempts >= 2) return;
    pendingAttempts += 1;
    writeCookie(LOCALE_COOKIE, pendingLocale);
    router.refresh();
  }, [locale, router]);

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    let refresh = false;
    try {
      const saved = localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
      if (isLocale(saved) && !isLocale(readCookie(LOCALE_COOKIE))) {
        writeCookie(LOCALE_COOKIE, saved);
        refresh = true;
      }
    } catch {
      // Ignore blocked storage and keep the negotiated language.
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isTimeZone(zone) && readCookie(TIME_ZONE_COOKIE) !== zone) {
      writeCookie(TIME_ZONE_COOKIE, zone);
      refresh = true;
    }
    if (refresh) router.refresh();
  }, [router]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== LEGACY_LOCALE_STORAGE_KEY || !isLocale(event.newValue)) return;
      if (readCookie(LOCALE_COOKIE) === event.newValue) return;
      rememberLocale(event.newValue);
      router.refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  return null;
}
