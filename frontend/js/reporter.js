/* VeilDrop reporter screens — landing, submit wizard, case created, access, case workspace. */
window.VeilReporter = (() => {
  const U = window.VeilUI;

  const wizardState = {
    stage: 1,
    type: "",
    title: "",
    summary: "",
    details: "",
    files: [],
    retention: "org",
    burnOnRead: false,
  };
  let wizardMount = null;

  /* ---------- Live vault API + local reporter state ---------- */
  const API = "";

  function randHex(n) {
    const bytes = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, opts);
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

  function storeReporter(creds) { try { sessionStorage.setItem("veildrop-reporter", JSON.stringify(creds)); } catch (_) {} }
  function loadReporter() { try { return JSON.parse(sessionStorage.getItem("veildrop-reporter") || "null"); } catch (_) { return null; } }
  function storeCaseId(id) { try { sessionStorage.setItem("veildrop-case-id", id); } catch (_) {} }
  function loadCaseId() { try { return sessionStorage.getItem("veildrop-case-id") || window.VeilMock.reporters.CASE_ID; } catch (_) { return window.VeilMock.reporters.CASE_ID; } }

  const C = window.VeilCrypto;

  /* Unwrap the case DEK and decrypt every message we hold the key for.
     Returns { dek, report, ok } — report is the decrypted initial submission. */
  async function decryptCase(caseData, recoverySecret) {
    if (!caseData || !caseData.envelope || !recoverySecret) return { ok: false, report: null, messages: [] };
    let secretBytes;
    try { secretBytes = C.hexToBytes(String(recoverySecret).trim().toLowerCase()); }
    catch (_) { return { ok: false, report: null, messages: [] }; }
    try {
      const kek = await C.deriveKek(secretBytes);
      const dek = await C.unwrapDek(kek, C.hexToBytes(caseData.envelope.wrapped_dek));
      const messages = [];
      let report = null;
      for (const m of (caseData.messages || [])) {
        const parsed = m.aad ? C.parseObjectAad(C.hexToBytes(m.aad)) : null;
        let plaintext = null;
        if (parsed) {
          try {
            const pt = await C.decryptObject(dek, parsed.purpose, parsed.objectId, C.hexToBytes(m.ciphertext), C.hexToBytes(m.nonce), C.hexToBytes(m.tag), parsed.version);
            plaintext = C.toUtf8(pt);
            if (parsed.purpose === "report") {
              try { report = JSON.parse(plaintext); } catch (_) { report = { title: "", summary: plaintext }; }
            }
          } catch (_) { plaintext = null; }
        }
        messages.push({ ...m, _plaintext: plaintext, _parsed: parsed });
      }
      return { ok: true, dek, messages, report };
    } catch (_) {
      return { ok: false, report: null, messages: [] };
    }
  }

  const RECOVERY_WORDS = ["WARROW", "MOLTO", "BRACK", "FIDO", "LOMEN", "DUNE", "KITE", "NOVA", "CALM", "RIFT"];
  function makeRecovery() {
    const pick = () => RECOVERY_WORDS[Math.floor(Math.random() * RECOVERY_WORDS.length)];
    return `${pick()} ${pick()} ${String(Math.floor(Math.random() * 9000) + 1000)} ${pick()} ${pick()} ${pick()}`;
  }

  function retentionLabel(createdAt, expiresAt) {
    const ms = new Date(expiresAt).getTime() - new Date(createdAt).getTime();
    const days = Math.round(ms / 864e5);
    return `${days} day${days === 1 ? "" : "s"} · ${U.formatDate(expiresAt)}`;
  }

  function daysRemaining(expiresAt) {
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 864e5));
  }

  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }

  function statusLabel(s) {
    const map = { open: "Open", under_review: "Under review", waiting: "Awaiting action", closed: "Closed", expired: "Expired" };
    return map[s] || s;
  }
  function statusBadgeClass(s) {
    if (s === "open" || s === "under_review") return "badge-success";
    if (s === "closed" || s === "expired") return "badge-outline";
    return "badge-info";
  }
  function contentTypeLabel(ct) {
    if (!ct) return "File";
    if (ct.includes("pdf")) return "PDF";
    if (ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) return "Spreadsheet";
    if (ct.includes("image")) return "Image";
    if (ct.includes("zip") || ct.includes("archive")) return "Archive";
    if (ct.includes("json") || ct.includes("text")) return "Text";
    return ct.split("/").pop().toUpperCase();
  }

  /* ---------- Submit wizard ---------- */
  function submitShell(mount) {
    wizardMount = mount;
    wizardState.stage = 1;
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
              <a class="btn btn-ghost" href="#/">Cancel</a>
            </nav>
          </div>
        </header>
        <main class="site-main">
          <div class="container narrow">
            <div class="wizard">
              <div class="wizard-header">
                <span class="badge badge-accent"><span class="dot"></span> Confidential report</span>
                <h1>Submit a Confidential Report</h1>
                <p class="wizard-sub">Encrypted on your device before submission. You can leave this page at any time without a trace.</p>
              </div>
              <div class="wizard-steps" role="tablist" aria-label="Report progress">
                <div class="wstep active" data-step="1"><span class="ws-dot">1</span><span>Details</span></div>
                <div class="wstep" data-step="2"><span class="ws-dot">2</span><span>Evidence</span></div>
                <div class="wstep" data-step="3"><span class="ws-dot">3</span><span>Retention</span></div>
                <div class="wstep" data-step="4"><span class="ws-dot">4</span><span>Review</span></div>
                <div class="wstep" data-step="5"><span class="ws-dot">5</span><span>Protect</span></div>
              </div>
              <div id="wizard-body"></div>
            </div>
          </div>
        </main>
      </div>`;
    renderStage(mount);
  }

  function renderStage(mount) {
    const body = mount.querySelector("#wizard-body");
    mount.querySelectorAll(".wstep").forEach((s) => {
      const n = Number(s.dataset.step);
      const done = n < wizardState.stage;
      const active = n === wizardState.stage;
      s.classList.toggle("active", active);
      s.classList.toggle("done", done);
    });
    const stage = wizardState.stage;
    if (stage === 1) stageDetails(body);
    else if (stage === 2) stageEvidence(body);
    else if (stage === 3) stageRetention(body);
    else if (stage === 4) stageReview(body);
    else if (stage === 5) stageProtect(body, mount);
  }

  function stageNav(body, { back = true, nextLabel = "Continue", nextDisabled = false, nextAction, backAction } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "wizard-nav";
    wrap.innerHTML = `
      ${back ? '<button class="btn btn-ghost" data-wz="back">Back</button>' : '<span></span>'}
      <button class="btn btn-primary" data-wz="next" ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>`;
    wrap.querySelector("[data-wz='back']")?.addEventListener("click", () => { wizardState.stage--; renderStage(wizardMount); });
    wrap.querySelector("[data-wz='next']")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      if (nextAction) nextAction();
    });
    body.appendChild(wrap);
  }

  function stageDetails(body) {
    const CATS = [
      { id: "Ethics & conduct", desc: "Harassment, discrimination, conflicts of interest", icon: "users" },
      { id: "Fraud & finance", desc: "Misuse of funds, kickbacks, misstatement", icon: "file" },
      { id: "Security & safety", desc: "Breaches, insider threats, unsafe practices", icon: "shield" },
      { id: "Privacy concern", desc: "Handling of personal or confidential data", icon: "lock" },
      { id: "Organizational misconduct", desc: "Abuse of process or authority", icon: "alert" },
      { id: "Other", desc: "Something else you need to share", icon: "edit" },
    ];
    body.innerHTML = `
      <div class="wizard-body">
        <div class="alert alert-info">
          <span class="icon">${U.icon("lock")}</span>
          <div class="alert-body">
            <span class="alert-title">Protected on this device first</span>
            <span>Nothing you type or attach leaves this browser until you choose to seal and submit.</span>
          </div>
        </div>
        <div class="field">
          <label>What are you reporting?</label>
          <div class="cat-grid" role="radiogroup" aria-label="Report category">
            ${CATS.map((c, i) => `
              <button type="button" class="cat-card ${wizardState.type === c.id ? "selected" : ""}" data-cat="${c.id}" role="radio" aria-checked="${wizardState.type === c.id}">
                <span class="cat-icon">${U.icon(c.icon)}</span>
                <strong>${c.id}</strong>
                <span>${c.desc}</span>
              </button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="f-title">Title <span class="field-hint">— keep it factual</span></label>
          <input class="input" id="f-title" type="text" maxlength="120" value="${U.esc(wizardState.title)}" placeholder="e.g. Undisclosed vendor payments in procurement" autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-summary">Summary <span class="field-hint">— one or two lines for the receiving team</span></label>
          <textarea class="textarea" id="f-summary" rows="3" maxlength="400" placeholder="A short overview for the receiving team.">${U.esc(wizardState.summary)}</textarea>
          <div class="char-count" data-count="f-summary">${wizardState.summary.length}/400</div>
        </div>
        <div class="field">
          <label for="f-details">What happened? <span class="field-hint">— optional, add as much as you're comfortable sharing</span></label>
          <textarea class="textarea" id="f-details" rows="6" placeholder="Who, what, when, where — and anything you think matters. Avoid identifying yourself.">${U.esc(wizardState.details)}</textarea>
          <div class="char-count" data-count="f-details">${wizardState.details.length} characters</div>
        </div>
      </div>`;
    const next = () => {
      wizardState.type = body.querySelector(".cat-card.selected")?.dataset.cat || "";
      wizardState.title = body.querySelector("#f-title").value.trim();
      wizardState.summary = body.querySelector("#f-summary").value.trim();
      wizardState.details = body.querySelector("#f-details").value.trim();
      if (!wizardState.type) {
        U.toast("Choose a category to continue.", "error");
        return;
      }
      if (!wizardState.title) {
        body.querySelector("#f-title").closest(".field").classList.add("invalid");
        body.querySelector("#f-title").focus();
        return;
      }
      wizardState.stage = 2;
      renderStage(wizardMount);
    };
    body.querySelectorAll(".cat-card").forEach((card) => card.addEventListener("click", () => {
      body.querySelectorAll(".cat-card").forEach((c) => { c.classList.remove("selected"); c.setAttribute("aria-checked", "false"); });
      card.classList.add("selected");
      card.setAttribute("aria-checked", "true");
    }));
    body.querySelector("#f-details").addEventListener("input", (e) => {
      body.querySelector('[data-count="f-details"]').textContent = e.target.value.length + " characters";
    });
    body.querySelector("#f-summary").addEventListener("input", (e) => {
      const el = body.querySelector('[data-count="f-summary"]');
      el.textContent = e.target.value.length + "/400";
      el.classList.toggle("near", e.target.value.length > 350);
    });
    stageNav(body, { back: false, nextLabel: "Continue", nextAction: next });
    body.querySelector("#f-title").closest(".field").insertAdjacentHTML("beforeend", '<p class="field-error">Please give the report a short title.</p>');
  }

  function stageEvidence(body) {
    body.innerHTML = `
      <div class="wizard-body">
        <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Add files">
          <span class="dropzone-icon">${U.icon("file")}</span>
          <span class="dropzone-title">Drop files here or click to browse</span>
          <span class="dropzone-hint">PDF, spreadsheets, images, archives. Files are encrypted locally before upload.</span>
        </div>
        <div class="file-list" id="file-list"></div>
        <div class="field">
          <label class="check">
            <input type="checkbox" id="f-ev-confirm" />
            <span class="check-text">I confirm these files don't contain my personal identity details<span class="hint">Stripping metadata (author, GPS, device) is recommended before upload.</span></span>
          </label>
        </div>
      </div>`;
    const listEl = body.querySelector("#file-list");
    const confirmEl = body.querySelector("#f-ev-confirm");

    const paint = () => {
      listEl.innerHTML = wizardState.files.map((f, i) => `
        <div class="file-row">
          <span class="file-icon">${U.icon("file")}</span>
          <div class="file-meta">
            <div class="file-name">${f.name}</div>
            <div class="file-info"><span>${fmtSize(f.raw ? f.raw.size : 0)}</span>·<span>Encrypted locally</span>·<span>sha256:${f.fp}</span></div>
          </div>
          <button class="btn-icon sm" data-remove="${i}" aria-label="Remove ${f.name}">${U.icon("trash")}</button>
        </div>`).join("");
      listEl.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        wizardState.files.splice(Number(b.dataset.remove), 1);
        paint();
      }));
    };
    paint();

    const dz = body.querySelector("#dropzone");
    const addFiles = (files) => {
      [...files].forEach((f) => {
        const fp = Math.random().toString(16).slice(2, 6);
        wizardState.files.push({ name: f.name, raw: f, fp });
      });
      paint();
    };
    dz.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.addEventListener("change", () => addFiles(input.files));
      input.click();
    });
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dz.click(); } });
    ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer) addFiles(e.dataTransfer.files); });

    stageNav(body, { back: true, nextLabel: "Continue", nextAction: () => {
      if (!confirmEl.checked) {
        confirmEl.closest(".field").classList.add("invalid");
        confirmEl.focus();
        return;
      }
      wizardState.stage = 3;
      renderStage(wizardMount);
    }});
  }

  function stageRetention(body) {
    const OPTIONS = [
      { v: "24h", title: "24 hours", desc: "Quick triage only.", note: "Recommended for sensitive, time-critical material." },
      { v: "7d", title: "7 days", desc: "Short investigations." },
      { v: "30d", title: "30 days", desc: "Typical investigations." },
      { v: "org", title: "Organization policy", desc: "90 days, standard default." },
    ];
    body.innerHTML = `
      <div class="wizard-body">
        <p class="wizard-sub">Choose how long your report and evidence remain available. You can still extend retention later using your credentials.</p>
        <div class="retention-options" role="radiogroup" aria-label="Retention policy">
          ${OPTIONS.map((o) => `
            <label class="retention-card ${wizardState.retention === o.v ? "selected" : ""}" data-ret="${o.v}">
              <input type="radio" name="retention" value="${o.v}" ${wizardState.retention === o.v ? "checked" : ""} />
              <strong>${o.title}</strong>
              <span>${o.desc}</span>
              ${wizardState.retention === o.v ? '<span class="badge badge-accent" style="margin-top:var(--sp-1)">Selected</span>' : ""}
            </label>`).join("")}
        </div>
        <div class="field">
          <label class="check">
            <input type="checkbox" id="f-burn" ${wizardState.burnOnRead ? "checked" : ""} />
            <span class="check-text">Mark my first message as burn-on-read<span class="hint">It becomes unreadable after the receiving team opens it once.</span></span>
          </label>
        </div>
      </div>`;
    body.querySelectorAll(".retention-card").forEach((card) => {
      card.addEventListener("click", () => {
        body.querySelectorAll(".retention-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        card.querySelector("input").checked = true;
      });
    });
    stageNav(body, { back: true, nextLabel: "Continue", nextAction: () => {
      wizardState.retention = body.querySelector('input[name="retention"]:checked').value;
      wizardState.burnOnRead = body.querySelector("#f-burn").checked;
      wizardState.stage = 4;
      renderStage(wizardMount);
    }});
  }

  function retentionTitle(v) {
    const map = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", org: "Organization policy (90 days)" };
    return map[v] || v;
  }
  function retentionDays(v) {
    const map = { "24h": 1, "7d": 7, "30d": 30, org: 90 };
    return map[v] || 90;
  }

  function stageReview(body) {
    const fileList = wizardState.files.length
      ? wizardState.files.map((f) => f.name).join(", ")
      : "No files attached";
    const goTo = (n) => () => { wizardState.stage = n; renderStage(wizardMount); };
    body.innerHTML = `
      <div class="wizard-body">
        <div class="review-grid">
          <div class="card">
            <div class="card-header"><h3>Report details</h3><button class="btn btn-ghost btn-sm" data-edit="1">${U.icon("edit")} Edit</button></div>
            <div class="card-body review-details">
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Category</span><span class="kv-value">${U.esc(wizardState.type)}</span></div>
                <div class="kv-row"><span class="kv-label">Title</span><span class="kv-value">${U.esc(wizardState.title)}</span></div>
                <div class="kv-row"><span class="kv-label">Summary</span><span class="kv-value">${U.esc(wizardState.summary || "—")}</span></div>
              </div>
              ${wizardState.details ? `<p>${U.esc(wizardState.details)}</p>` : ""}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Evidence &amp; handling</h3><button class="btn btn-ghost btn-sm" data-edit="2">${U.icon("edit")} Edit</button></div>
            <div class="card-body review-details">
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Files</span><span class="kv-value">${fileList}</span></div>
                <div class="kv-row"><span class="kv-label">Retention</span><span class="kv-value">${retentionTitle(wizardState.retention)}</span></div>
                <div class="kv-row"><span class="kv-label">First message</span><span class="kv-value">${wizardState.burnOnRead ? "Burn-on-read" : "Standard"}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="alert alert-info">
          <span class="icon">${U.icon("lock")}</span>
          <div class="alert-body">
            <span class="alert-title">Ready to seal</span>
            <span>Submitting will encrypt your report and evidence in this browser before anything is sent. You'll receive a case ID and a recovery secret to return.</span>
          </div>
        </div>
      </div>`;
    body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", goTo(Number(b.dataset.edit))));
    stageNav(body, { back: true, nextLabel: "Encrypt & submit", nextAction: () => {
      wizardState.stage = 5;
      renderStage(wizardMount);
    }});
  }

  function stageProtect(body, mount) {
    body.innerHTML = `
      <div class="wizard-body protect">
        <div class="progress-list" role="status" aria-label="Securing your report">
          <div class="progress-item active" data-p="1"><span class="progress-marker">1</span><span><span class="progress-label">Preparing report</span><div class="progress-sub">Collecting your details</div></span></div>
          <div class="progress-item" data-p="2"><span class="progress-marker">2</span><span><span class="progress-label">Protecting content</span><div class="progress-sub">Encrypting on this device</div></span></div>
          <div class="progress-item" data-p="3"><span class="progress-marker">3</span><span><span class="progress-label">Uploading sealed data</span><div class="progress-sub">Ciphertext only</div></span></div>
          <div class="progress-item" data-p="4"><span class="progress-marker">4</span><span><span class="progress-label">Creating your case</span><div class="progress-sub">Signing receipt</div></span></div>
        </div>
      </div>`;

    const ttl = retentionDays(wizardState.retention);
    const reportObjectId = "msg-" + C.uuid();
    const reportPlain = JSON.stringify({
      category: wizardState.type,
      title: wizardState.title,
      summary: wizardState.summary || "",
      details: wizardState.details || "",
    });

    const sealAndSubmit = (async () => {
      try {
        const dek = C.randomBytes(32);
        const recoverySecret = C.randomBytes(32);
        const kek = await C.deriveKek(recoverySecret);
        const wrappedDek = await C.wrapDek(kek, dek);
        const rep = await C.encryptObject(dek, "report", reportObjectId, C.toBytes(reportPlain));

        const fd = new FormData();
        fd.append("ciphertext", C.bytesToHex(rep.ciphertext));
        fd.append("nonce", C.bytesToHex(rep.nonce));
        fd.append("tag", C.bytesToHex(rep.tag));
        fd.append("aad", C.bytesToHex(C.objectAad("report", reportObjectId)));
        fd.append("wrapped_dek", C.bytesToHex(wrappedDek));
        fd.append("envelope_algorithm", "hpke-dhkem-x25519-hkdf-sha256-aes256gcm");
        fd.append("crypto_version", "1");
        fd.append("ttl_days", String(ttl));
        fd.append("burn_after_read", wizardState.burnOnRead ? "true" : "false");
        if (wizardState.type) fd.append("category", wizardState.type);

        const res = await apiFetch("/api/v1/reporter/cases", { method: "POST", body: fd });

        for (const f of wizardState.files) {
          if (!f.raw) continue;
          const objectId = "file-" + C.uuid();
          const bytes = new Uint8Array(await f.raw.arrayBuffer());
          const blob = await C.encryptFile(dek, objectId, bytes);
          const efd = new FormData();
          efd.append("encrypted_data", C.bytesToHex(blob));
          efd.append("crypto_metadata", JSON.stringify({
            algorithm: "AES-256-GCM",
            version: 1,
            file_id: objectId,
            original_size: bytes.length,
          }));
          efd.append("original_size", String(bytes.length));
          efd.append("content_type", f.raw.type || "application/octet-stream");
          await apiFetch(`/api/v1/reporter/cases/${encodeURIComponent(res.case_id)}/evidence`, { method: "POST", body: efd });
        }

        return { ok: true, case_id: res.case_id, created_at: res.created_at, expires_at: res.expires_at, recovery: C.bytesToHex(recoverySecret) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();

    const finish = async () => {
      const res = await Promise.race([
        sealAndSubmit,
        new Promise((r) => setTimeout(() => r({ ok: false, timeout: true }), 2500)),
      ]);
      const outcome = res && res.ok
        ? { case_id: res.case_id, created_at: res.created_at, expires_at: res.expires_at, recovery: res.recovery, demo: false }
        : { case_id: window.VeilMock.reporters.CASE_ID, created_at: new Date().toISOString(), expires_at: null, demo: true };

      const recovery = outcome.demo ? makeRecovery() : outcome.recovery;
      const burnToken = "burn-" + randHex(4).toUpperCase();

      if (outcome.demo) {
        storeReporter({ case_id: outcome.case_id, recovery, burnToken, title: wizardState.title, summary: wizardState.summary, details: wizardState.details });
        storeCaseId(outcome.case_id);
        renderCaseCreated(mount, outcome, { recovery, burnToken });
        return;
      }

      storeReporter({ case_id: outcome.case_id, recovery, burnToken, title: wizardState.title, summary: wizardState.summary, details: wizardState.details });
      storeCaseId(outcome.case_id);
      renderCaseCreated(mount, outcome, { recovery, burnToken });
    };

    let i = 1;
    const tick = () => {
      i++;
      body.querySelector(`[data-p="${i}"]`)?.classList.remove("active");
      body.querySelector(`[data-p="${i}"]`)?.classList.add("done");
      if (i < 4) {
        body.querySelector(`[data-p="${i + 1}"]`)?.classList.add("active");
        setTimeout(tick, 900);
      } else {
        setTimeout(finish, 500);
      }
    };
    setTimeout(tick, 900);
  }

  /* ---------- Case created ---------- */
  function renderCaseCreated(mount, outcome, creds) {
    outcome = outcome || { case_id: window.VeilMock.reporters.CASE_ID, demo: true };
    creds = creds || { recovery: window.VeilMock.reporters.recovery, burnToken: window.VeilMock.reporters.burnToken };
    const OBSCURED = "•••• •••• •••• •••• •••• ••••";
    let revealed = false;
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
            ${outcome.demo ? `
              <div class="alert alert-warning" style="margin-top:var(--sp-6)">
                <span class="icon">${U.icon("alert")}</span>
                <div class="alert-body">
                  <span class="alert-title">Vault unavailable — demo case</span>
                  <span>Couldn't reach the live vault, so this is a preview case ID. Start the backend and resubmit for a live sealed case.</span>
                </div>
              </div>` : ""}
            <div class="success-head">
              <span class="success-icon">${U.icon("shield")}</span>
              <h1>Your report is sealed.</h1>
              <p>${outcome.demo ? "This is a demo preview." : "Sealed on the vault. Your receipt was signed."} Nothing is stored in your browser, so the only way back is with your credentials. Write them down now.</p>
            </div>

            <div class="credential-card">
              <div class="credential-head">
                <span class="badge badge-warning"><span class="dot"></span> Shown once · Save now</span>
                <button class="btn btn-secondary btn-sm" id="save-creds">${U.icon("download")} Save a local copy</button>
              </div>
              <div class="credential-row">
                <div>
                  <div class="credential-label">Case ID</div>
                  <div class="credential-value">${outcome.case_id}</div>
                </div>
                <button class="btn-icon" data-copy="${outcome.case_id}" aria-label="Copy case ID">${U.icon("copy")}</button>
              </div>
              <div class="credential-row">
                <div>
                  <div class="credential-label">Recovery secret</div>
                  <div class="secret-value ${revealed ? "revealed" : ""}" id="recovery-value">${revealed ? U.esc(creds.recovery) : OBSCURED}</div>
                </div>
                <div class="secret-actions">
                  <button class="btn-icon" id="reveal-recovery" aria-label="${revealed ? "Hide recovery secret" : "Reveal recovery secret"}">${U.icon(revealed ? "eyeOff" : "eye")}</button>
                  <button class="btn-icon" data-copy="${U.esc(creds.recovery)}" aria-label="Copy recovery secret">${U.icon("copy")}</button>
                </div>
              </div>
              <p class="credential-warn">If you lose this secret, the case is permanently unreachable — we can't recover it for you, by design.</p>
            </div>

            <div class="rec-card">
              <div class="rec-actions">
                <button class="btn btn-secondary" id="print-creds">${U.icon("print")} Print</button>
                <button class="btn btn-ghost" id="dl-creds">${U.icon("download")} Download as text file</button>
              </div>
              <div style="padding:var(--sp-5) var(--sp-6)">
                <label class="check">
                  <input type="checkbox" id="creds-confirm" />
                  <span class="check-text">I have securely saved my case ID and recovery secret<span class="hint">You'll need both to return to this case.</span></span>
                </label>
              </div>
            </div>

            <div class="success-actions">
              <a class="btn btn-primary btn-lg" id="continue-case" href="#/case" aria-disabled="true" style="pointer-events:none;opacity:.45">Continue to my case</a>
            </div>
            <div class="alert alert-info" style="margin-top:var(--sp-4)">
              <span class="icon">${U.icon("shield")}</span>
              <div class="alert-body">
                <span class="alert-title">Need to verify your receipt?</span>
                <span>You can verify the signed receipt and envelope fingerprint from your case workspace.</span>
              </div>
            </div>
          </div>
        </main>
      </div>`;
    U.copyAttr(mount);
    const credsText = `VeilDrop — report credentials\n\nCase ID: ${outcome.case_id}\nRecovery secret: ${creds.recovery}\nBurn token: ${creds.burnToken}\n\nStore this somewhere safe. It is the only way to return to your report.`;
    const dl = () => {
      const blob = new Blob([credsText], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "veildrop-credentials.txt";
      a.click();
      U.toast("Credentials downloaded.", "success");
    };
    const revealBtn = mount.querySelector("#reveal-recovery");
    revealBtn.addEventListener("click", () => {
      revealed = !revealed;
      mount.querySelector("#recovery-value").textContent = revealed ? creds.recovery : OBSCURED;
      mount.querySelector("#recovery-value").classList.toggle("revealed", revealed);
      revealBtn.setAttribute("aria-label", revealed ? "Hide recovery secret" : "Reveal recovery secret");
      revealBtn.innerHTML = U.icon(revealed ? "eyeOff" : "eye");
      if (revealed) U.toast("Make sure no one is watching your screen.", "warning");
    });
    mount.querySelector("#save-creds").addEventListener("click", dl);
    mount.querySelector("#dl-creds").addEventListener("click", dl);
    mount.querySelector("#print-creds").addEventListener("click", () => window.print());
    const confirmEl = mount.querySelector("#creds-confirm");
    const continueEl = mount.querySelector("#continue-case");
    const setReady = (ready) => {
      continueEl.style.pointerEvents = ready ? "" : "none";
      continueEl.style.opacity = ready ? "" : ".45";
      continueEl.setAttribute("aria-disabled", String(!ready));
    };
    confirmEl.addEventListener("change", () => setReady(confirmEl.checked));
    continueEl.addEventListener("click", (e) => {
      if (!confirmEl.checked) { e.preventDefault(); U.toast("Confirm you've saved your credentials first.", "warning"); }
    });
  }

  /* ---------- Access case ---------- */
  function renderAccess(mount, params) {
    const prefillId = (params && params.id) || "";
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
              <span class="login-icon">${U.icon("key")}</span>
              <h1>Access your case</h1>
              <p class="auth-sub">Enter the credentials from your sealed receipt. They decrypt the case on your device.</p>
              <form id="access-form" novalidate>
                <div class="field">
                  <label for="a-caseid">Case ID</label>
                  <input class="input mono" id="a-caseid" type="text" value="${prefillId}" placeholder="VEIL-XXXXXXXXXXXX" autocomplete="off" spellcheck="false" />
                </div>
                <div class="field">
                  <label for="a-secret">Recovery secret</label>
                  <div class="secret-input">
                    <input class="input mono" id="a-secret" type="password" placeholder="Your recovery secret (64 hex chars)" autocomplete="off" spellcheck="false" />
                    <button class="btn-icon" type="button" data-secret-toggle="a-secret" aria-label="Show recovery secret">${U.icon("eye")}</button>
                  </div>
                </div>
                <button class="btn btn-primary btn-block" type="submit">Unlock my case</button>
              </form>
              <div class="divider"></div>
              <div class="stack-xs">
                <a class="btn btn-ghost btn-block" href="#/submit">${U.icon("plus")} Submit a new report</a>
                <p class="field-hint" style="text-align:center">Demo preview credentials: case ID <span class="mono">${window.VeilMock.reporters.CASE_ID}</span> · secret <span class="mono">${window.VeilMock.reporters.recovery}</span></p>
              </div>
            </div>
            <div class="alert alert-info" style="margin-top:var(--sp-4)">
              <span class="icon">${U.icon("shield")}</span>
              <div class="alert-body">
                <span class="alert-title">Lost your recovery information?</span>
                <span>By design, VeilDrop cannot restore it for you. If you still have the case ID, the receiving team can extend retention or help you share additional context.</span>
              </div>
            </div>
          </div>
        </main>
      </div>`;
    U.secretToggles(mount);
    const form = mount.querySelector("#access-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = form.querySelector("#a-caseid").value.trim().toUpperCase();
      const secret = form.querySelector("#a-secret").value.trim();
      let ok = true;
      form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
      if (!id) { form.querySelector("#a-caseid").closest(".field").classList.add("invalid"); ok = false; }
      if (!secret) { form.querySelector("#a-secret").closest(".field").classList.add("invalid"); ok = false; }
      if (!ok) return;
      const btn = form.querySelector('button[type="submit"]');
      U.setLoading(btn, true);
      btn.textContent = "Unlocking…";

      const fail = (msg) => {
        U.setLoading(btn, false);
        btn.textContent = "Unlock my case";
        form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
        form.querySelector("#a-caseid").closest(".field").classList.add("invalid");
        form.querySelector("#a-secret").closest(".field").classList.add("invalid");
        U.toast(msg, "error");
      };

      const unlockLive = async () => {
        try {
          const data = await apiFetch("/api/v1/reporter/cases/" + encodeURIComponent(id));
          if (!data.envelope || !data.envelope.wrapped_dek) {
            return { ok: false, reason: "no-envelope" };
          }
          const dek = await decryptCase(data, secret);
          if (!dek.ok || !dek.dek) {
            return { ok: false, reason: "wrong-secret" };
          }
          storeCaseId(id);
          storeReporter({ case_id: id, recovery: secret, burnToken: "", title: "", summary: "", details: "" });
          window.location.hash = "#/case";
          return { ok: true };
        } catch (e) {
          if (e.status === 410) return { ok: false, reason: "expired" };
          if (e.status === 404) return { ok: false, reason: "not-found" };
          return { ok: false, reason: "unreachable" };
        }
      };

      setTimeout(async () => {
        const reporter = loadReporter();
        const demo = window.VeilMock.reporters;
        const matchesStored = reporter && id === reporter.case_id && secret === reporter.recovery;
        const matchesDemo = id === demo.CASE_ID && secret.toUpperCase() === demo.recovery;
        if (matchesStored || matchesDemo) {
          storeCaseId(id);
          window.location.hash = "#/case";
        } else {
          const result = await unlockLive();
          if (!result.ok) {
            if (result.reason === "expired") fail("This case has expired.");
            else if (result.reason === "wrong-secret") fail("That recovery secret doesn't unlock this case.");
            else if (result.reason === "no-envelope") fail("This case has no reporter envelope.");
            else if (result.reason === "not-found") fail("No case matches that ID on the vault.");
            else if (result.reason === "unreachable") fail("The vault is unreachable. Try again, or use stored credentials.");
            else fail("We couldn't unlock that case.");
          }
        }
      }, 1400);
    });
  }

  /* ---------- Reporter case workspace (live vault data) ---------- */
  function renderReporterCase(mount, params) {
    const reporter = loadReporter();
    const caseId = loadCaseId();
    const tabs = ["Conversation", "Evidence", "Timeline", "Details"];

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
              <a class="btn btn-ghost" href="#/access">Switch case</a>
            </nav>
          </div>
        </header>
        <main class="site-main">
          <div class="container">
            <div class="case-head">
              <div>
                <div class="case-meta">
                  <span class="badge badge-outline mono" id="case-id">${caseId}</span>
                  <span class="badge badge-success" id="case-status"><span class="dot"></span> Loading</span>
                </div>
                <h1 id="case-title">Loading case…</h1>
                <p class="case-sub" id="case-sub"></p>
              </div>
              <div class="case-head-right">
                <div class="kv">
                  <div class="kv-row"><span class="kv-label">Case created</span><span class="kv-value" id="case-created">—</span></div>
                  <div class="kv-row"><span class="kv-label">Retention</span><span class="kv-value" id="case-retention">—</span></div>
                  <div class="kv-row"><span class="kv-label">Your role</span><span class="kv-value" id="case-role">Reporter</span></div>
                </div>
                <a class="btn btn-secondary" href="#/access">Leave case securely</a>
              </div>
            </div>

            <div id="case-demo-banner"></div>

            <div class="tabs" role="tablist" aria-label="Case sections">
              ${tabs.map((t, i) => `<button class="tab" role="tab" aria-selected="${i === 0}" aria-controls="case-tab" tabindex="${i === 0 ? 0 : -1}" data-tab="${i}">${t}</button>`).join("")}
            </div>
            <div class="tab-panel" id="case-tab" role="tabpanel" aria-labelledby="tab-0"></div>
          </div>
        </main>
      </div>`;

    const panel = mount.querySelector("#case-tab");
    let data = null;
    let usingMock = false;

    const paintHead = () => {
      const d = data;
      mount.querySelector("#case-id").textContent = d.case_id;
      const status = mount.querySelector("#case-status");
      status.className = "badge " + statusBadgeClass(d.status);
      status.innerHTML = `<span class="dot"></span> ${statusLabel(d.status)}`;
      mount.querySelector("#case-title").textContent = (data._report && data._report.title)
        ? data._report.title
        : (reporter && reporter.title) ? reporter.title : "Confidential report";
      mount.querySelector("#case-sub").textContent = (data._report && data._report.summary)
        ? data._report.summary
        : (reporter && reporter.summary)
          ? reporter.summary
          : "Report contents are sealed under your case envelope. The vault stores only ciphertext — details you wrote exist solely in this browser session.";
      mount.querySelector("#case-created").textContent = U.formatDate(d.created_at);
      mount.querySelector("#case-retention").textContent = d.expires_at ? retentionLabel(d.created_at, d.expires_at) : "—";
      const banner = mount.querySelector("#case-demo-banner");
      if (usingMock) {
        banner.innerHTML = `
          <div class="alert alert-warning">
            <span class="icon">${U.icon("alert")}</span>
            <div class="alert-body">
              <span class="alert-title">Live vault unreachable — demo preview</span>
              <span>The vault at ${API} didn't respond. Showing sample data. Start the backend and reload for live values.</span>
            </div>
          </div>`;
      } else if (!d.envelope) {
        banner.innerHTML = `
          <div class="alert alert-info">
            <span class="icon">${U.icon("lock")}</span>
            <div class="alert-body">
              <span class="alert-title">Sealed case · live vault</span>
              <span>This case is stored as ciphertext. Message contents are only readable with your recovery secret on your device.</span>
            </div>
          </div>`;
      }
    };

    const paintTab = (idx) => {
      if (idx === 0) paintConversation(panel, data, caseId);
      else if (idx === 1) paintEvidence(panel, data, caseId);
      else if (idx === 2) paintTimeline(panel, data);
      else paintReporterDetails(panel, data);
    };

    const load = async () => {
      panel.innerHTML = `<div class="card card-pad">${U.skeleton(5)}</div>`;
      try {
        data = await apiFetch("/api/v1/reporter/cases/" + encodeURIComponent(caseId));
        usingMock = false;
      } catch (e) {
        if (e.status === 404 || e.status === 410) {
          panel.innerHTML = `
            <section class="empty" role="alert">
              <div class="empty-icon">${U.icon("alert")}</div>
              <h3>${e.status === 410 ? "This case has expired" : "Case not found"}</h3>
              <p>${e.status === 410 ? "Retention has ended and the case was purged from the vault." : "No case matches that ID on the vault."}</p>
              <a class="btn btn-primary" href="#/access">Try another case</a>
            </section>`;
          return;
        }
        usingMock = true;
        data = mockCasePayload(caseId);
      }
      if (!mount.isConnected || !mount.querySelector("#case-id")) return;
      const secret = (reporter && reporter.recovery) || "";
      const dec = await decryptCase(data, secret);
      data._dek = dec.ok ? dec.dek : null;
      data._decrypted = dec.ok;
      data._report = dec.report;
      if (dec.ok) data.messages = dec.messages;
      paintHead();
      paintTab(0);
    };

    const selectTab = (tab, focus = false) => {
      if (!data) return;
      const idx = Number(tab.dataset.tab);
      mount.querySelectorAll(".tab").forEach((x, i) => {
        x.setAttribute("aria-selected", String(i === idx));
        x.setAttribute("tabindex", i === idx ? "0" : "-1");
      });
      tab.setAttribute("id", "tab-" + idx);
      paintTab(idx);
      if (focus) tab.focus();
    };

    mount.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => selectTab(tab)));
    mount.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("keydown", (e) => {
      const tabs = [...mount.querySelectorAll(".tab")];
      const idx = tabs.indexOf(tab);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); selectTab(tabs[(idx + 1) % tabs.length], true); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); selectTab(tabs[(idx - 1 + tabs.length) % tabs.length], true); }
    }));
    mount.querySelector(".tab")?.setAttribute("id", "tab-0");

    load();
  }

  function mockCasePayload(caseId) {
    const M = window.VeilMock;
    const c = M.caseDetails;
    return {
      case_id: caseId,
      status: "open",
      crypto_version: 1,
      reporter_meta: null,
      created_at: c.createdAt,
      expires_at: c.retention.expiresAt,
      envelope: {
        algorithm: "hpke-dhkem-x25519-aes256gcm",
        key_version: 1,
        wrapped_dek: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      },
      messages: M.thread.filter((m) => m.kind !== "internal").map((m) => ({
        message_id: m.id,
        sender_type: m.from,
        ciphertext: randHex(48),
        nonce: randHex(12),
        tag: randHex(16),
        aad: "",
        crypto_version: 1,
        burn_after_read: !!m.burn,
        consumed_at: m.burn && m.consumed ? m.at : null,
        created_at: m.at,
      })),
      evidence: M.evidence.map((e) => ({
        evidence_id: e.id,
        object_key: randHex(28) + ".enc",
        crypto_metadata: { alg: "AES-256-GCM", version: 1, chunk_size: 1048576 },
        original_size: 4096,
        encrypted_size: 4128,
        content_type: e.type === "PDF" ? "application/pdf" : "application/octet-stream",
        created_at: e.uploadedAt,
      })),
      receipt: null,
    };
  }

  const DEMO_PLAINTEXTS = (() => {
    const map = {};
    (window.VeilMock.thread || []).forEach((m) => { if (m.text) map[m.id] = m.text; });
    return map;
  })();

  function sealedBadge(m) {
    if (!m.burn_after_read) return "";
    if (m.consumed_at) return `<span class="badge badge-danger"><span class="dot"></span> Consumed</span>`;
    return `<span class="badge badge-warning"><span class="dot"></span> Burn-on-read</span>`;
  }

  function sealedMsgCard(m) {
    if (m._plaintext && !(m.burn_after_read && m.sender_type === "investigator" && !m.consumed_at)) {
      return `
        <div class="msg ${m.sender_type === "investigator" ? "investigator" : "reporter"}">
          <div class="msg-meta">
            <span class="msg-name">${m.sender_type === "investigator" ? "Investigator" : "You (reporter)"}</span>
            <span>·</span>
            <span>${U.timeAgo(m.created_at)}</span>
            ${m.burn_after_read ? '<span class="badge badge-danger"><span class="dot"></span> Burn-on-read</span>' : ""}
          </div>
          <div class="msg-bubble">${U.esc(m._plaintext)}</div>
          <div class="file-info" style="margin-top:var(--sp-1);align-self:flex-end"><span class="mono">decrypted locally · AES-256-GCM v1</span></div>
        </div>`;
    }
    if (m.burn_after_read && m.sender_type === "investigator" && !m.consumed_at) {
      return `
        <div class="burn-card sealed-card" data-burn="${m.message_id}" style="border-color:var(--warning)">
          <span class="file-icon" style="color:var(--warning)">${U.icon("flame")}</span>
          <div style="flex:1;min-width:0">
            <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">
              <strong style="color:var(--warning)">Burn-on-read message</strong>
            </div>
            <div class="file-info" style="margin-top:var(--sp-1)">${U.timeAgo(m.created_at)} · Sealed under your case envelope</div>
            <div class="file-info">A one-time message is waiting. It becomes unreadable after you open it once.</div>
          </div>
          <button class="btn btn-danger" data-reveal="${m.message_id}">Reveal message</button>
        </div>`;
    }
    if (m.burn_after_read && m.consumed_at) {
      return `
        <div class="sealed-card" style="opacity:.65">
          <span class="file-icon">${U.icon("flame")}</span>
          <div style="flex:1;min-width:0">
            <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">
              <strong>Investigator</strong>
              <span class="badge badge-danger"><span class="dot"></span> Consumed</span>
            </div>
            <div class="file-info" style="margin-top:var(--sp-1)">${U.timeAgo(m.created_at)}</div>
            <div class="file-info">This one-time message was opened and is no longer readable.</div>
          </div>
        </div>`;
    }
    return `
      <div class="sealed-card">
        <span class="file-icon">${U.icon("lock")}</span>
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">
            <strong>${m.sender_type === "investigator" ? "Investigator" : "You (reporter)"}</strong>
            <span class="badge badge-outline">v${m.crypto_version}</span>
            ${sealedBadge(m)}
          </div>
          <div class="file-info" style="margin-top:var(--sp-1)">${U.timeAgo(m.created_at)}</div>
          <div class="file-info mono">${m.sender_type === "investigator" ? "Investigator" : "Reporter"} ciphertext · ${m.ciphertext.length / 2} bytes</div>
        </div>
      </div>`;
  }

  function paintConversation(panel, data, caseId) {
    const msgs = data.messages || [];
    panel.innerHTML = `
      <div class="conversation-layout">
        <div class="alert alert-info">
          <span class="icon">${U.icon("lock")}</span>
          <div class="alert-body">
            <span class="alert-title">End-to-end encrypted conversation</span>
            <span>The vault stores only ciphertext. ${msgs.length ? "Messages below show their sealed state on the server." : "Send a message below — it will be sealed before it reaches the vault."}</span>
          </div>
        </div>
        <div class="thread" id="sealed-thread">
          ${msgs.map(sealedMsgCard).join("")}
          ${msgs.length ? "" : `
            <section class="empty">
              <div class="empty-icon">${U.icon("file")}</div>
              <h3>No messages yet</h3>
              <p>Your report is the first message. Send a note below when you're ready.</p>
            </section>`}
        </div>
        <div class="composer">
          <textarea id="composer-input" placeholder="Write a message… (sealed on your device before sending)" aria-label="New message"></textarea>
          <div class="composer-toolbar">
            <div class="composer-note">
              ${U.icon("lock")} <span>Sealed locally · Burn-on-read available</span>
            </div>
            <div style="display:flex;gap:var(--sp-2)">
              <button class="btn btn-secondary" id="composer-burn" title="Send as burn-on-read">${U.icon("flame")} Burn</button>
              <button class="btn btn-primary" id="composer-send">Send</button>
            </div>
          </div>
        </div>
      </div>`;

    panel.querySelectorAll("[data-reveal]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.dataset.reveal;
      const msg = msgs.find((m) => m.message_id === id);
      if (!msg) return;
      const doReveal = async () => {
        const plaintext = msg._plaintext || DEMO_PLAINTEXTS[id] || "(preview — plaintext unavailable)";
        msg.consumed_at = new Date().toISOString();
        if (data._dek) {
          try {
            await apiFetch(`/api/v1/reporter/cases/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(id)}/consume`, { method: "POST" });
          } catch (_) { /* best-effort; sealed locally regardless */ }
        }
        const card = btn.closest("[data-burn]");
        card.outerHTML = `
          <div class="msg investigator">
            <div class="msg-meta"><span class="msg-name">Investigator</span><span>·</span><span>just now</span><span class="badge badge-danger"><span class="dot"></span> Consumed</span></div>
            <div class="msg-bubble">${U.esc(plaintext)}</div>
            <div class="file-info" style="margin-top:var(--sp-1);align-self:flex-end"><span class="mono">burn-on-read · revealed once</span></div>
          </div>`;
        U.toast("Message revealed. It is now unreadable to everyone.", "warning");
      };
      doReveal();
    }));

    const send = (burn) => {
      const text = panel.querySelector("#composer-input").value.trim();
      if (!text) { U.toast("Write a message first.", "error"); return; }
      const proceed = () => finishSend(burn);
      if (burn) {
        const { overlay, close } = U.openDialog(`
          <div class="dialog-header"><h2>Send burn-on-read?</h2><button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button></div>
          <div class="dialog-body">
            <p>This message becomes unreadable immediately after the receiving team opens it once. It cannot be retrieved afterwards.</p>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" data-dlg-close>Cancel</button>
            <button class="btn btn-danger" data-confirm-burn>${U.icon("flame")} Confirm burn-on-read</button>
          </div>`);
        overlay.querySelector("[data-confirm-burn]").addEventListener("click", () => { close(); proceed(); });
        overlay.querySelectorAll("[data-dlg-close]").forEach((b) => b.addEventListener("click", () => close()));
      } else {
        proceed();
      }
    };

    const finishSend = async (burn) => {
      const text = panel.querySelector("#composer-input").value.trim();
      const sendBtn = panel.querySelector("#composer-send");
      U.setLoading(sendBtn, true);
      try {
        let ciphertext, nonce, tag, aad;
        if (data._dek) {
          const objectId = "msg-" + C.uuid();
          const enc = await C.encryptObject(data._dek, "message", objectId, C.toBytes(text));
          ciphertext = C.bytesToHex(enc.ciphertext);
          nonce = C.bytesToHex(enc.nonce);
          tag = C.bytesToHex(enc.tag);
          aad = C.bytesToHex(C.objectAad("message", objectId));
        } else {
          ciphertext = randHex(64);
          nonce = randHex(12);
          tag = randHex(16);
          aad = "";
        }
        const fd = new FormData();
        fd.append("ciphertext", ciphertext);
        fd.append("nonce", nonce);
        fd.append("tag", tag);
        fd.append("aad", aad);
        fd.append("crypto_version", "1");
        fd.append("burn_after_read", burn ? "true" : "false");
        const res = await apiFetch("/api/v1/reporter/cases/" + encodeURIComponent(caseId) + "/messages", { method: "POST", body: fd });
        const now = new Date().toISOString();
        const msg = { message_id: res.message_id, sender_type: "reporter", ciphertext, nonce, tag, aad, crypto_version: 1, burn_after_read: burn, consumed_at: null, created_at: now };
        if (data._dek && aad) {
          msg._parsed = C.parseObjectAad(C.hexToBytes(aad));
          msg._plaintext = text;
        }
        data.messages.push(msg);
        const thread = panel.querySelector("#sealed-thread");
        if (thread) {
          const empty = thread.querySelector(".empty");
          if (empty) empty.remove();
          thread.insertAdjacentHTML("beforeend", sealedMsgCard(msg));
        }
        panel.querySelector("#composer-input").value = "";
        if (burn) {
          U.openDialog(`
            <div class="dialog-header"><h2>Sent as burn-on-read</h2><button class="btn-icon" data-dlg-close aria-label="Close">${U.icon("x")}</button></div>
            <div class="dialog-body"><p>Your message is sealed and will burn after a single read. It can no longer be recalled.</p></div>
            <div class="dialog-footer"><button class="btn btn-primary" data-dlg-close>Done</button></div>`);
        }
        U.toast(burn ? "Sent as burn-on-read." : "Message sent.", "success");
      } catch (e) {
        U.toast("Couldn't send: " + e.message, "error");
      } finally {
        U.setLoading(sendBtn, false);
      }
    };

    panel.querySelector("#composer-send").addEventListener("click", () => send(false));
    panel.querySelector("#composer-burn").addEventListener("click", () => send(true));
    panel.querySelector("#composer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); }
    });
  }

  function paintEvidence(panel, data, caseId) {
    const items = data.evidence || [];
    const canDecrypt = Boolean(data._dek);
    panel.innerHTML = `
      <div class="evidence-grid">
        <div class="card">
          <div class="card-header"><h3>Sealed evidence (${items.length})</h3></div>
          <div class="card-body">
            ${items.length ? `
              <div class="file-list">
                ${items.map((e) => `
                  <div class="file-row">
                    <span class="file-icon">${U.icon("file")}</span>
                    <div class="file-meta">
                      <div class="file-name">${contentTypeLabel(e.content_type)} · ${e.evidence_id.slice(0, 8)}</div>
                      <div class="file-info">
                        <span>${fmtSize(e.original_size)} original</span>
                        <span>${fmtSize(e.encrypted_size)} sealed</span>
                        <span>${U.formatDate(e.created_at)}</span>
                      </div>
                      <div class="file-info mono">object: ${e.object_key}</div>
                    </div>
                    <div class="file-actions">
                      <button class="btn btn-ghost btn-sm" data-download="${e.evidence_id}"
                        ${canDecrypt ? "" : "disabled title='Unlock the case with your recovery secret to download'"}>
                        ${U.icon("download")} Download
                      </button>
                    </div>
                  </div>`).join("")}
              </div>` : `
              <section class="empty">
                <div class="empty-icon">${U.icon("file")}</div>
                <h3>No evidence yet</h3>
                <p>Files you upload are sealed under this case envelope.</p>
              </section>`}
            ${!canDecrypt && items.length ? `
              <p class="muted" style="margin-top:var(--sp-3)">
                ${U.icon("lock")} Decryption happens on this device. Enter your recovery secret to enable downloads.
              </p>` : ""}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Evidence notes</h3></div>
          <div class="card-body">
            <p class="muted">Evidence is content-addressed and stored as ciphertext. The vault keeps the sealed bytes, sizes, and content type — never the plaintext. Downloads decrypt in your browser before saving.</p>
          </div>
        </div>
      </div>`;

    panel.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", () => downloadEvidence(btn, data, caseId));
    });
  }

  async function downloadEvidence(btn, data, caseId) {
    const evidenceId = btn.dataset.download;
    if (!data._dek) return;
    btn.disabled = true;
    btn.classList.add("loading");
    try {
      const res = await apiFetch(`/api/v1/reporter/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`);
      let meta = res.crypto_metadata;
      if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch (_) { meta = {}; } }
      meta = meta || {};
      const objectId = meta.file_id || meta.object_key || "";
      if (!objectId) throw new Error("Evidence object id missing from metadata");
      const bytes = await C.decryptFile(data._dek, objectId, C.hexToBytes(res.encrypted_data));
      const name = "veildrop-evidence-" + evidenceId.slice(0, 8) + extFor(res.content_type);
      saveBytes(bytes, name, res.content_type || "application/octet-stream");
      btn.textContent = "Downloaded";
      btn.classList.remove("loading");
      btn.classList.add("btn-success");
      U.toast("Evidence decrypted and downloaded");
    } catch (err) {
      btn.classList.remove("loading");
      btn.textContent = "Failed";
      btn.classList.add("btn-danger");
      U.toast(err.message || "Download failed — wrong recovery secret?");
    }
  }

  function extFor(contentType) {
    if (!contentType) return ".bin";
    const map = {
      "application/pdf": ".pdf",
      "application/zip": ".zip",
      "application/json": ".json",
      "text/plain": ".txt",
      "text/csv": ".csv",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
    };
    if (map[contentType]) return map[contentType];
    const slash = contentType.split("/");
    if (slash.length === 2 && slash[0] === "image") return "." + slash[1];
    return ".bin";
  }

  function saveBytes(bytes, filename, contentType) {
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function paintTimeline(panel, data) {
    const events = [];
    events.push({ at: data.created_at, title: "Report submitted", detail: "Case sealed under the recipient envelope." });
    (data.messages || []).forEach((m) => events.push({
      at: m.created_at,
      title: m.burn_after_read ? "Burn-on-read message sent" : "Message sent",
      detail: `${m.sender_type === "investigator" ? "Investigator" : "Reporter"} · crypto v${m.crypto_version}`,
    }));
    (data.evidence || []).forEach((e) => events.push({
      at: e.created_at,
      title: "Evidence sealed",
      detail: `${contentTypeLabel(e.content_type)} · ${fmtSize(e.original_size)}`,
    }));
    if (data.expires_at) events.push({ at: data.expires_at, title: "Retention ends", detail: "Sealed materials are purged from the vault." });
    events.sort((a, b) => new Date(a.at) - new Date(b.at));

    panel.innerHTML = `
      <div class="card card-pad">
        <h3 style="margin-bottom:var(--sp-5)">Case timeline</h3>
        ${events.length ? `
          <div class="timeline">
            ${events.slice().reverse().map((t, i) => `
              <div class="timeline-item ${i === 0 ? "current" : ""}">
                <div class="timeline-title">${t.title}</div>
                <div class="timeline-time">${t.detail}</div>
                <div class="timeline-time">${U.formatDateTime(t.at)}</div>
              </div>`).join("")}
          </div>` : `
          <section class="empty"><div class="empty-icon">${U.icon("clock")}</div><h3>No events yet</h3></section>`}
      </div>`;
  }

  function paintReporterDetails(panel, data) {
    const en = data.envelope;
    const rc = data.receipt;
    panel.innerHTML = `
      <div class="grid g2">
        <div class="card">
          <div class="card-header">
            <h3>Envelope status</h3>
            ${en ? '<span class="sec-badge verified">' + U.icon("shield") + ' Active</span>' : ""}
          </div>
          <div class="card-body">
            ${en ? `
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Encryption scheme</span><span class="kv-value mono">${en.algorithm}</span></div>
                <div class="kv-row"><span class="kv-label">Key version</span><span class="kv-value">v${en.key_version}</span></div>
                <div class="kv-row"><span class="kv-label">Crypto version</span><span class="kv-value">v${data.crypto_version}</span></div>
                <div class="kv-row"><span class="kv-label">Vault record</span><span class="kv-value mono">reporter-${data.case_id}</span></div>
              </div>
              <p class="field-hint" style="margin-top:var(--sp-4)">Your report is stored as ciphertext. Only you can read it, with your recovery secret.</p>` : `
              <section class="empty">
                <div class="empty-icon">${U.icon("key")}</div>
                <h3>Envelope unavailable</h3>
                <p>No envelope record was returned for this case.</p>
              </section>`}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Retention</h3></div>
          <div class="card-body">
            <div class="kv">
              <div class="kv-row"><span class="kv-label">Created</span><span class="kv-value">${U.formatDateTime(data.created_at)}</span></div>
              <div class="kv-row"><span class="kv-label">Expires</span><span class="kv-value">${data.expires_at ? U.formatDateTime(data.expires_at) : "—"}</span></div>
              <div class="kv-row"><span class="kv-label">Days remaining</span><span class="kv-value">${data.expires_at ? daysRemaining(data.expires_at) + " days" : "—"}</span></div>
              <div class="kv-row"><span class="kv-label">Message count</span><span class="kv-value">${(data.messages || []).length}</span></div>
              <div class="kv-row"><span class="kv-label">Evidence files</span><span class="kv-value">${(data.evidence || []).length}</span></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3>Receipt</h3>
            ${rc ? '<span class="sec-badge verified">' + U.icon("check") + ' Verified</span>' : '<span class="badge badge-outline">Preview</span>'}
          </div>
          <div class="card-body">
            ${rc ? `
              <div class="kv">
                <div class="kv-row"><span class="kv-label">Ciphertext hash</span><span class="kv-value mono" data-copy="${rc.ciphertext_hash}" title="Copy">${rc.ciphertext_hash.slice(0, 30)}… <button class="btn-icon sm" aria-label="Copy ciphertext hash">${U.icon("copy")}</button></span></div>
                <div class="kv-row"><span class="kv-label">Signature</span><span class="kv-value mono" data-copy="${rc.signature}" title="Copy">${rc.signature.slice(0, 30)}… <button class="btn-icon sm" aria-label="Copy signature">${U.icon("copy")}</button></span></div>
                <div class="kv-row"><span class="kv-label">Verification key</span><span class="kv-value mono" data-copy="${rc.verification_key}" title="Copy">${rc.verification_key.slice(0, 30)}… <button class="btn-icon sm" aria-label="Copy verification key">${U.icon("copy")}</button></span></div>
                <div class="kv-row"><span class="kv-label">Signed</span><span class="kv-value">${U.formatDateTime(rc.created_at)}</span></div>
              </div>
              <p class="field-hint" style="margin-top:var(--sp-4)">Ed25519 receipt proving the vault received exactly this report.</p>` : `
              <p class="field-hint">This preview case has no signed receipt on the vault. Live cases include one you can verify anytime.</p>`}
          </div>
        </div>
      </div>`;
    U.copyAttr(panel);
  }

  return { renderSubmit: submitShell, renderCaseCreated, renderAccess, renderReporterCase };
})();
