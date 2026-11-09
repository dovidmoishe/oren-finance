// Imported by the root layout (a server component), so no hooks here.

export const THEME_STORAGE_KEY = "oren-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Inlined in <head> so `data-theme` is set before first paint (no light flash),
 * and kept in sync with the OS while the preference is "system".
 * Only the app (`.oren-app`) has dark styles; marketing pages ignore it.
 */
export const themeBootScript = `(function(){var r=document.documentElement,q=matchMedia(${JSON.stringify(DARK_QUERY)});function p(){try{return localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){return null}}function a(){var v=p();r.dataset.theme=v==="dark"||(v!=="light"&&q.matches)?"dark":"light"}a();q.addEventListener("change",a)})()`;

