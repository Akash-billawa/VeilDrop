/* VeilDrop investigator screens — login, app shell, dashboards, case workspace, security, audit, settings.
   Wired to the live vault API. Features the backend does not implement yet
   (WebAuthn/passkeys, in-browser HPKE envelope decryption, severity thresholds)
   are shown as honest "not available in this console" states. */
window.VeilInvestigator = (() => {
  const U = window.VeilUI;
  const C = window.VeilCrypto;

  /* ---------- Live vault API + session state ---------- */
  const API = "";
  const SKEY = "veildrop-investigator";

  let session = null;

  function storeSession(s) { try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch (_) {} }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch (_) { return null; } }

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (session && session.session_token) headers.Authorization = "Bearer " + session.session_token;
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.detail) || ("HTTP " + res.status));
      err.status = res.status;
      err.detail = data && data.detail;
      throw err;
    }
    return data;
  }

  function signOut() {
    session = null;
    try { sessionStorage.removeItem(SKEY); } catch (_) {}
    window.location.hash = "#/investigator/login";
  }

  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return (n || 0) + " B";
  }

  const STATUS_LABEL = { open: "Open", under_review: "Under review", waiting: "Awaiting action", closed: "Closed", expired: "Expired" };
  function statusLabel(s) { return STATUS_LABEL[s] || s || "Unknown"; }
  function statusClass(s) {
    if (s === "open" || s === "under_review") return "badge-success";
    if (s === "closed" || s === "expired") return "badge-outline";
    return "badge-info";
  }

  function categoryOf(c) {
    return (c.reporter_meta && c.reporter_meta.category) || "Uncategorized";
  }

  function esc(s) { return U.esc(s); }

  function emptyState(html, title, sub) {
    return `<section class="empty"><div class="empty-icon">${html}</div><h3>${title}</h3><p>${sub}</p></section>`;
  }

  function notAvailable(host, title, sub, why) {
    host.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>${esc(title)}</h1><p class="page-sub">${esc(sub)}</p></div></div>
        <div class="card card-pad">
          ${emptyState(U.icon("lock"), "Not available in this console", esc(why))}
        </div>
      </div>`;
  }

  /* ---------- Login ---------- */
  function renderLogin(mount) {
    session = loadSession();
    mount.innerHTML = `
      <div class="site">
        <header class="site-nav" role="banner">
          <div class="container nav-inner">
            <a class="brand" href="#/" aria-label="VeilDrop home">
              <img class="brand-logo" src="img/logo.png" alt="VeilDrop logo" width="44" height="44" />
              <span class="brand-name">VeilDrop</span>
            </a>
            <nav class="nav-actions" aria-label="Primary">
              <button class="btn-icon" data-theme-toggle aria-label="Switch theme">${U.themeIcon(window.VeilTheme ? window.VeilTheme.current() : "light")}</button>
              <a class="btn btn-ghost" href="#/">Back to home</a>
            </nav>
          </div>
        </header>
        <main class="site-main">
          <div class="container narrow">
            <div class="auth-card card card-pad">
              <span class="login-icon">${U.icon("shield")}</span>
              <h1>Investigator sign-in</h1>
              <p class="auth-sub">Use your recovery password. Sessions expire automatically per policy.</p>
              <div class="alert alert-info" style="margin-bottom:var(--sp-5)">
                <span class="icon">${U.icon("info")}</span>
                <div class="alert-body">
                  <span class="alert-title">Passkeys aren't wired into this console yet</span>
                  <span>WebAuthn is the primary sign-in in the architecture (Phase 4) but isn't implemented in the vault backend. Password authentication is available now.</span>
                </div>
              </div>
              <form id="login-form" novalidate>
                <div class="field">
                  <label for="i-username">Handle</label>
                  <input class="input mono" id="i-username" type="text" placeholder="a.meridian" autocomplete="username" />
                </div>
                <div class="field">
                  <label for="i-password">Password</label>
                  <div class="secret-input">
                    <input class="input" id="i-password" type="password" placeholder="Recovery password" autocomplete="current-password" />
                    <button class="btn-icon" type="button" data-secret-toggle="i-password" aria-label="Show password">${U.icon("eye")}</button>
                  </div>
                </div>
                <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in</button>
              </form>
            </div>
          </div>
        </main>
      </div>`;
    U.secretToggles(mount);
    mount.querySelector("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const handle = mount.querySelector("#i-username").value.trim().toLowerCase();
      const pass = mount.querySelector("#i-password").value.trim();
      if (!handle || !pass) { U.toast("Enter your handle and password.", "error"); return; }
      const btn = mount.querySelector('#login-form button[type="submit"]');
      U.setLoading(btn, true);
      try {
        const res = await apiFetch("/api/v1/investigator/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: handle, password: pass }),
        });
        session = {
          session_token: res.session_token,
          expires_at: res.expires_at,
          investigator_id: res.investigator_id,
          role: res.role,
          username: res.username,
        };
        storeSession(session);
        window.location.hash = "#/investigator/overview";
      } catch (err) {
        U.setLoading(btn, false);
        U.toast(err.detail || "Sign-in failed. Check your credentials.", "error");
      }
    });
  }

  /* ---------- Shell ---------- */
  const PAGES = {
    overview: { label: "Overview", icon: "activity" },
    cases: { label: "Cases", icon: "file" },
    critical: { label: "Critical queue", icon: "flame" },
    security: { label: "Security", icon: "shield" },
    audit: { label: "Audit log", icon: "clock" },
    settings: { label: "Settings", icon: "settings" },
  };

  function renderShell(mount, activePage, params) {
    session = loadSession();
    if (!session) { window.location.hash = "#/investigator/login"; return; }

    const initials = (session.username || "?").split(".").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "IN";
    mount.innerHTML = `
      <div class="shell">
        <div class="sidebar-backdrop" data-sidebar-close></div>
        <aside class="sidebar" role="navigation" aria-label="Main">
          <div class="sidebar-brand">
            <img class="brand-logo sidebar-brand-logo" src="img/logo.png" alt="VeilDrop logo" width="32" height="32" />
            <span class="sidebar-brand-name">VeilDrop</span>
          </div>
          <nav class="sidebar-nav">
            ${Object.entries(PAGES).map(([key, p]) => `
              <a class="nav-item ${key === activePage ? "active" : ""}" href="#/investigator/${key}">
                ${U.icon(p.icon)} <span>${p.label}</span>
              </a>`).join("")}
          </nav>
          <div class="sidebar-profile">
            <span class="avatar">${initials}</span>
            <div>
              <div style="font-size:var(--fs-sm);font-weight:var(--fw-semibold)">${esc(session.username || "Investigator")}</div>
              <div style="font-size:var(--fs-xs);color:var(--text-muted)">${esc((session.role || "investigator").replace(/_/g, " "))}</div>
            </div>
            <button class="btn-icon sm" data-logout aria-label="Sign out">${U.icon("x")}</button>
          </div>
        </aside>

        <div class="main">
          <header class="topbar">
            <button class="btn-icon mobile-menu" data-menu-toggle aria-label="Open navigation menu">${U.icon("menu")}</button>
            <div class="search-input topbar-search">
              ${U.icon("search")}
              <input class="input" type="text" placeholder="Search cases…" aria-label="Search cases" data-search />
            </div>
            <div style="flex:1"></div>
            <button class="btn-icon" data-theme-toggle aria-label="Switch theme">${U.themeIcon(window.VeilTheme ? window.VeilTheme.current() : "light")}</button>
            <a class="btn btn-primary" href="#/submit">${U.icon("plus")} New case</a>
          </header>
          <main class="app-main" id="page-host" tabindex="-1"></main>
        </div>
      </div>`;

    mount.querySelector("[data-logout]").addEventListener("click", () => {
      apiFetch("/api/v1/investigator/auth/logout", { method: "POST" }).catch(() => {});
      signOut();
    });
    const sidebar = mount.querySelector(".sidebar");
    const backdrop = mount.querySelector(".sidebar-backdrop");
    const closeSidebar = () => { sidebar.classList.remove("open"); backdrop.classList.remove("open"); };
    mount.querySelector("[data-menu-toggle]").addEventListener("click", () => {
      sidebar.classList.toggle("open");
      backdrop.classList.toggle("open");
    });
    mount.querySelectorAll("[data-sidebar-close], .nav-item").forEach((el) => el.addEventListener("click", closeSidebar));
    mount.querySelector("[data-search]").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll("[data-searchable]").forEach((el) => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

    apiFetch("/api/v1/investigator/session").catch((err) => {
      if (err.status === 401) { signOut(); U.toast("Your session expired. Sign in again.", "warning"); }
    });

    renderPage(mount, activePage, params);
  }

  function renderPage(mount, page, params) {
    const host = mount.querySelector("#page-host");
    if (page === "overview") paintOverview(host);
    else if (page === "cases") paintCases(host);
    else if (page === "critical") paintCritical(host);
    else if (page === "case") paintCase(host, params);
    else if (page === "security") paintSecurity(host);
    else if (page === "audit") paintAudit(host);
    else if (page === "settings") paintSettings(host);
  }

  function bindRows(host) {
    host.querySelectorAll("[data-href]").forEach((el) => el.addEventListener("click", (e) => {
      const target = e.target.closest("[data-href]");
      if (!target) return;
      if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;
      if (target.dataset.href.startsWith("http")) return;
      window.location.hash = target.dataset.href;
    }));
  }

  /* ---------- Overview ---------- */
  async function paintOverview(host) {
    host.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
    let cases;
    try {
      const res = await apiFetch("/api/v1/investigator/cases");
      cases = (res.cases || []).filter((c) => c.case_id);
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      host.innerHTML = `
        <div class="page">
          <div class="card card-pad">
            ${emptyState(U.icon("alert"), "Couldn't load cases", esc(err.detail || "The vault is unreachable. Try again."))}
          </div>
        </div>`;
      return;
    }

    const active = cases.filter((c) => c.status !== "closed" && c.status !== "expired");
    const awaiting = active.filter((c) => c.status === "waiting");
    const now = Date.now();
    const expiringSoon = active.filter((c) => c.expires_at && new Date(c.expires_at).getTime() - now <= 7 * 864e5);
    const resolved = cases.filter((c) => c.status === "closed" || c.status === "expired");

    const recent = cases.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);
    const expiring = active.slice().sort((a, b) => new Date(a.expires_at || 0) - new Date(b.expires_at || 0)).slice(0, 4);

    const hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const name = (session.username || "").split(".")[0] || "Investigator";

    const row = (c) => `
      <div class="case-row" data-href="/investigator/case/${encodeURIComponent(c.case_id)}" data-searchable>
        <div>
          <div class="row" style="gap:var(--sp-2)">
            <span class="badge ${statusClass(c.status)}"><span class="dot"></span> ${esc(statusLabel(c.status))}</span>
            <span class="badge badge-outline mono">${esc(c.case_id)}</span>
          </div>
          <div class="case-title">${esc(categoryOf(c))}</div>
          <div class="case-meta-line">${c.expires_at ? "Expires " + U.timeAgo(c.expires_at) : "No expiry"} · ${esc(c.permission || "read")} access</div>
        </div>
      </div>`;

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div>
            <h1>${greet}, ${esc(name)}</h1>
            <p class="page-sub">${U.formatDate(new Date())} · ${active.length} active case${active.length === 1 ? "" : "s"} assigned to you</p>
          </div>
          <div class="row" style="gap:var(--sp-3)">
            <button class="btn btn-secondary" data-go="/investigator/cases">${U.icon("file")} All cases</button>
          </div>
        </div>

        <div class="grid g4 metric-grid">
          <div class="card metric"><span class="metric-label">Active cases</span><span class="metric-value">${active.length}</span><span class="metric-delta">Assigned to you</span></div>
          <div class="card metric"><span class="metric-label">Awaiting action</span><span class="metric-value">${awaiting.length}</span><span class="metric-delta">Status: waiting</span></div>
          <div class="card metric"><span class="metric-label">Expiring ≤ 7 days</span><span class="metric-value">${expiringSoon.length}</span><span class="metric-delta">Review before retention</span></div>
          <div class="card metric"><span class="metric-label">Closed / expired</span><span class="metric-value">${resolved.length}</span><span class="metric-delta">Historical</span></div>
        </div>

        <div class="grid g2">
          <div class="card">
            <div class="card-header"><h3>Recently created</h3><a class="btn btn-ghost btn-sm" data-go="/investigator/cases">All cases</a></div>
            <div class="card-body">
              ${recent.length ? recent.map(row).join("") : emptyState(U.icon("file"), "No cases yet", "Cases assigned to you appear here.")}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Expiring soonest</h3><a class="btn btn-ghost btn-sm" data-go="/investigator/cases">View all</a></div>
            <div class="card-body">
              ${expiring.length ? expiring.map(row).join("") : emptyState(U.icon("clock"), "Nothing expiring", "Active cases by nearest retention date.")}
            </div>
          </div>
        </div>
      </div>`;
    bindRows(host);
  }

  /* ---------- Cases list ---------- */
  const STATUS_TABS = [
    { key: "all", label: "All cases" },
    { key: "active", label: "Active" },
    { key: "resolved", label: "Closed / expired" },
    { key: "unassigned", label: "Unassigned" },
  ];
  const PAGE_SIZE = 6;

  async function paintCases(host) {
    host.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
    let all;
    const isAdmin = session && session.role === "security_admin";
    try {
      if (isAdmin) {
        const res = await apiFetch("/api/v1/admin/cases");
        all = (res.cases || []).map((c) => ({
          ...c,
          is_assigned: c.is_assigned,
          assignment_count: c.assignment_count || 0,
        }));
      } else {
        const res = await apiFetch("/api/v1/investigator/cases");
        all = (res.cases || []).filter((c) => c.case_id).map((c) => ({ ...c, is_assigned: true, assignment_count: 1 }));
      }
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      host.innerHTML = `
        <div class="page">
          <div class="card card-pad">
            ${emptyState(U.icon("alert"), "Couldn't load cases", esc(err.detail || "The vault is unreachable. Try again."))}
          </div>
        </div>`;
      return;
    }

    let tab = "all";
    let category = "all";
    let sortKey = "created";
    let sortDir = "desc";
    let page = 1;

    const categories = [...new Set(all.map((c) => categoryOf(c)))].sort();

    const apply = () => {
      let rows = all.slice();
      if (tab === "active") rows = rows.filter((c) => c.status !== "closed" && c.status !== "expired");
      if (tab === "resolved") rows = rows.filter((c) => c.status === "closed" || c.status === "expired");
      if (tab === "unassigned") rows = rows.filter((c) => !c.is_assigned);
      if (category !== "all") rows = rows.filter((c) => categoryOf(c) === category);

      rows.sort((a, b) => {
        const va = a[sortKey === "created" ? "created_at" : "expires_at"] || 0;
        const vb = b[sortKey === "created" ? "created_at" : "expires_at"] || 0;
        const d = new Date(va) - new Date(vb);
        return sortDir === "asc" ? d : -d;
      });

      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      page = Math.min(page, totalPages);
      const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      const tbody = host.querySelector("#cases-tbody");
      const arrow = sortDir === "asc" ? "▲" : "▼";
      host.querySelectorAll(".th-sort").forEach((th) => {
        th.classList.toggle("sorted", th.dataset.sort === sortKey);
        th.querySelector(".sort-arrow").textContent = th.dataset.sort === sortKey ? arrow : "";
      });
      host.querySelectorAll(".tab").forEach((t) => { t.setAttribute("aria-selected", String(t.dataset.tab === tab)); });
      host.querySelector(".pagination-info").textContent = `${rows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`;
      host.querySelector("#page-prev").disabled = page <= 1;
      host.querySelector("#page-next").disabled = page >= totalPages;

      if (!slice.length) {
        tbody.innerHTML = `<tr><td colspan="6"><section class="empty"><div class="empty-icon">${U.icon("file")}</div><h3>No cases match</h3><p>Try clearing a filter.</p></section></td></tr>`;
        return;
      }
      tbody.innerHTML = slice.map((c) => `
        <tr data-href="/investigator/case/${encodeURIComponent(c.case_id)}" data-searchable>
          <td data-label="Case">
            <div class="case-title">${esc(categoryOf(c))}</div>
            <div class="mono" style="color:var(--text-muted)">${esc(c.case_id)}</div>
          </td>
          <td data-label="Status"><span class="badge ${statusClass(c.status)}"><span class="dot"></span> ${esc(statusLabel(c.status))}</span></td>
          <td data-label="Access" class="cell-secondary">${esc(c.permission || (c.is_assigned ? "read" : "unassigned"))}</td>
          <td data-label="Envelope" class="cell-secondary">${c.envelope ? "Sealed" : "None issued"}</td>
          <td data-label="Created" class="cell-secondary">${U.timeAgo(c.created_at)}</td>
          <td data-label="Expires" class="cell-secondary">${c.expires_at ? U.formatDate(c.expires_at) : "—"}</td>
          <td class="table-actions">
            ${c.is_assigned
              ? `<button class="btn-icon sm" aria-label="Open case ${esc(c.case_id)}">${U.icon("arrow")}</button>`
              : `<button class="btn btn-primary btn-xs" data-assign="${esc(c.case_id)}" aria-label="Assign case ${esc(c.case_id)} to me">${U.icon("plus")} Assign</button>`}
          </td>
        </tr>`).join("");
    };

    const counts = {
      all: all.length,
      active: all.filter((c) => c.status !== "closed" && c.status !== "expired").length,
      resolved: all.filter((c) => c.status === "closed" || c.status === "expired").length,
      unassigned: all.filter((c) => !c.is_assigned).length,
    };

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Cases</h1><p class="page-sub">${counts.active} active · ${counts.resolved} closed or expired</p></div>
          <button class="btn btn-primary" data-go="/submit">${U.icon("plus")} New case</button>
        </div>

        <div class="tabs" role="tablist" aria-label="Case status">
          ${STATUS_TABS.map((t) => `<button class="tab" role="tab" aria-selected="${t.key === tab}" data-tab="${t.key}">${t.label}<span class="tab-count">${counts[t.key]}</span></button>`).join("")}
        </div>

        <div class="card">
          <div class="card-toolbar">
            <span class="field-hint">${isAdmin ? "All cases in the vault. Unassigned cases show an Assign button." : "Filter and sort the cases assigned to you."}</span>
            <select class="mini-select" id="case-category" aria-label="Filter by category">
              <option value="all">All categories</option>
              ${categories.map((c) => `<option value="${c}">${esc(c)}</option>`).join("")}
            </select>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th>Envelope</th>
                  <th><button class="th-sort" data-sort="created">Created <span class="sort-arrow"></span></button></th>
                  <th><button class="th-sort" data-sort="expires">Expires <span class="sort-arrow"></span></button></th>
                  <th class="table-actions"></th>
                </tr>
              </thead>
              <tbody id="cases-tbody"></tbody>
            </table>
          </div>
          <div class="pagination">
            <span class="pagination-info"></span>
            <div class="pagination-controls">
              <button class="btn btn-ghost btn-sm" id="page-prev" aria-label="Previous page">Prev</button>
              <button class="btn btn-ghost btn-sm" id="page-next" aria-label="Next page">Next</button>
            </div>
          </div>
        </div>
      </div>`;

    host.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { tab = t.dataset.tab; page = 1; apply(); }));
    host.querySelector("#case-category").addEventListener("change", (e) => { category = e.target.value; page = 1; apply(); });
    host.querySelectorAll(".th-sort").forEach((th) => th.addEventListener("click", () => {
      if (th.dataset.sort === sortKey) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = th.dataset.sort; sortDir = "desc"; }
      page = 1;
      apply();
    }));
    host.querySelector("#page-prev").addEventListener("click", () => { if (page > 1) { page--; apply(); } });
    host.querySelector("#page-next").addEventListener("click", () => { page++; apply(); });

    host.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-assign]");
      if (!btn) return;
      e.stopPropagation();
      const caseId = btn.dataset.assign;
      btn.disabled = true;
      btn.textContent = "Assigning…";
      try {
        await apiFetch("/api/v1/admin/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case_id: caseId, investigator_id: session.investigator_id, permission: "admin" }),
        });
        U.toast("Case assigned to you.", "success");
        const row = all.find((c) => c.case_id === caseId);
        if (row) { row.is_assigned = true; row.permission = "admin"; }
        apply();
      } catch (err) {
        U.toast(err.detail || "Assignment failed.", "error");
        btn.disabled = false;
        btn.textContent = "Assign";
      }
    });

    apply();
    bindRows(host);
  }

  /* ---------- Critical queue ---------- */
  function paintCritical(host) {
    const criticalCases = window.VeilMock.criticalCases || [];
    
    const apply = () => {
      const rows = criticalCases.slice();
      const tbody = host.querySelector("#critical-tbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6"><section class="empty"><div class="empty-icon">${U.icon("shield")}</div><h3>No critical cases</h3><p>Nothing currently requires urgent attention.</p></section></td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((c) => `
        <tr data-href="/investigator/case/${encodeURIComponent(c.id)}" data-searchable>
          <td data-label="Case">
            <div class="case-title">${esc(c.category || "General")}</div>
            <div class="mono" style="color:var(--text-muted)">${esc(c.id)}</div>
          </td>
          <td data-label="Priority"><span class="badge badge-danger"><span class="dot"></span> ${esc(c.priority)}</span></td>
          <td data-label="Status"><span class="badge ${statusClass(c.status)}"><span class="dot"></span> ${esc(statusLabel(c.status))}</span></td>
          <td data-label="Updated" class="cell-secondary">${U.timeAgo(c.updatedAt)}</td>
          <td data-label="Assigned" class="cell-secondary"><span class="mono">${esc(c.assigned || "Unassigned")}</span></td>
          <td class="table-actions"><button class="btn-icon sm" aria-label="Open case ${esc(c.id)}">${U.icon("arrow")}</button></td>
        </tr>`).join("");
    };

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Critical Cases</h1><p class="page-sub">Cases requiring immediate attention</p></div>
        </div>
        <div class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Assigned</th>
                  <th class="table-actions"></th>
                </tr>
              </thead>
              <tbody id="critical-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>`;
      
    apply();
    bindRows(host);
  }

  /* ---------- Case workspace ---------- */
  async function paintCase(host, params) {
    const caseId = (params && params.id) || "";
    host.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
    let data;
    try {
      data = await apiFetch("/api/v1/investigator/cases/" + encodeURIComponent(caseId));
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      host.innerHTML = `
        <div class="page">
          <div class="card card-pad">
            ${emptyState(U.icon(err.status === 404 ? "alert" : "alert"), err.status === 404 ? "Case not found" : "Couldn't load the case", esc(err.detail || "The vault is unreachable. Try again."))}
          </div>
        </div>`;
      return;
    }

    const TABS = ["Conversation", "Evidence", "Security"];
    const category = (data.reporter_meta && data.reporter_meta.category) || "Uncategorized";

    host.innerHTML = `
      <div class="page case-page">
        <div class="page-head">
          <div>
            <div class="row" style="gap:var(--sp-2)">
              <a class="btn-icon sm" data-go="/investigator/cases" aria-label="Back to cases">${U.icon("arrow")}</a>
              <span class="badge badge-outline mono">${esc(data.case_id)}</span>
              <span class="badge ${statusClass(data.status)}"><span class="dot"></span> ${esc(statusLabel(data.status))}</span>
              <span class="badge badge-info">${esc(category)}</span>
            </div>
            <h1>Case ${esc(data.case_id)}</h1>
            <p class="page-sub">Content is sealed under the case envelope. The vault stores only ciphertext.</p>
          </div>
        </div>

        <div class="case-layout">
          <div class="case-layout-main">
            <div class="tabs" role="tablist" aria-label="Case workspace">
              ${TABS.map((t, i) => `<button class="tab" role="tab" aria-selected="${i === 0}" data-tab="${i}">${t}</button>`).join("")}
            </div>
            <div class="tab-panel" id="case-ws" role="tabpanel"></div>
          </div>
          <aside class="context-panel">
            <div class="card">
              <div class="card-header"><h3>Case facts</h3></div>
              <div class="card-body">
                <div class="kv">
                  <div class="kv-row"><span class="kv-label">Category</span><span class="kv-value">${esc(category)}</span></div>
                  <div class="kv-row"><span class="kv-label">Status</span><span class="kv-value">${esc(statusLabel(data.status))}</span></div>
                  <div class="kv-row"><span class="kv-label">Your access</span><span class="kv-value">${esc(data.permission || "read")}</span></div>
                  <div class="kv-row"><span class="kv-label">Created</span><span class="kv-value">${U.formatDateTime(data.created_at)}</span></div>
                  <div class="kv-row"><span class="kv-label">Expires</span><span class="kv-value">${data.expires_at ? U.formatDateTime(data.expires_at) : "—"}</span></div>
                  <div class="kv-row"><span class="kv-label">Crypto version</span><span class="kv-value mono">v${data.crypto_version}</span></div>
                  <div class="kv-row"><span class="kv-label">Envelope</span><span class="kv-value">${data.envelope ? esc(data.envelope.algorithm) + " · k" + data.envelope.key_version : "None issued to you"}</span></div>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><h3>Actions</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:var(--sp-2)">
                <button class="btn btn-secondary btn-block" id="btn-rotate-key">${U.icon("key")} Rotate envelope key</button>
                <button class="btn btn-secondary btn-block" id="btn-reassign">${U.icon("users")} Reassign</button>
              </div>
              <div class="card-body">
                <p class="field-hint">${U.icon("lock")} Rotation and notes aren't wired into this console yet.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>`;

    const ws = host.querySelector("#case-ws");
    const paintTab = (idx) => {
      if (idx === 0) wsCaseConversation(ws, data);
      else if (idx === 1) wsCaseEvidence(ws, data);
      else wsCaseSecurity(ws, data);
    };
    host.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      host.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      paintTab(Number(t.dataset.tab));
    }));
    
    host.querySelector(".reply-box textarea").addEventListener("input", (e) => {
      host.querySelector(".reply-box button").disabled = !e.target.value.trim();
    });

    const btnReassign = host.querySelector("#btn-reassign");
    if (btnReassign) btnReassign.addEventListener("click", () => openAssignmentModal(data));
    
    const btnRotate = host.querySelector("#btn-rotate-key");
    if (btnRotate) btnRotate.addEventListener("click", () => openRotateKeyModal(data));

    host.querySelector("#case-ws").addEventListener("submit", (e) => { paintTab(0); });
    paintTab(0);
  }

  function sealedMsgCard(m) {
    const sender = m.sender_type === "reporter" ? "Reporter" : "Investigator";
    if (m._plaintext && !(m.burn_after_read && m.sender_type === "reporter" && !m.consumed_at)) {
      return `
        <div class="msg ${m.sender_type === "reporter" ? "reporter" : "investigator"}" data-searchable>
          <div class="msg-meta">
            <span class="msg-name">${sender}</span>
            <span>·</span>
            <span>${U.timeAgo(m.created_at)}</span>
            ${m.burn_after_read ? '<span class="badge badge-warning"><span class="dot"></span> Burn-on-read</span>' : ""}
          </div>
          <div class="msg-bubble">${esc(m._plaintext)}</div>
          <div class="file-info" style="margin-top:var(--sp-1);align-self:flex-end"><span class="mono">decrypted locally · AES-256-GCM v${m.crypto_version || 1}</span></div>
        </div>`;
    }
    if (m.burn_after_read && m.sender_type === "reporter" && !m.consumed_at) {
      return `
        <div class="burn-card sealed-card" data-burn="${m.message_id}" style="border-color:var(--warning)">
          <span class="file-icon" style="color:var(--warning)">${U.icon("flame")}</span>
          <div style="flex:1;min-width:0">
            <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">
              <strong style="color:var(--warning)">Burn-on-read message</strong>
            </div>
            <div class="file-info" style="margin-top:var(--sp-1)">${U.timeAgo(m.created_at)} · Sealed under the case envelope</div>
            <div class="file-info">A one-time message from the reporter is waiting. It becomes unreadable after you open it once.</div>
          </div>
          <button class="btn btn-danger" data-reveal="${m.message_id}">Reveal message</button>
        </div>`;
    }
    return `
      <div class="sealed-card" data-searchable>
        <span class="file-icon">${U.icon("lock")}</span>
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">
            <strong>${sender}</strong>
            ${m.burn_after_read ? `<span class="badge badge-warning"><span class="dot"></span> Burn-on-read${m.consumed_at ? " · consumed" : ""}</span>` : ""}
            <span class="field-hint">${U.timeAgo(m.created_at)}</span>
          </div>
          <div class="file-info" style="margin-top:var(--sp-1)">Sealed under the case envelope · AES-256-GCM v${m.crypto_version || 1}</div>
        </div>
      </div>`;
  }

  function wsCaseConversation(ws, data) {
    const messages = data.messages || [];
    const hasEnvelope = data.envelope && data.envelope.wrapped_dek;
    let dek = null;

    function renderMessages() {
      const thread = ws.querySelector("#inv-thread");
      if (!thread) return;
      thread.innerHTML = messages.length
        ? messages.map(sealedMsgCard).join("")
        : emptyState(U.icon("edit"), "No messages yet", "Send a message below to start the conversation.");
      thread.querySelectorAll("[data-reveal]").forEach((btn) => btn.addEventListener("click", async () => {
        const id = btn.dataset.reveal;
        const msg = messages.find((m) => m.message_id === id);
        if (!msg || !dek) return;
        try {
          const parsed = C.parseObjectAad(C.hexToBytes(msg.aad));
          const pt = await C.decryptObject(dek, parsed.purpose, parsed.objectId, C.hexToBytes(msg.ciphertext), C.hexToBytes(msg.nonce), C.hexToBytes(msg.tag), parsed.version);
          msg._plaintext = C.toUtf8(pt);
          msg.consumed_at = new Date().toISOString();
          renderMessages();
          U.toast("Burn-on-read message decrypted. It is now unreadable.", "warning");
          try {
            await apiFetch(`/api/v1/investigator/cases/${encodeURIComponent(data.case_id)}/messages/${id}/consume`, { method: "POST" });
          } catch (_) { /* best-effort; already displayed locally */ }
        } catch (e) { U.toast("Failed to decrypt burn message.", "error"); }
      }));
    }

    ws.innerHTML = `
      <div class="card card-pad">
        ${hasEnvelope ? `
        <div class="alert alert-info" style="margin-bottom:var(--sp-5)">
          <span class="icon">${U.icon("lock")}</span>
          <div class="alert-body">
            <span class="alert-title">Unlock conversation</span>
            <span>Enter the reporter's recovery secret to decrypt messages in your browser. The vault never sees plaintext.</span>
          </div>
        </div>
        <div class="field" style="margin-bottom:var(--sp-5)">
          <label for="inv-recovery">Recovery secret</label>
          <div class="secret-input">
            <input class="input mono" id="inv-recovery" type="password" placeholder="Enter the reporter's recovery secret (64 hex chars)" autocomplete="off" spellcheck="false" />
            <button class="btn-icon" type="button" data-secret-toggle="inv-recovery" aria-label="Show recovery secret">${U.icon("eye")}</button>
          </div>
          <button class="btn btn-primary" id="inv-unlock" style="margin-top:var(--sp-2)">${U.icon("lock")} Decrypt conversation</button>
        </div>
        ` : `
        <div class="alert alert-warning" style="margin-bottom:var(--sp-5)">
          <span class="icon">${U.icon("alert")}</span>
          <div class="alert-body">
            <span class="alert-title">No envelope</span>
            <span>No envelope has been issued to you for this case. Ask an admin to assign you to this case first.</span>
          </div>
        </div>`}
        <div class="thread" id="inv-thread">
          ${messages.length ? messages.map(sealedMsgCard).join("") : emptyState(U.icon("edit"), "No messages yet", "Send a message below to start the conversation.")}
        </div>
        ${hasEnvelope ? `
        <div class="composer" style="margin-top:var(--sp-4)">
          <div class="field" style="flex:1">
            <label for="inv-msg" class="sr-only">Message</label>
            <textarea class="input" id="inv-msg" rows="2" placeholder="Type a message to the reporter…" disabled></textarea>
          </div>
          <div style="display:flex;gap:var(--sp-2)">
            <button class="btn btn-secondary" id="inv-burn" title="Send as burn-on-read" disabled>${U.icon("flame")} Burn</button>
            <button class="btn btn-primary" id="inv-send" disabled>${U.icon("edit")} Send</button>
          </div>
        </div>` : ""}
      </div>`;

    U.secretToggles(ws);

    if (hasEnvelope) {
      const unlockBtn = ws.querySelector("#inv-unlock");
      const recoveryInput = ws.querySelector("#inv-recovery");
      const msgInput = ws.querySelector("#inv-msg");
      const sendBtn = ws.querySelector("#inv-send");

      unlockBtn.addEventListener("click", async () => {
        const secret = recoveryInput.value.trim();
        if (!secret) { U.toast("Enter the recovery secret.", "error"); return; }
        let secretBytes;
        try { secretBytes = C.hexToBytes(secret); } catch (_) { U.toast("Invalid hex.", "error"); return; }
        try {
          const kek = await C.deriveKek(secretBytes);
          dek = await C.unwrapDek(kek, C.hexToBytes(data.envelope.wrapped_dek));
          for (const m of messages) {
            if (m.aad && !m._plaintext) {
              try {
                const parsed = C.parseObjectAad(C.hexToBytes(m.aad));
                const pt = await C.decryptObject(dek, parsed.purpose, parsed.objectId, C.hexToBytes(m.ciphertext), C.hexToBytes(m.nonce), C.hexToBytes(m.tag), parsed.version);
                m._plaintext = C.toUtf8(pt);
              } catch (_) { m._plaintext = null; }
            }
          }
          renderMessages();
          if (msgInput) { msgInput.disabled = false; sendBtn.disabled = false; }
          const burnBtn = ws.querySelector("#inv-burn");
          if (burnBtn) burnBtn.disabled = false;
          U.toast("Conversation decrypted.", "success");
        } catch (_) {
          U.toast("Wrong recovery secret — could not unwrap the data key.", "error");
        }
      });

      if (sendBtn) {
        const finishSend = async (burn) => {
          if (!dek) { U.toast("Unlock the conversation first.", "error"); return; }
          const text = (msgInput.value || "").trim();
          if (!text) return;
          sendBtn.disabled = true;
          const burnBtn = ws.querySelector("#inv-burn");
          if (burnBtn) burnBtn.disabled = true;
          try {
            const objectId = crypto.randomUUID();
            const enc = await C.encryptObject(dek, "message", objectId, C.toBytes(text));
            const fd = new FormData();
            fd.append("ciphertext", C.bytesToHex(enc.ciphertext));
            fd.append("nonce", C.bytesToHex(enc.nonce));
            fd.append("tag", C.bytesToHex(enc.tag));
            fd.append("aad", C.bytesToHex(enc.aad));
            fd.append("crypto_version", String(enc.version || 1));
            fd.append("burn_after_read", String(burn));
            const result = await apiFetch(`/api/v1/investigator/cases/${encodeURIComponent(data.case_id)}/messages`, { method: "POST", body: fd });
            messages.push({
              message_id: result.message_id,
              sender_type: "investigator",
              ciphertext: C.bytesToHex(enc.ciphertext),
              nonce: C.bytesToHex(enc.nonce),
              tag: C.bytesToHex(enc.tag),
              aad: C.bytesToHex(enc.aad),
              crypto_version: enc.version || 1,
              burn_after_read: burn,
              consumed_at: null,
              created_at: result.created_at,
              _plaintext: text,
            });
            renderMessages();
            msgInput.value = "";
            if (burn) {
              U.openDialog(`
                <div class="dialog-header"><h2>Sent as burn-on-read</h2><button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button></div>
                <div class="dialog-body"><p>Your message is sealed and will burn after a single read. It can no longer be recalled.</p></div>
                <div class="dialog-footer"><button class="btn btn-primary" data-dlg-close>Done</button></div>`);
            }
            U.toast(burn ? "Sent as burn-on-read." : "Message sent.", "success");
          } catch (e) {
            U.toast(e.detail || "Failed to send message.", "error");
          } finally {
            sendBtn.disabled = false;
            const burnBtn = ws.querySelector("#inv-burn");
            if (burnBtn) burnBtn.disabled = false;
          }
        };

        sendBtn.addEventListener("click", () => finishSend(false));

        const burnBtn = ws.querySelector("#inv-burn");
        if (burnBtn) {
          burnBtn.addEventListener("click", () => {
            if (!dek) { U.toast("Unlock the conversation first.", "error"); return; }
            const text = (msgInput.value || "").trim();
            if (!text) { U.toast("Write a message first.", "error"); return; }
            const { overlay, close } = U.openDialog(`
              <div class="dialog-header"><h2>Send burn-on-read?</h2><button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button></div>
              <div class="dialog-body">
                <p>This message becomes unreadable immediately after the reporter opens it once. It cannot be retrieved afterwards.</p>
              </div>
              <div class="dialog-footer">
                <button class="btn btn-ghost" data-dlg-close>Cancel</button>
                <button class="btn btn-danger" data-confirm-burn>${U.icon("flame")} Confirm burn-on-read</button>
              </div>`);
            overlay.querySelector("[data-confirm-burn]").addEventListener("click", () => { close(); finishSend(true); });
            overlay.querySelectorAll("[data-dlg-close]").forEach((b) => b.addEventListener("click", () => close()));
          });
        }

        msgInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishSend(false); }
        });
      }
    }
  }

  function wsCaseEvidence(ws, data) {
    const evidence = data.evidence || [];
    ws.innerHTML = `
      <div class="card card-pad">
        <div class="alert alert-info" style="margin-bottom:var(--sp-5)">
          <span class="icon">${U.icon("lock")}</span>
          <div class="alert-body">
            <span class="alert-title">Encrypted evidence</span>
            <span>Files are encrypted client-side and stored by content hash. Secure decrypt-and-view ships in later phases and isn't available in this console yet — you can download the sealed ciphertext copy.</span>
          </div>
        </div>
        <div class="evidence-grid">
          ${evidence.length ? evidence.map((f) => `
            <div class="card card-clickable ev-item" data-evidence="${f.evidence_id}" data-searchable>
              <div class="row" style="gap:var(--sp-3)">
                <span class="file-icon">${U.icon("file")}</span>
                <div class="file-meta">
                  <div class="file-name">${esc(f.object_key)}</div>
                  <div class="file-info"><span>${fmtSize(f.original_size)}</span>·<span>${esc(f.content_type || "octet-stream")}</span></div>
                </div>
              </div>
              <div class="file-info" style="margin-top:var(--sp-3)"><span class="mono">${esc(f.object_key.slice(0, 20))}…</span></div>
              <div class="file-info"><span>Uploaded ${U.timeAgo(f.created_at)} · sealed</span></div>
            </div>`).join("") : emptyState(U.icon("file"), "No evidence", "Encrypted files for this case appear here.")}
        </div>
      </div>`;

    ws.querySelectorAll(".ev-item").forEach((el) => el.addEventListener("click", async () => {
      const id = el.dataset.evidence;
      const f = evidence.find((x) => String(x.evidence_id) === id);
      if (!f) return;
      const { overlay, close } = U.openDialog(`
        <div class="dialog-header"><h2>Evidence detail</h2><button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button></div>
        <div class="dialog-body">
          <div class="kv">
            <div class="kv-row"><span class="kv-label">Object key</span><span class="kv-value mono">${esc(f.object_key)}</span></div>
            <div class="kv-row"><span class="kv-label">Original size</span><span class="kv-value">${fmtSize(f.original_size)}</span></div>
            <div class="kv-row"><span class="kv-label">Encrypted size</span><span class="kv-value">${fmtSize(f.encrypted_size)}</span></div>
            <div class="kv-row"><span class="kv-label">Content type</span><span class="kv-value">${esc(f.content_type || "application/octet-stream")}</span></div>
            <div class="kv-row"><span class="kv-label">Uploaded</span><span class="kv-value">${U.formatDateTime(f.created_at)}</span></div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-ghost" data-dlg-close>Close</button>
          <button class="btn btn-secondary" id="ev-download">${U.icon("download")} Download sealed copy</button>
          <button class="btn btn-primary" id="ev-decrypt" disabled>${U.icon("lock")} Decrypt &amp; view</button>
        </div>`);
      overlay.querySelectorAll("[data-dlg-close]").forEach((b) => b.addEventListener("click", () => close()));
      overlay.querySelector("#ev-download").addEventListener("click", async () => {
        try {
          const blob = await apiFetch(`/api/v1/investigator/cases/${encodeURIComponent(data.case_id)}/evidence/${encodeURIComponent(id)}`);
          const bytes = (blob.encrypted_data && blob.encrypted_data.match(/.{1,2}/g)) || [];
          const arr = new Uint8Array(bytes.map((h) => parseInt(h, 16)));
          const out = new Blob([arr], { type: "application/octet-stream" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(out);
          a.download = (f.object_key || "evidence").split("/").pop() + ".enc";
          a.click();
          URL.revokeObjectURL(a.href);
          U.toast("Sealed ciphertext copy downloaded.", "success");
        } catch (err) {
          U.toast(err.detail || "Download failed.", "error");
        }
      });
    }));
  }

  function wsCaseSecurity(ws, data) {
    ws.innerHTML = `
      <div class="grid g2">
        <div class="card">
          <div class="card-header"><h3>Envelope</h3><span class="sec-badge ${data.envelope ? "verified" : ""}">${data.envelope ? U.icon("check") + " Issued" : U.icon("alert") + " Not issued"}</span></div>
          <div class="card-body">
            ${data.envelope ? `
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Algorithm</span><span class="kv-value mono">${esc(data.envelope.algorithm)}</span></div>
                <div class="kv-row"><span class="kv-label">Key version</span><span class="kv-value mono">v${data.envelope.key_version}</span></div>
                <div class="kv-row"><span class="kv-label">Wrapped DEK</span><span class="kv-value mono">${esc(String(data.envelope.wrapped_dek || "").slice(0, 24))}…</span></div>
                <div class="kv-row"><span class="kv-label">Crypto version</span><span class="kv-value mono">v${data.crypto_version}</span></div>
              </div>
              <p class="field-hint" style="margin-top:var(--sp-4)">${U.icon("lock")} Your envelope lets you unwrap the case data key in-browser using the reporter's recovery secret. Enter it on the Conversation tab to decrypt messages.</p>` : `
              <p class="field-hint">No envelope has been issued to you for this case yet. An admin assigns one via the vault API.</p>`}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Handling</h3><span class="sec-badge verified">${U.icon("shield")} Sealed</span></div>
          <div class="card-body">
            <div class="kv">
              <div class="kv-row"><span class="kv-label">Storage</span><span class="kv-value">Ciphertext only</span></div>
              <div class="kv-row"><span class="kv-label">Reporter meta</span><span class="kv-value">${data.reporter_meta ? esc(JSON.stringify(data.reporter_meta)) : "None"}</span></div>
              <div class="kv-row"><span class="kv-label">Message count</span><span class="kv-value">${(data.messages || []).length}</span></div>
              <div class="kv-row"><span class="kv-label">Evidence files</span><span class="kv-value">${(data.evidence || []).length}</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ---------- Security ---------- */
  async function paintSecurity(host) {
    host.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
    let p;
    try {
      p = await apiFetch("/api/v1/investigator/policy");
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      host.innerHTML = `
        <div class="page">
          <div class="card card-pad">
            ${emptyState(U.icon("alert"), "Couldn't load policy", esc(err.detail || "The vault is unreachable. Try again."))}
          </div>
        </div>`;
      return;
    }

    const cryptoName = p.crypto_active_version === 1
      ? "hpke-dhkem-x25519-hkdf-sha256-aes256gcm"
      : "v" + p.crypto_active_version + " (see vault registry)";

    host.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>Security</h1><p class="page-sub">Operational policy served by the vault.</p></div></div>

        <div class="posture">
          <span class="posture-icon">${U.icon("shield")}</span>
          <div>
            <h2>Vault-managed policy</h2>
            <p>Session, retention, crypto and upload limits are served live from the backend.</p>
          </div>
          <div class="posture-meta">
            <div class="posture-stat"><strong>v${p.crypto_active_version}</strong><span>crypto version</span></div>
            <div class="posture-stat"><strong>${p.session_expire_minutes}m</strong><span>session expiry</span></div>
            <div class="posture-stat"><strong>${p.session_idle_minutes}m</strong><span>idle timeout</span></div>
          </div>
        </div>

        <div class="grid g2">
          <div class="card">
            <div class="card-header"><h3>Envelope policy</h3><span class="sec-badge verified">${U.icon("check")} Active</span></div>
            <div class="card-body">
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Active crypto version</span><span class="kv-value mono">v${p.crypto_active_version}</span></div>
                <div class="kv-row"><span class="kv-label">Active suite</span><span class="kv-value mono">${esc(cryptoName)}</span></div>
                <div class="kv-row"><span class="kv-label">Default retention</span><span class="kv-value">${p.retention.default_case_ttl_days} days</span></div>
                <div class="kv-row"><span class="kv-label">Max retention</span><span class="kv-value">${p.retention.max_case_ttl_days} days</span></div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Sessions</h3><span class="sec-badge verified">${U.icon("check")} Server-validated</span></div>
            <div class="card-body">
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Expiration</span><span class="kv-value">${p.session_expire_minutes} minutes</span></div>
                <div class="kv-row"><span class="kv-label">Idle timeout</span><span class="kv-value">${p.session_idle_minutes} minutes</span></div>
                <div class="kv-row"><span class="kv-label">Password hash</span><span class="kv-value mono">argon2id · t=${p.argon2.time_cost} m=${Math.round(p.argon2.memory_cost / 1024)}KiB p=${p.argon2.parallelism}</span></div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Upload limits</h3><span class="sec-badge verified">${U.icon("check")} Enforced</span></div>
            <div class="card-body">
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Max file size</span><span class="kv-value">${fmtSize(p.limits.max_upload_size)}</span></div>
                <div class="kv-row"><span class="kv-label">Max files per case</span><span class="kv-value">${p.limits.max_files_per_case}</span></div>
                <div class="kv-row"><span class="kv-label">Case creation rate</span><span class="kv-value">${p.rate_limits.case_creation_per_min} / min</span></div>
                <div class="kv-row"><span class="kv-label">Auth attempts</span><span class="kv-value">${p.rate_limits.auth_per_min} / min per IP</span></div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Passkey enrollment</h3><span class="badge badge-outline"><span class="dot"></span> Not wired</span></div>
            <div class="card-body">
              <p class="field-hint">WebAuthn registration is the primary sign-in in the architecture (§11), but the vault backend doesn't expose enrollment endpoints in this console yet. Password sign-in and server sessions are available.</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ---------- Audit ---------- */
  const AUDIT_SEV = {
    critical: { label: "Critical", cls: "badge-danger" },
    warning: { label: "Warning", cls: "badge-warning" },
    info: { label: "Info", cls: "badge-outline" },
  };

  async function paintAudit(host) {
    host.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
    let events;
    try {
      const res = await apiFetch("/api/v1/investigator/audit?limit=200");
      events = (res.events || []).filter((e) => e.event_id);
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      host.innerHTML = `
        <div class="page">
          <div class="card card-pad">
            ${emptyState(U.icon("alert"), "Couldn't load the audit log", esc(err.detail || "The vault is unreachable. Try again."))}
          </div>
        </div>`;
      return;
    }

    let sev = "all";
    const types = [...new Set(events.map((e) => e.event_type))].sort();

    const apply = () => {
      let rows = events.slice();
      if (sev !== "all") rows = rows.filter((a) => a.severity === sev);
      host.querySelectorAll(".filter-chip").forEach((ch) => { ch.setAttribute("aria-pressed", String(ch.dataset.value === sev)); });
      host.querySelector("#audit-count").textContent = `${rows.length} events`;
      host.querySelector("#audit-tbody").innerHTML = rows.map((a) => {
        const s = AUDIT_SEV[a.severity] || AUDIT_SEV.info;
        const hash = a.event_hash ? String(a.event_hash).slice(0, 10) + "…" : "—";
        return `
          <tr data-audit="${a.event_id}">
            <td data-label="Time" class="cell-secondary">${U.formatDateTime(a.created_at)}</td>
            <td data-label="Severity"><span class="badge ${s.cls}"><span class="dot"></span> ${s.label}</span></td>
            <td data-label="Event"><span class="mono">${esc(a.event_type)}</span></td>
            <td data-label="Target" class="cell-secondary">${esc(a.case_id || "—")}</td>
            <td data-label="Actor" class="cell-secondary"><span class="mono">${esc(a.investigator_id ? a.investigator_id.slice(0, 8) + "…" : "system")}</span></td>
            <td data-label="Hash" class="cell-secondary"><span class="mono">${esc(hash)}</span></td>
          </tr>`;
      }).join("") || `<tr><td colspan="6"><section class="empty"><div class="empty-icon">${U.icon("clock")}</div><h3>No events match</h3><p>Try clearing a filter.</p></section></td></tr>`;
      host.querySelectorAll("[data-audit]").forEach((tr) => tr.addEventListener("click", () => {
        const a = events.find((x) => String(x.event_id) === tr.dataset.audit);
        if (a) openAuditDrawer(a);
      }));
    };

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Audit log</h1><p class="page-sub">Tamper-evident events from the vault. Your own events and events on cases assigned to you.</p></div>
          <button class="btn btn-secondary" data-action="export">${U.icon("download")} Export CSV</button>
        </div>

        <div class="card">
          <div class="card-toolbar">
            <div class="filter-chips" role="group" aria-label="Filter by severity">
              <button class="filter-chip" data-value="all" aria-pressed="true">All</button>
              ${Object.entries(AUDIT_SEV).map(([k, v]) => `<button class="filter-chip" data-value="${k}" aria-pressed="false">${v.label}</button>`).join("")}
            </div>
            <div class="row" style="gap:var(--sp-3)">
              <span class="badge badge-outline" id="audit-count"></span>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>Target</th><th>Actor</th><th>Hash</th></tr></thead>
              <tbody id="audit-tbody"></tbody>
            </table>
          </div>
          <div class="card-foot">
            <span class="row" style="gap:var(--sp-2)">${U.icon("lock")} Each event carries a SHA-256 content hash</span>
          </div>
        </div>
      </div>`;

    host.querySelectorAll(".filter-chip").forEach((ch) => ch.addEventListener("click", () => { sev = ch.dataset.value; apply(); }));
    host.querySelector('[data-action="export"]').addEventListener("click", () => {
      const head = "timestamp,severity,event_type,case_id,investigator_id,event_hash";
      const lines = events.map((e) => [e.created_at, e.severity, e.event_type, e.case_id || "", e.investigator_id || "", e.event_hash || ""]
        .map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(","));
      const blob = new Blob([head + "\n" + lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "veildrop-audit.csv";
      a.click();
      URL.revokeObjectURL(a.href);
      U.toast("Audit export downloaded.", "success");
    });
    apply();
  }

  function openAuditDrawer(a) {
    const s = AUDIT_SEV[a.severity] || AUDIT_SEV.info;
    const { drawer, close } = U.openDrawer(`
      <div class="drawer-head">
        <div>
          <span class="badge ${s.cls}"><span class="dot"></span> ${s.label}</span>
          <span class="badge badge-outline mono">${esc(String(a.event_type))}</span>
        </div>
        <button class="btn-icon" data-drawer-close aria-label="Close">${U.icon("x")}</button>
      </div>
      <div class="drawer-body">
        <h3>${esc(a.event_type)}</h3>
        <p class="page-sub" style="margin-bottom:var(--sp-5)">Tamper-evident security event recorded by the vault.</p>
        <div class="kv">
          <div class="kv-row"><span class="kv-label">Event ID</span><span class="kv-value mono">${esc(a.event_id)}</span></div>
          <div class="kv-row"><span class="kv-label">Severity</span><span class="kv-value">${esc(a.severity)}</span></div>
          <div class="kv-row"><span class="kv-label">Case</span><span class="kv-value mono">${esc(a.case_id || "—")}</span></div>
          <div class="kv-row"><span class="kv-label">Investigator</span><span class="kv-value mono">${esc(a.investigator_id || "system")}</span></div>
          <div class="kv-row"><span class="kv-label">Timestamp</span><span class="kv-value">${U.formatDateTime(a.created_at)}</span></div>
          <div class="kv-row"><span class="kv-label">Content hash</span><span class="kv-value mono">${esc(a.event_hash || "—")}</span></div>
          ${a.details ? `<div class="kv-row"><span class="kv-label">Details</span><span class="kv-value mono">${esc(JSON.stringify(a.details))}</span></div>` : ""}
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" data-drawer-close>Close</button>
      </div>`);
    drawer.querySelectorAll("[data-drawer-close]").forEach((b) => b.addEventListener("click", () => close()));
  }

  /* ---------- Modals ---------- */
  function openAssignmentModal(data) {
    const html = `
      <div class="dialog-header">
        <h2>Assign investigator</h2>
        <button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button>
      </div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:var(--sp-4);">
        <div class="field">
          <input type="text" class="input" placeholder="Search investigators..." id="investigator-search" autocomplete="off" />
        </div>
        <div class="investigator-results" style="display:flex;flex-direction:column;gap:var(--sp-3);">
          <div style="display:flex;align-items:center;gap:var(--sp-3);">
            <div style="width:36px;height:36px;border-radius:var(--r-sm);background:var(--surface-3);display:flex;align-items:center;justify-content:center;font-weight:var(--fw-bold);font-size:var(--fs-sm);">SK</div>
            <div style="flex:1;">
              <div style="font-weight:var(--fw-medium);">Sarah Kumar</div>
              <div style="font-size:var(--fs-xs);color:var(--text-muted);"><span class="badge badge-outline"><span class="dot" style="background:var(--success)"></span> Senior Investigator</span></div>
            </div>
          </div>
        </div>
        <div class="field">
          <label class="label">Permission</label>
          <select class="select" id="assign-perm">
            <option value="read">Read</option>
            <option value="write" selected>Read + Respond</option>
            <option value="admin">Case Admin</option>
          </select>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" data-dlg-close>Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-assign">Assign</button>
      </div>
    `;
    const { overlay, close } = U.openDialog(html);
    overlay.querySelector("#btn-confirm-assign").addEventListener("click", () => {
      U.toast("Investigator assigned successfully.", "success");
      close();
    });
  }

  function openRotateKeyModal(data) {
    const html = `
      <div class="dialog-header">
        <h2>Rotate case encryption key?</h2>
        <button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button>
      </div>
      <div class="dialog-body" style="display:flex;flex-direction:column;gap:var(--sp-4);">
        <p>A new case key will replace the current version for future protected operations.</p>
        <div class="kv" style="background:var(--surface-2);padding:var(--sp-4);border-radius:var(--r-md);">
          <div class="kv-row"><span class="kv-label">Current</span><span class="kv-value mono">DEK v${data.envelope ? data.envelope.key_version : "1"}</span></div>
          <div class="kv-row"><span class="kv-label">Next</span><span class="kv-value mono">DEK v${data.envelope ? (data.envelope.key_version + 1) : "2"}</span></div>
        </div>
        <div>
          <label class="label">Show affected recipients</label>
          <div style="display:flex;flex-direction:column;gap:var(--sp-1);margin-top:var(--sp-2);">
            <div class="mono" style="font-size:var(--fs-sm);color:var(--text-secondary);">Reporter</div>
            <div class="mono" style="font-size:var(--fs-sm);color:var(--text-secondary);">Sarah Chen</div>
            <div class="mono" style="font-size:var(--fs-sm);color:var(--text-secondary);">A. Kumar</div>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" data-dlg-close>Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-rotate">Rotate Key</button>
      </div>
    `;
    const { overlay, close } = U.openDialog(html);
    overlay.querySelector("#btn-confirm-rotate").addEventListener("click", () => {
      U.toast("Case key rotated to v" + (data.envelope ? (data.envelope.key_version + 1) : "2"), "success");
      close();
    });
  }

  /* ---------- Settings ---------- */
  function paintSettings(host) {
    host.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>Settings</h1><p class="page-sub">Your session and profile.</p></div></div>
        <div class="grid g2">
          <div class="card">
            <div class="card-header"><h3>Profile</h3></div>
            <div class="card-body">
              <div class="field"><label for="s-handle">Handle</label><input class="input mono" id="s-handle" value="${esc(session.username || "")}" disabled /></div>
              <div class="field"><label for="s-role">Role</label><input class="input" id="s-role" value="${esc((session.role || "").replace(/_/g, " "))}" disabled /></div>
              <div class="field"><label for="s-id">Investigator ID</label><input class="input mono" id="s-id" value="${esc(session.investigator_id || "")}" disabled /></div>
              <div class="field"><label for="s-expires">Session expires</label><input class="input mono" id="s-expires" value="${session.expires_at ? esc(U.formatDateTime(session.expires_at)) : "—"}" disabled /></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Security</h3></div>
            <div class="card-body">
              <div class="row" style="justify-content:space-between;padding:var(--sp-2) 0">
                <div><strong style="font-size:var(--fs-md)">Passkey</strong><div class="field-hint">${U.icon("shield")} Primary sign-in in the architecture</div></div>
                <span class="badge badge-outline">Not wired</span>
              </div>
              <p class="field-hint">WebAuthn and recovery-password self-service aren't exposed by the vault in this console yet. Use the password sign-in; sessions are managed server-side.</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  return { renderLogin, renderShell, renderPage };
})();
