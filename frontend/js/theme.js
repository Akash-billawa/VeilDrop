/* VeilDrop theme manager — light / dark, system preference, persistence. */
window.VeilTheme = (() => {
  const KEY = "veildrop-theme";

  function current() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      if (window.VeilUI && window.VeilUI.themeIcon) b.innerHTML = window.VeilUI.themeIcon(theme);
    });
  }

  function toggle() {
    apply(current() === "dark" ? "light" : "dark");
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    const theme = saved || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(theme);
    if (window.matchMedia) {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        let cur = null;
        try { cur = localStorage.getItem(KEY); } catch (_) {}
        if (!cur) apply(e.matches ? "dark" : "light");
      });
    }
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-theme-toggle]");
      if (t) { e.preventDefault(); toggle(); }
    });
  }

  return { init, current, apply, toggle };
})();
