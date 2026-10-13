// This small, blocking head script applies the theme before the first paint.
(() => {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const storageKey = "ferris-forge-theme";
  const parseChoice = (value) =>
    value === "light" || value === "dark" ? value : null;
  let choice = null;
  let storage = null;
  try {
    storage = window.localStorage;
    choice = parseChoice(storage.getItem(storageKey));
  } catch {
    // The switch still works when browser storage is unavailable.
  }

  const applyTheme = () => {
    const theme = choice ?? (system.matches ? "dark" : "light");
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#2a1c15" : "#fff2cf";
    window.dispatchEvent(new Event("website-theme-change"));
  };

  applyTheme();
  system.addEventListener("change", () => {
    if (choice === null) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (
      storage !== null &&
      event.storageArea === storage &&
      (event.key === storageKey || event.key === null)
    ) {
      try {
        // Another tab may have written a new choice.
        choice = parseChoice(storage.getItem(storageKey));
      } catch {
        choice = null;
      }
      applyTheme();
    }
  });

  // Called by the theme switch in main.js.
  window.websiteToggleTheme = () => {
    choice = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      storage?.setItem(storageKey, choice);
    } catch {
      // Keep the choice for this page only.
    }
    applyTheme();
  };
})();
