// Imported by the root layout (a server component), so no hooks here.

export const LOCALES = [
  { code: "en", name: "English" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "fr", name: "Français" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "uk", name: "Українська" },
  { code: "de", name: "Deutsch" },
  { code: "pt-BR", name: "Português (Brasil)" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "oren-locale";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale.code === value);
}

/** Sets `<html lang>` from the saved choice before the page paints. */
export const localeBootScript = `(function(){try{var v=localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)});if(${JSON.stringify(LOCALES.map((l) => l.code))}.indexOf(v)>0)document.documentElement.lang=v}catch(e){}})()`;
