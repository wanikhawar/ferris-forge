async function initializeWebsite() {
  const { t } = await import("./i18n.js");

  function initializeCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      const label = button.textContent;
      button.addEventListener("click", async () => {
        const target = document.getElementById(
          button.getAttribute("data-copy"),
        );
        if (target === null) return;

        const status = document.getElementById("copy-status");
        const text = target.textContent.trim();
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = t("Copied");
          if (status !== null)
            status.textContent = t("Code copied to clipboard.");
        } catch {
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection();
          if (selection !== null) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          button.textContent = t("Selected");
          if (status !== null)
            status.textContent = t(
              "Code selected. Use your keyboard to copy it.",
            );
        }

        window.setTimeout(() => {
          button.textContent = label;
        }, 2000);
      });
    });
  }

  // Step buttons highlight the matching code lines and show one note.
  // A fragment can belong to several steps: data-step="1 3".
  function initializeStepComparisons() {
    document
      .querySelectorAll("[data-step-comparison]")
      .forEach((comparison) => {
        const buttons = comparison.querySelectorAll("[data-select-step]");
        const selectStep = (button) => {
          const selected = button.getAttribute("data-select-step");
          buttons.forEach((candidate) => {
            candidate.setAttribute(
              "aria-pressed",
              String(candidate === button),
            );
          });
          comparison.querySelectorAll("[data-step]").forEach((fragment) => {
            const steps = fragment.getAttribute("data-step").split(" ");
            fragment.classList.toggle("is-active", steps.includes(selected));
          });
          comparison.querySelectorAll("[data-step-note]").forEach((note) => {
            note.hidden = note.getAttribute("data-step-note") !== selected;
          });
        };
        buttons.forEach((button) => {
          button.addEventListener("click", () => selectStep(button));
        });
        const initial = comparison.querySelector(
          '[data-select-step][aria-pressed="true"]',
        );
        if (initial !== null) selectStep(initial);
      });
  }

  function initializeThemeSwitch() {
    const button = document.querySelector("[data-theme-switch]");
    if (button === null || window.websiteToggleTheme === undefined) return;
    const update = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.title = dark ? t("Switch to day") : t("Switch to night");
    };
    button.hidden = false;
    button.addEventListener("click", () => window.websiteToggleTheme());
    window.addEventListener("website-theme-change", update);
    update();
  }

  async function initializeStarCount() {
    const output = document.querySelector("[data-github-stars]");
    if (output === null) return;
    try {
      const response = await fetch(
        "https://api.github.com/repos/wanikhawar/ferris-forge",
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!response.ok) return;
      const { stargazers_count: stars } = await response.json();
      if (typeof stars !== "number") return;
      output.textContent = new Intl.NumberFormat(document.documentElement.lang, {
        notation: "compact",
      }).format(stars);
      output.hidden = false;
    } catch {
      // The link works without the count.
    }
  }

  initializeCopyButtons();
  initializeStepComparisons();
  initializeThemeSwitch();
  initializeStarCount();
}

initializeWebsite();
