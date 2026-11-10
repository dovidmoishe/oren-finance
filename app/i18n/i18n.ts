"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, isLocale, type Locale } from "./locales";
import en, { type Messages, type Plural } from "./messages/en";

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type MessageValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;

// English ships with the app; other languages load when they are picked.
const loaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Messages }>> = {
  "zh-CN": () => import("./messages/zh-CN"),
  "zh-TW": () => import("./messages/zh-TW"),
  fr: () => import("./messages/fr"),
  id: () => import("./messages/id"),
  vi: () => import("./messages/vi"),
  uk: () => import("./messages/uk"),
  de: () => import("./messages/de"),
  "pt-BR": () => import("./messages/pt-BR"),
};

interface I18nState {
  locale: Locale;
  t: Translate;
}

function lookup(messages: Messages, key: string, rules: Intl.PluralRules, values?: MessageValues): string | undefined {
  let value: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value === "string") return value;
  // Plural forms pick the right wording for `{count}` in this language.
  if (typeof value === "object" && value !== null && "other" in value) {
    const forms = value as Plural;
    const count = Number(values?.count ?? 0);
    return forms[rules.select(count)] ?? forms.other;
  }
  return undefined;
}

const englishRules = new Intl.PluralRules("en");

function createTranslate(messages: Messages, locale: Locale): Translate {
  const rules = new Intl.PluralRules(locale);
  return (key, values) => {
    const template = lookup(messages, key, rules, values) ?? lookup(en, key, englishRules, values) ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
  };
}

const englishState: I18nState = { locale: DEFAULT_LOCALE, t: createTranslate(en, DEFAULT_LOCALE) };
let state = englishState;
let requested: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function apply(locale: Locale) {
  requested = locale;
  if (locale === "en") {
    state = englishState;
  } else {
    const messages = (await loaders[locale]()).default;
    // A later choice won while this one was loading.
    if (requested !== locale) return;
    state = { locale, t: createTranslate(messages, locale) };
  }
  document.documentElement.lang = locale;
  emit();
}

function readSaved(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function setLocale(locale: Locale) {
  try {
    if (locale === DEFAULT_LOCALE) localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  return apply(locale);
}

if (typeof window !== "undefined") {
  const saved = readSaved();
  if (saved !== DEFAULT_LOCALE) void apply(saved);
  // Another tab changed the language.
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY) void apply(readSaved());
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Current language and its translate function. Server render is English. */
export function useI18n(): I18nState {
  return useSyncExternalStore(subscribe, () => state, () => englishState);
}

export function useT(): Translate {
  return useI18n().t;
}
