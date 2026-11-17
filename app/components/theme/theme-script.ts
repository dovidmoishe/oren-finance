export const THEME_STORAGE_KEY = "oren-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";
export const THEME_CHANGE_EVENT = "oren-theme-change";

// Apply the preference before paint. Keep it in the document so an explicit
// choice still works for this visit when local storage is unavailable.
export const themeBootScript = `(function () {
  var root = document.documentElement;
  var query = matchMedia(${JSON.stringify(DARK_QUERY)});
  var key = ${JSON.stringify(THEME_STORAGE_KEY)};
  function readPreference() {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function apply(value) {
    var preference = value === "dark" || value === "light" ? value : "system";
    var resolved = preference === "system" ? (query.matches ? "dark" : "light") : preference;
    root.dataset.themePreference = preference;
    root.dataset.theme = resolved;
    window.dispatchEvent(new Event(${JSON.stringify(THEME_CHANGE_EVENT)}));
  }
  apply(readPreference());
  query.addEventListener("change", function () {
    if (root.dataset.themePreference === "system") apply("system");
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null) apply(readPreference());
  });
})();`;
