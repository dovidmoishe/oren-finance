(() => {
  let choice = "system";
  try {
    const saved = localStorage.getItem("oren-admin-theme");
    if (saved === "light" || saved === "dark") choice = saved;
  } catch {
    // Follow the browser when storage is unavailable.
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme =
    choice === "system" ? (prefersDark ? "dark" : "light") : choice;
})();
