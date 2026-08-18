/* VeilDrop UI helpers — toasts, dialogs, drawers, copy-to-clipboard, skeletons, date helpers. */
window.VeilUI = (() => {
  const icons = {
    check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    copy: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    shield: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    key: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    x: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    arrow: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    flame: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    file: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    clock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    users: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    activity: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    settings: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    fingerprint: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 11c0 5 0 8 0 10"/><path d="M17.5 8.5A8 8 0 0 1 18 12"/><path d="M7.5 8.5A8 8 0 0 0 7 12"/><path d="M12 2a7.99 7.99 0 0 0-6.76 3.5"/><path d="M20 12a7.9 7.9 0 0 0-1.1-4"/><path d="M4 12a7.9 7.9 0 0 0 .9-3.6"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    edit: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    sun: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    moon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    download: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    print: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    folder: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    bell: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  };

  function icon(name) { return icons[name] || ""; }

  const modals = [];
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modals.length) {
      e.preventDefault();
      modals[modals.length - 1]();
    }
  });
  function closeAllModals() {
    while (modals.length) modals.pop()();
  }

  function themeIcon(theme) { return icon(theme === "dark" ? "sun" : "moon"); }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  const TOAST_ICON = { success: "check", error: "alert", info: "info", warning: "alert", neutral: "info" };  function toast(message, type = "success", title = "") {
    let root = document.querySelector(".toast-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "toast-root";
      document.body.appendChild(root);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", "status");
    el.innerHTML = `
      <span class="toast-icon">${icon(TOAST_ICON[type] || "check")}</span>
      <span class="toast-message">${title ? `<strong>${title}</strong> ` : ""}${message}</span>
      <button class="btn-icon sm" aria-label="Dismiss">${icon("x")}</button>`;
    el.querySelector(".btn-icon").addEventListener("click", () => dismiss(el));
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => dismiss(el), 4600);
    return el;
  }

  function dismiss(el) {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 240);
  }

  function openDialog(html) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `<div class="dialog">${html}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    const close = (focus) => {
      const i = modals.indexOf(close);
      if (i !== -1) modals.splice(i, 1);
      overlay.classList.remove("open");
      setTimeout(() => { overlay.remove(); if (focus) focus.focus(); }, 200);
    };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(document.activeElement); });
    overlay.addEventListener("click", (e) => { if (e.target.closest("[data-dlg-close]")) close(document.activeElement); });
    overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(document.activeElement); } });
    modals.push(close);
    return { overlay, close };
  }

  function openDrawer(html, { onClose } = {}) {
    const el = document.createElement("div");
    el.className = "drawer";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="drawer-panel">${html}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => {
      const i = modals.indexOf(close);
      if (i !== -1) modals.splice(i, 1);
      el.classList.remove("open");
      setTimeout(() => { el.remove(); if (onClose) onClose(); }, 220);
    };
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
    modals.push(close);
    return { drawer: el, close };
  }

  function openPalette(items, { placeholder = "Type a command or search…" } = {}) {
    const overlay = document.createElement("div");
    overlay.className = "palette";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="palette-box">
        <div class="palette-input">
          ${icon("search")}
          <input type="text" class="input" placeholder="${esc(placeholder)}" aria-label="Command palette" spellcheck="false" />
        </div>
        <div class="palette-list" role="listbox"></div>
        <div class="palette-foot">
          <span class="kbd">↑</span><span class="kbd">↓</span> navigate · <span class="kbd">↵</span> open · <span class="kbd">esc</span> close
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    const input = overlay.querySelector("input");
    const list = overlay.querySelector(".palette-list");
    let active = 0;
    let filtered = items.slice();

    const render = () => {
      list.innerHTML = filtered.map((it, i) => `
        <button class="palette-item ${i === active ? "active" : ""}" role="option" data-i="${i}">
          <span class="palette-item-icon">${icon(it.icon || "file")}</span>
          <span class="palette-item-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="palette-item-hint">${esc(it.hint)}</span>` : ""}
        </button>`).join("") || `<div class="palette-empty">No matches</div>`;
      list.querySelectorAll(".palette-item").forEach((b) => b.addEventListener("mousemove", () => {
        active = Number(b.dataset.i);
        render();
      }));
      list.querySelectorAll(".palette-item").forEach((b) => b.addEventListener("click", () => run(Number(b.dataset.i))));
    };
    const run = (i) => {
      const it = filtered[i];
      if (!it) return;
      close();
      if (typeof it.run === "function") it.run();
      else if (it.href) window.location.hash = it.href;
    };
    const close = () => {
      const i = modals.indexOf(close);
      if (i !== -1) modals.splice(i, 1);
      overlay.classList.remove("open");
      setTimeout(() => { overlay.remove(); }, 150);
    };
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      filtered = items.filter((it) => it.label.toLowerCase().includes(q) || (it.hint || "").toLowerCase().includes(q));
      active = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === "Enter") { e.preventDefault(); run(active); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    render();
    requestAnimationFrame(() => input.focus());
    modals.push(close);
  }

  function copy(text) {
    return navigator.clipboard.writeText(text).then(
      () => { toast("Copied to clipboard."); },
      () => { toast("Clipboard unavailable — copy manually.", "error"); }
    );
  }

  function copyAttr(el) {
    el.addEventListener("click", (e) => {
      const src = e.target.closest("[data-copy]");
      if (src) { e.preventDefault(); copy(src.getAttribute("data-copy")); }
    });
  }

  /* Skeleton loading */
  function skeleton(lines = 3) {
    let out = "";
    for (let i = 0; i < lines; i++) out += `<div class="skeleton" style="height:${i === lines - 1 ? "60%" : "16px"}"></div>`;
    return out;
  }

  function setLoading(el, loading) {
    if (!el) return;
    if (loading) {
      el.setAttribute("data-loading", "true");
      el.disabled = true;
    } else {
      el.removeAttribute("data-loading");
      el.disabled = false;
    }
  }

  /* Toggle visibility for secret inputs */
  function secretToggles(root = document) {
    root.querySelectorAll("[data-secret-toggle]").forEach((btn) => {
      const input = document.getElementById(btn.getAttribute("data-secret-toggle"));
      if (!input) return;
      btn.addEventListener("click", () => {
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        btn.innerHTML = isHidden ? icons.eye : icons.eyeOff;
      });
    });
  }

  /* Date helpers */
  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function formatDateTime(iso) {
    const d = new Date(iso);
    return `${formatDate(iso)} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return formatDate(iso);
  }
  function relativeDate(daysFromNow) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d;
  }

  /* Delegated document handlers for static pages */
  function initStatic() {
    secretToggles();
    copyAttr(document);
    document.querySelectorAll("[data-dialog]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const fn = window[btn.getAttribute("data-dialog")];
        if (typeof fn === "function") fn();
      });
    });
  }

  function iconSvg(name) { return icon(name); }

  return { icon, themeIcon, esc, toast, dismiss, openDialog, openDrawer, openPalette, closeAllModals, copy, copyAttr, skeleton, setLoading, secretToggles, formatDate, formatDateTime, timeAgo, relativeDate, initStatic, icons, iconSvg };
})();
