import { createMascot } from "./ferris.js";
import { t } from "./i18n.js";

function initializeHeroFerris() {
  const canvas = document.querySelector("[data-hero-ferris]");
  if (canvas === null) return;
  const button = canvas.closest("button");
  const caption = button
    .closest("figure")
    .querySelector("[data-hero-ferris-label]");
  const ferris = createMascot(canvas, { scale: 8, pad: 6 });
  ferris.setMood("happy");
  button.addEventListener("click", () => {
    const dancing = !ferris.dancing;
    ferris.setDance(dancing);
    button.setAttribute("aria-pressed", String(dancing));
    caption.textContent = dancing
      ? t("Ferris is dancing. Click to let him rest.")
      : t("Click Ferris to make him dance.");
  });
}

function initializeCompilerOutput() {
  const excerpt = document.querySelector("[data-compiler-output]");
  if (excerpt && window.matchMedia("(max-width: 640px)").matches) {
    excerpt.open = false;
  }
}

function initializeHomeNavigation() {
  const menu = document.querySelector("[data-home-nav]");
  if (menu === null) return;
  const currentLabel = menu.querySelector("[data-home-nav-current]");
  if (currentLabel === null) return;
  const wideScreen = window.matchMedia("(min-width: 1600px)");
  const entries = Array.from(menu.querySelectorAll('a[href^="#"]'))
    .map((link) => ({
      link,
      target: document.getElementById(link.getAttribute("href").slice(1)),
    }))
    .filter((entry) => entry.target !== null);
  if (entries.length === 0) return;

  const updatePosition = () => {
    const offset = wideScreen.matches ? 40 : 88;
    let current = entries[0];
    entries.forEach((entry) => {
      if (entry.target.getBoundingClientRect().top <= offset) current = entry;
    });
    if (
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 2
    ) {
      const selected = entries.find(
        (entry) => entry.link.hash === window.location.hash,
      );
      const selectedTop = selected?.target.getBoundingClientRect().top;
      current =
        selectedTop !== undefined &&
        selectedTop >= 0 &&
        selectedTop < window.innerHeight
          ? selected
          : entries[entries.length - 1];
    }
    entries.forEach((entry) => {
      if (entry === current)
        entry.link.setAttribute("aria-current", "location");
      else entry.link.removeAttribute("aria-current");
    });
    currentLabel.textContent = current.link.textContent;
  };
  const updateLayout = () => {
    menu.open = wideScreen.matches;
    updatePosition();
  };
  let scheduled = false;
  const schedulePosition = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updatePosition();
    });
  };
  entries.forEach(({ link, target }) => {
    link.addEventListener("click", () => {
      if (!wideScreen.matches) menu.open = false;
      const heading = target.querySelector("h2") ?? target;
      heading.setAttribute("tabindex", "-1");
      window.requestAnimationFrame(() =>
        heading.focus({ preventScroll: true }),
      );
    });
  });
  wideScreen.addEventListener("change", updateLayout);
  window.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("resize", schedulePosition, { passive: true });
  window.addEventListener("hashchange", schedulePosition);
  window.addEventListener("load", schedulePosition);
  updateLayout();
}

initializeHeroFerris();
initializeCompilerOutput();
initializeHomeNavigation();
