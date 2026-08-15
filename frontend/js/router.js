/* VeilDrop hash router — hash-only routing, anchor-safe. */
window.VeilRouter = (() => {
  let routes = {};

  function normalize(hash) {
    let h = (hash || "").replace(/^#/, "") || "/";
    if (h !== "/" && h.endsWith("/")) h = h.slice(0, -1);
    return h;
  }

  function register(pattern, handler) {
    routes[pattern] = handler;
  }

  function match(path) {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (pattern === path) return { handler, params: {} };
    }
    const segs = path.split("/").filter(Boolean);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (!pattern.includes(":")) continue;
      const pat = pattern.split("/").filter(Boolean);
      if (pat.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < pat.length; i++) {
        if (pat[i].startsWith(":")) params[pat[i].slice(1)] = decodeURIComponent(segs[i]);
        else if (pat[i] !== segs[i]) { ok = false; break; }
      }
      if (ok) return { handler, params };
    }
    return null;
  }

  function navigate(path) {
    window.location.hash = path;
  }

  function scrollTop() {
    const app = document.getElementById("app");
    const scroller = document.getElementById("scroller");
    if (scroller) scroller.scrollTo({ top: 0 });
    else if (app) app.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function current() { return normalize(window.location.hash); }

  function resolve() {
    const path = current();
    const m = match(path);
    const main = document.getElementById("main");
    if (!main) return;
    if (!m) {
      main.innerHTML = `
        <section class="empty" role="alert">
          <div class="empty-icon">${window.VeilUI.icon("alert")}</div>
          <h3>Page not found</h3>
          <p>That address doesn't match any VeilDrop page.</p>
          <button class="btn btn-primary" data-go="/">Back to home</button>
        </section>`;
      return;
    }
    main.scrollTop = 0;
    if (window.VeilUI && window.VeilUI.closeAllModals) window.VeilUI.closeAllModals();
    m.handler(main, m.params);
  }

  function start() {
    if (!document.getElementById("main")) {
      const app = document.getElementById("app");
      if (app) {
        app.setAttribute("id", "main");
        app.setAttribute("role", "main");
        app.setAttribute("tabindex", "-1");
      }
    }
    window.addEventListener("hashchange", resolve);
    if (!window.location.hash) window.location.hash = "#/";
    resolve();
  }

  function init(routeTable) {
    routes = routeTable || {};
    return { register, navigate, match, resolve, start, current };
  }

  return { init };
})();
