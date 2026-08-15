/* VeilDrop public site — marketing pages, shared shell, scroll-reveal.
   Routes: / (home), /about, /security, /features, /faq, /contact
   Loaded before router.js; used by main.js route table. */
(function (global) {
  const U = global && global.VeilUI
    ? global.VeilUI
    : { icon: () => "", themeIcon: () => "", esc: (s) => s, toast: () => {} };

  const PAGES = [
    { href: "#/", label: "Home" },
    { href: "#/about", label: "About" },
    { href: "#/security", label: "Security" },
    { href: "#/features", label: "Features" },
    { href: "#/faq", label: "FAQ" },
    { href: "#/contact", label: "Contact" },
  ];

  const CONTACT_EMAIL = "poojaryakash55@gmail.com";

  /* ---------------- shared shell ---------------- */

  function navHTML(active, landing = false) {
    const links = landing
      ? [
        { href: "#how-it-works", label: "How it works" },
        { href: "#/security", label: "Security" },
        { href: "#/investigator/login", label: "Investigator login" },
      ]
      : PAGES;
    return `
      <nav class="nav-links" id="site-nav" aria-label="Primary">
        ${links.map((p) => `
          <a href="${p.href}" class="${p.href === active ? "nav-active" : ""}"
             ${p.href === active ? 'aria-current="page"' : ""}>${p.label}</a>`).join("")}
        <a class="nav-mobile-submit" href="#/submit">Submit report</a>
      </nav>`;
  }

  function shellHTML(contentHTML, opts = {}) {
    const active = opts.active || "#/";
    return `
      <div class="site">
        <header class="site-nav" role="banner">
          <div class="container nav-inner">
            <a class="brand" href="#/" aria-label="VeilDrop home">
              <img class="brand-logo" src="img/logo.png" alt="VeilDrop logo" width="44" height="44" />
              <span class="brand-name">VeilDrop</span>
            </a>
            ${navHTML(active, opts.landing === true)}
            <div class="nav-actions">
              <button class="btn-icon" data-theme-toggle aria-label="Switch theme">${U.themeIcon((typeof window !== "undefined" && window.VeilTheme) ? window.VeilTheme.current() : "light")}</button>
              <a class="btn btn-secondary" href="#/access">Access case</a>
              <a class="btn btn-primary nav-cta-desktop" href="#/submit">Submit report</a>
              <button class="btn-icon mobile-nav-btn" data-mobile-nav aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">${U.icon("menu")}</button>
            </div>
          </div>
        </header>
        <main class="site-main" id="site-main">${contentHTML}</main>
        ${footerHTML()}
      </div>`;
  }

  function footerHTML() {
    const year = new Date().getFullYear();
    return `
      <footer class="site-footer" role="contentinfo">
        <div class="container">
          <div class="footer-grid">
            <div class="footer-col footer-brand">
              <a class="brand" href="#/" aria-label="VeilDrop home">
                <img class="brand-logo" src="img/logo.png" alt="VeilDrop logo" width="44" height="44" />
                <span class="brand-name">VeilDrop</span>
              </a>
              <p class="footer-blurb">Client-side encrypted reporting and secure evidence exchange. Your materials are sealed before they ever leave your device.</p>
            </div>
            <nav class="footer-col" aria-label="Product">
              <h4 class="footer-title">Product</h4>
              <a class="footer-link" href="#/features">Features</a>
              <a class="footer-link" href="#/security">Security</a>
              <a class="footer-link" href="#/submit">Submit a report</a>
              <a class="footer-link" href="#/access">Access a case</a>
            </nav>
            <nav class="footer-col" aria-label="Resources">
              <h4 class="footer-title">Resources</h4>
              <a class="footer-link" href="#/faq">FAQ</a>
              <a class="footer-link" href="#/contact">Contact</a>
              <a class="footer-link" href="#/">How it works</a>
            </nav>
            <nav class="footer-col" aria-label="Legal">
              <h4 class="footer-title">Legal</h4>
              <a class="footer-link" href="#/security">Privacy</a>
              <a class="footer-link" href="#/faq">Terms</a>
              <a class="footer-link" href="#/security">Security</a>
            </nav>
          </div>
          <div class="footer-bottom">
            <span class="footer-tech">AES-256-GCM · HKDF-SHA-256 · HPKE (X25519) · Ed25519 · ML-KEM (planned)</span>
            <span class="footer-copy">© ${year} VeilDrop · No plaintext ever leaves your device</span>
          </div>
        </div>
      </footer>`;
  }

  function bindShell(mount) {
    const nav = mount.querySelector(".nav-links");
    const toggle = mount.querySelector("[data-mobile-nav]");
    let backdrop = mount.querySelector(".nav-backdrop") || document.querySelector(".nav-backdrop");
    if (nav && toggle && !backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "nav-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      (document.body || mount).appendChild(backdrop);
    }

    mount.querySelectorAll("[data-mobile-nav]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      setMobileNav(nav, b, !nav.classList.contains("open"));
    }));
    mount.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => {
      setMobileNav(nav, toggle, false);
    }));
    if (backdrop) backdrop.addEventListener("click", () => setMobileNav(nav, toggle, false));

    mount.querySelectorAll("a[href^='#']:not([href^='#/'])").forEach((a) => {
      a.addEventListener("click", (e) => {
        const target = mount.querySelector(a.getAttribute("href"));
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });

    mount.querySelectorAll("[data-faq-q]").forEach((btn) => btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      const open = item.classList.toggle("open");
      const panel = item.querySelector(".faq-a");
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Collapse answer" : "Show answer");
      if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
    }));

    bindNavEscape();
    initScrollNav();
    initHeroGlow(mount);
    initCarousel(mount);
    initFaqTabs(mount);
    bindContactForm(mount);
    initReveal(mount);
  }

  /* ---------------- shell behaviours ---------------- */

  let navEscapeBound = false;
  function bindNavEscape() {
    if (navEscapeBound) return;
    navEscapeBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const nav = document.querySelector(".nav-links.open");
      const toggle = document.querySelector("[data-mobile-nav]");
      if (nav && toggle) {
        setMobileNav(nav, toggle, false);
        toggle.focus();
      }
    });
  }

  function setMobileNav(nav, toggle, open) {
    if (!nav || !toggle) return;
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    const backdrop = document.querySelector(".nav-backdrop");
    if (backdrop) backdrop.classList.toggle("open", open);
  }

  let scrollNavBound = false;
  function applyScrolled() {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    nav.classList.toggle("scrolled", y > 8);
  }
  function initScrollNav() {
    if (!scrollNavBound) {
      scrollNavBound = true;
      window.addEventListener("scroll", applyScrolled, { passive: true });
    }
    applyScrolled();
  }

  function initHeroGlow(root) {
    const hero = root.querySelector(".hero");
    if (!hero || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    hero.addEventListener("mousemove", (e) => {
      const r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      hero.style.setProperty("--gx", ((e.clientX - r.left) / r.width) * 100 + "%");
      hero.style.setProperty("--gy", ((e.clientY - r.top) / r.height) * 100 + "%");
    });
  }

  function initCarousel(root) {
    const region = root.querySelector("[data-carousel]");
    if (!region) return;
    const track = region.querySelector("[data-carousel-track]");
    const slides = Array.from(region.querySelectorAll("[data-carousel-slide]"));
    if (!track || slides.length < 2) return;
    const dots = Array.from(region.querySelectorAll("[data-carousel-dot]"));
    const reduceMotion = !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let index = 0;
    let timer = null;

    const go = (i) => {
      index = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((d, di) => d.setAttribute("aria-current", di === index ? "true" : "false"));
      slides.forEach((s, si) => s.setAttribute("aria-hidden", si === index ? "false" : "true"));
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { if (reduceMotion) return; stop(); timer = setInterval(() => go(index + 1), 6000); };

    region.querySelectorAll("[data-carousel-prev]").forEach((b) => b.addEventListener("click", () => { stop(); go(index - 1); start(); }));
    region.querySelectorAll("[data-carousel-next]").forEach((b) => b.addEventListener("click", () => { stop(); go(index + 1); start(); }));
    dots.forEach((d) => d.addEventListener("click", () => { stop(); go(Number(d.getAttribute("data-carousel-dot"))); start(); }));
    region.addEventListener("mouseenter", stop);
    region.addEventListener("mouseleave", start);
    region.addEventListener("focusin", stop);
    region.addEventListener("focusout", (e) => { if (!region.contains(e.relatedTarget)) start(); });
    region.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); stop(); go(index - 1); start(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(index + 1); start(); }
    });
    go(0);
    start();
  }

  function initAccordionList(list) {
    if (!list || list.dataset.faqReady) return;
    list.dataset.faqReady = "1";
    const btns = Array.from(list.querySelectorAll(".faq-q"));
    btns.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
    list.addEventListener("keydown", (e) => {
      const cur = Array.from(list.querySelectorAll(".faq-q"));
      const idx = cur.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = null;
      if (e.key === "ArrowDown") next = cur[(idx + 1) % cur.length];
      else if (e.key === "ArrowUp") next = cur[(idx - 1 + cur.length) % cur.length];
      else if (e.key === "Home") next = cur[0];
      else if (e.key === "End") next = cur[cur.length - 1];
      if (next) {
        e.preventDefault();
        cur.forEach((b) => { b.tabIndex = b === next ? 0 : -1; });
        next.focus();
      }
    });
  }

  function initFaqTabs(root) {
    const tabsWrap = root.querySelector(".faq-tabs");
    if (!tabsWrap) return;
    const tabs = Array.from(tabsWrap.querySelectorAll(".faq-tab"));
    const panels = Array.from(root.querySelectorAll(".faq-panel"));
    if (!tabs.length || !panels.length) return;

    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach((p) => {
        const on = p.id === tab.getAttribute("aria-controls");
        p.classList.toggle("active", on);
        p.setAttribute("aria-hidden", on ? "false" : "true");
        if (on) initAccordionList(p.querySelector(".faq-list"));
      });
    };

    tabs.forEach((t) => t.addEventListener("click", () => select(t)));
    tabsWrap.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); next.focus(); select(next); }
    });

    select(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]);
  }

  function bindContactForm(root) {
    const form = root.querySelector("#contact-form");
    if (!form) return;
    const ids = ["cf-name", "cf-email", "cf-subject", "cf-message"];
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let valid = true;
      let firstInvalid = null;
      ids.forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        const field = input.closest(".field");
        let ok = input.value.trim().length > 0;
        if (ok && input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim())) ok = false;
        field.classList.toggle("invalid", !ok);
        input.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) { valid = false; if (!firstInvalid) firstInvalid = input; }
      });
      if (!valid) {
        if (firstInvalid) firstInvalid.focus();
        U.toast("Please fix the highlighted fields and try again.", "error");
        return;
      }
      form.reset();
      const note = root.querySelector("#contact-form-note");
      if (note) note.textContent = "Thanks for reaching out — this demo doesn't send messages. For a real reply use the email links, or start a live encrypted report.";
      U.toast("Message noted — thank you.", "success");
    });
  }

  function initReveal(root) {
    const els = root.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    els.forEach((el) => {
      const d = parseInt(el.getAttribute("data-delay"), 10);
      if (d > 0) el.style.transitionDelay = d + "ms";
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((el) => io.observe(el));
  }

  /* ---------------- shared sections ---------------- */

  function sectionHead(kicker, title, sub) {
    return `
      <div class="section-head" data-reveal>
        ${kicker ? `<span class="kicker">${kicker}</span>` : ""}
        <h2>${title}</h2>
        ${sub ? `<p>${sub}</p>` : ""}
      </div>`;
  }

  function testimonialsSection() {
    const slides = [
      { quote: "Reporting was stressful until I realized nothing tied the report back to me. The case ID and recovery secret were all that existed — there was no account to leak.", name: "Anonymous reporter", role: "Public sector" },
      { quote: "As an ethics officer I can verify the signed receipt on every submission. That check matters when you are accountable for what your team holds.", name: "Anonymous ethics officer", role: "Corporate compliance" },
      { quote: "Burn-on-read changed how we handle one-time disclosures. When a message is gone, it is gone — no copy sitting in a queue to be compromised later.", name: "Anonymous investigator", role: "Investigations team" },
    ];
    return `
      <section class="section section-tinted" id="testimonials" aria-labelledby="testimonials-head">
        <div class="container">
          <div class="section-head" data-reveal>
            <span class="kicker">Trusted</span>
            <h2 id="testimonials-head">In their own words</h2>
            <p>Anonymized perspectives from people who rely on secure reporting channels.</p>
          </div>
          <div class="carousel" data-carousel role="region" aria-roledescription="carousel" aria-label="Testimonials" tabindex="0">
            <div class="carousel-track" data-carousel-track aria-live="polite">
              ${slides.map((s, i) => `
                <figure class="carousel-slide" data-carousel-slide role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
                  <blockquote class="carousel-quote">${s.quote}</blockquote>
                  <figcaption class="carousel-meta">
                    <span class="carousel-avatar">${U.icon("users")}</span>
                    <span class="carousel-who"><span class="carousel-name">${s.name}</span><span class="carousel-role">${s.role}</span></span>
                  </figcaption>
                </figure>`).join("")}
            </div>
            <div class="carousel-nav">
              <button class="carousel-btn" data-carousel-prev aria-label="Previous testimonial">${U.icon("arrow")}</button>
              <div class="carousel-dots">
                ${slides.map((s, i) => `<button class="carousel-dot" data-carousel-dot="${i}" aria-label="Show testimonial ${i + 1}"></button>`).join("")}
              </div>
              <button class="carousel-btn" data-carousel-next aria-label="Next testimonial">${U.icon("arrow")}</button>
            </div>
          </div>
        </div>
      </section>`;
  }

  function trustStrip() {
    return `
      <section class="trust-strip" aria-label="Security principles">
        <div class="container trust-inner">
          <div class="trust-item" data-reveal><span class="trust-icon">${U.icon("lock")}</span><span class="trust-text"><strong>ENCRYPTED BEFORE UPLOAD</strong><span>Sealed in your browser, first</span></span></div>
          <div class="trust-item" data-reveal data-delay="60"><span class="trust-icon">${U.icon("fingerprint")}</span><span class="trust-text"><strong>NO REPORTER ACCOUNT</strong><span>No identity data, ever</span></span></div>
          <div class="trust-item" data-reveal data-delay="120"><span class="trust-icon">${U.icon("clock")}</span><span class="trust-text"><strong>CONTROLLED RETENTION</strong><span>You choose how long</span></span></div>
          <div class="trust-item" data-reveal data-delay="180"><span class="trust-icon">${U.icon("activity")}</span><span class="trust-text"><strong>TAMPER-EVIDENT AUDIT</strong><span>Every event signed</span></span></div>
        </div>
      </section>`;
  }

  function howItWorksSection() {
    return `
      <section class="section" id="how-it-works">
        <div class="container">
          ${sectionHead("Process", "How it works", "Four steps, all in your browser.")}
          <div class="how-grid">
            <div class="how-step" data-reveal>
              <span class="how-num">01</span>
              <h3>Write your report</h3>
              <p>Tell your story in your own words, then attach files. Everything stays on this device for now.</p>
            </div>
            <div class="how-step" data-reveal data-delay="80">
              <span class="how-num">02</span>
              <h3>Protect it locally</h3>
              <p>Your report and evidence are encrypted before anything leaves your browser. Not even VeilDrop can read them.</p>
            </div>
            <div class="how-step" data-reveal data-delay="160">
              <span class="how-num">03</span>
              <h3>Save your credentials</h3>
              <p>You receive a case ID and a recovery secret — your only keys to return. Write them down. Nobody else sees them.</p>
            </div>
            <div class="how-step" data-reveal data-delay="240">
              <span class="how-num">04</span>
              <h3>Stay in control</h3>
              <p>Return anytime to answer questions, upload more evidence, or check progress. Messages stay sealed until you open them.</p>
            </div>
          </div>
        </div>
      </section>`;
  }

  function featuresGrid(items) {
    return `
      <div class="grid g3">
        ${items.map((f, i) => `
          <div class="card card-pad feature-card" data-reveal data-delay="${(i % 3) * 70}">
            <span class="feature-icon">${U.icon(f.icon)}</span>
            <h3>${f.title}</h3>
            <p>${f.text}</p>
          </div>`).join("")}
      </div>`;
  }

  function featuresSection() {
    const items = [
      { icon: "lock", title: "End-to-end encryption", text: "AES-256-GCM keys derived locally from your recovery secret. The vault only ever holds ciphertext." },
      { icon: "flame", title: "Burn-on-read messages", text: "Mark a reply to self-destruct after a single open — no copies left behind on the server." },
      { icon: "fingerprint", title: "Anonymous access", text: "No account, no email, no phone number. Your case ID and recovery secret are the only keys." },
      { icon: "file", title: "Sealed evidence vault", text: "Upload files that are encrypted in-browser. They decrypt back on your device when you download them." },
      { icon: "check", title: "Verifiable receipts", text: "Every submission returns a signed receipt you can verify, so you know the ciphertext arrived intact." },
      { icon: "clock", title: "Retention control", text: "Choose how long your case lives. When it expires, sealed materials are purged from the vault." },
    ];
    return `
      <section class="section" id="features">
        <div class="container">
          ${sectionHead("Capabilities", "Everything stays sealed", "Features built around one promise: your data is encrypted before it leaves you.")}
          ${featuresGrid(items)}
        </div>
      </section>`;
  }

  function technologySection() {
    const items = [
      { icon: "lock", title: "AES-256-GCM", text: "Authenticated symmetric encryption for every report, message, and evidence blob." },
      { icon: "key", title: "HKDF-SHA-256", text: "Key derivation from your recovery secret produces an encryption key that never leaves your device." },
      { icon: "shield", title: "X25519 + HPKE", text: "The case envelope wraps the data key so only the intended recipient can unwrap it." },
      { icon: "check", title: "Ed25519 signatures", text: "Receipts and audit events are signed, giving you tamper-evidence you can verify." },
      { icon: "fingerprint", title: "Zero-knowledge storage", text: "The vault stores sealed bytes, sizes, and metadata — never plaintext or decryption keys." },
      { icon: "file", title: "Content addressing", text: "Evidence is stored by its hash, making integrity checks cheap and detection of tampering easy." },
    ];
    return `
      <section class="section" id="technology">
        <div class="container">
          ${sectionHead("Technology", "Primitives you can verify", "Standard, audited cryptographic building blocks — no roll-your-own crypto.")}
          ${featuresGrid(items)}
        </div>
      </section>`;
  }

  function privacySection() {
    return `
      <section class="section section-tinted" id="privacy">
        <div class="container">
          ${sectionHead("Privacy", "Designed so there is less to trust", "I minimize what the system can know, so you don't have to trust my word for it.")}
          <div class="privacy-grid">
            <div class="card card-pad" data-reveal>
              <h3>${U.icon("eyeOff")} What I never see</h3>
              <ul class="privacy-list">
                <li>Your report's plaintext</li>
                <li>Your identity or contact details</li>
                <li>Your decryption keys</li>
                <li>File contents before encryption</li>
              </ul>
            </div>
            <div class="card card-pad" data-reveal data-delay="80">
              <h3>${U.icon("file")} What the vault stores</h3>
              <ul class="privacy-list">
                <li>Encrypted reports, messages, and evidence</li>
                <li>Sizes, timestamps, and status metadata</li>
                <li>A wrapped key that only your secret can unwrap</li>
                <li>Signed receipt and audit records</li>
              </ul>
            </div>
            <div class="card card-pad" data-reveal data-delay="160">
              <h3>${U.icon("info")} Honest limits</h3>
              <ul class="privacy-list">
                <li>Your network metadata (IP, timing) is visible to the hosting provider</li>
                <li>Encryption protects content, not traffic patterns</li>
                <li>For maximum anonymity, use a VPN or Tor when reporting</li>
              </ul>
            </div>
          </div>
        </div>
      </section>`;
  }

  function factsSection() {
    const facts = [
      { icon: "lock", claim: "AES-256-GCM seals every report, message, and evidence file", how: "Authenticated encryption runs in your browser before upload — see crypto.js and the Security page.", href: "#/security" },
      { icon: "check", claim: "The protocol ships with cross-language test vectors", how: "The same inputs produce identical ciphertext in the Node and Python implementations, checked by the repo's test suites.", href: "#/security" },
      { icon: "key", claim: "Recovery secrets derive keys with HKDF-SHA-256, wrapped via HPKE (X25519)", how: "The vault stores only the wrapped key — without your secret, the case is unrecoverable, even by me.", href: "#/security" },
      { icon: "fingerprint", claim: "Every submission returns an Ed25519-signed receipt", how: "Verification recomputes the signed message and checks the signature, proving the vault holds exactly what you sent.", href: "#/faq" },
      { icon: "flame", claim: "Burn-on-read is atomic", how: "Messages are consumed under a row lock — concurrent opens produce exactly one success, not two.", href: "#/faq" },
      { icon: "shield", claim: "All cryptography uses the browser's Web Crypto API", how: "Plaintext and decryption keys never reach the server. This page itself is served as static files.", href: "#/security" },
    ];
    return `
      <section class="section section-tinted" id="facts">
        <div class="container">
          ${sectionHead("Proof, not promises", "Every claim here is verifiable", "No marketing — each item points to the mechanism or the test suite that demonstrates it.")}
          <div class="grid g3">
            ${facts.map((f, i) => `
              <div class="card card-pad fact-card" data-reveal data-delay="${(i % 3) * 70}">
                <span class="feature-icon">${U.icon(f.icon)}</span>
                <h3>${f.claim}</h3>
                <p>${f.how}</p>
                <a class="fact-verify" href="${f.href}">Verify on ${f.href === "#/faq" ? "FAQ" : "Security"} ${U.icon("arrow")}</a>
              </div>`).join("")}
          </div>
        </div>
      </section>`;
  }

  function ctaSection() {
    return `
      <section class="section">
        <div class="container">
          <div class="cta card card-pad" data-reveal>
            <h2>Ready when you are.</h2>
            <p>Everything happens in your browser. No sign-up. No trail back to you.</p>
            <div class="cta-actions">
              <a class="btn btn-primary btn-lg" href="#/submit">Start a confidential report</a>
              <a class="btn btn-ghost btn-lg" href="#/faq">Read the FAQ</a>
            </div>
          </div>
        </div>
      </section>`;
  }

  function pageHero(kicker, title, sub) {
    return `
      <section class="page-hero">
        <div class="container">
          <span class="kicker" data-reveal>${kicker}</span>
          <h1 data-reveal>${title}</h1>
          <p data-reveal>${sub}</p>
        </div>
      </section>`;
  }

  /* ---------------- pages ---------------- */

  function renderHome(mount) {
    mount.innerHTML = shellHTML(`
      <div class="landing-page">
      <section class="hero landing-hero">
        <div class="container hero-inner">
          <div class="hero-copy">
            <span class="badge badge-accent" data-reveal><span class="dot"></span> Anonymous · Client-encrypted</span>
            <h1 data-reveal>Report what matters. Protect what you share.</h1>
            <p class="hero-sub" data-reveal>Submit sensitive information and evidence through a confidential client-encrypted channel. No reporter account required.</p>
            <div class="hero-actions" data-reveal>
              <a class="btn btn-primary btn-lg" href="#/submit">Submit a Confidential Report</a>
              <a class="btn btn-ghost btn-lg" href="#/access">Access Existing Case</a>
            </div>
            <ul class="hero-points" data-reveal>
              <li>${U.icon("lock")} Encrypted in your browser</li>
              <li>${U.icon("fingerprint")} No account, no identity</li>
              <li>${U.icon("flame")} Burn-on-read messages</li>
            </ul>
          </div>
          <div class="hero-art" aria-hidden="true" data-reveal data-delay="120">
            <div class="art-card art-main">
              <span class="art-label">ENVELOPE · HPKE</span>
              <span class="art-value">VEIL-77D913D6E815</span>
              <span class="art-bar"><span style="width: 72%"></span></span>
              <span class="art-note">Encrypted client-side · sealed</span>
            </div>
            <div class="art-card art-side">
              <span class="art-label">MESSAGE · BURN-ON-READ</span>
              <span class="art-value">1 delivery</span>
              <span class="badge badge-warning"><span class="dot"></span> Self-destructing</span>
            </div>
          </div>
        </div>
      </section>
      <section class="trust-strip" aria-label="Reporting principles">
        <div class="container trust-inner">
          <div class="trust-item" data-reveal><span class="trust-icon">${U.icon("lock")}</span><span class="trust-text"><strong>Encrypted Before Upload</strong><span>Sensitive content is protected on your device before transmission.</span></span></div>
          <div class="trust-item" data-reveal><span class="trust-icon">${U.icon("fingerprint")}</span><span class="trust-text"><strong>No Reporter Account</strong><span>Submit and access your case without a conventional account.</span></span></div>
          <div class="trust-item" data-reveal><span class="trust-icon">${U.icon("clock")}</span><span class="trust-text"><strong>Controlled Retention</strong><span>Sensitive information can expire according to its retention policy.</span></span></div>
        </div>
      </section>
      ${howItWorksSection()}
      ${featuresSection()}
      ${factsSection()}
      ${testimonialsSection()}
      ${ctaSection()}
      </div>
    `, { active: "#/", landing: true });
    bindShell(mount);
  }

  function renderAbout(mount) {
    mount.innerHTML = shellHTML(`
      ${pageHero("About VeilDrop", "Confidential reporting, without the trust tax.", "I built this so that people can speak up about problems without putting a target on their backs — and so the people who receive those reports can act with verifiable integrity.")}
      <section class="section section-tinted">
        <div class="container">
          ${sectionHead("Mission", "Why VeilDrop exists", "Most reporting channels ask you to trust the middleman. I built one where you don't have to.")}
          <div class="about-copy" data-reveal>
            <p>Whistleblowing channels often fail because they collect too much data — identities, accounts, and unencrypted messages — creating a single point of failure that can leak, be subpoenaed, or be misused.</p>
            <p>VeilDrop inverts this model. Encryption happens in your browser before anything is transmitted. The service stores only ciphertext and never records your identity. A case lives for exactly as long as you choose and burns-on-read when you need it to.</p>
            <p>The result is a channel where a reporter's safety doesn't depend on the operator's goodwill, and where the people triaging reports can prove — cryptographically — that the materials they hold are exactly what was submitted.</p>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead("By the numbers", "Structural guarantees", "Metrics that stem from my architecture, rather than marketing.")}
          <div class="grid g4">
            <div class="card card-pad metric" data-reveal><span class="metric-value">100%</span><span class="metric-label">of content encrypted before upload</span></div>
            <div class="card card-pad metric" data-reveal data-delay="60"><span class="metric-value">0</span><span class="metric-label">identities or accounts stored</span></div>
            <div class="card card-pad metric" data-reveal data-delay="120"><span class="metric-value">1</span><span class="metric-label">recovery secret you must protect</span></div>
            <div class="card card-pad metric" data-reveal data-delay="180"><span class="metric-value">6</span><span class="metric-label">standard crypto primitives in the stack</span></div>
          </div>
        </div>
      </section>
      <section class="section section-tinted">
        <div class="container">
          ${sectionHead("My story", "Fewer points of failure", "Most reporting channels fail by collecting too much. VeilDrop is built the other way around.")}
          <div class="about-copy" data-reveal>
            <p>I started with a simple observation: the security of a reporting channel usually depends on the goodwill of its operators. That represents a single point of failure, which is the one thing I decided to remove.</p>
            <p>If reporters never hand over their identities, and encryption happens before anything leaves their devices, then a leak, a subpoena, or even a hostile takeover of the service reveals nothing about who spoke up or what they said.</p>
            <p>Every decision since — signed receipts, retention control, burn-on-read, and no backdoors — follows from that principle. I would rather publish my threat model than hide behind marketing claims.</p>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead("Principles", "What I optimise for", "Four principles guide every design decision.")}
          <div class="grid g4">
            <div class="card card-pad feature-card" data-reveal><span class="feature-icon">${U.icon("lock")}</span><h3>Privacy by design</h3><p>If a feature can be built without collecting data, it is. Plaintext never touches the servers.</p></div>
            <div class="card card-pad feature-card" data-reveal data-delay="60"><span class="feature-icon">${U.icon("check")}</span><h3>Verifiable security</h3><p>Standard primitives, signed receipts, and an audit log you can check — not promises.</p></div>
            <div class="card card-pad feature-card" data-reveal data-delay="120"><span class="feature-icon">${U.icon("users")}</span><h3>Accessible reporting</h3><p>No accounts, no onboarding, and no friction at the exact moment someone needs courage.</p></div>
            <div class="card card-pad feature-card" data-reveal data-delay="180"><span class="feature-icon">${U.icon("flame")}</span><h3>Disappear on demand</h3><p>Retention you choose, burn-on-read replies, and expiry that purges sealed materials.</p></div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead("Creator", "The person behind VeilDrop", "This project was created entirely by Akash.")}
          <div class="team-grid" style="display: flex; justify-content: center;">
            <div class="card card-pad team-card" data-reveal style="max-width: 320px; width: 100%;"><span class="team-avatar">${U.icon("user")}</span><h3>Akash</h3><span class="team-role">Creator</span></div>
          </div>
        </div>
      </section>
      <section class="section section-tinted">
        <div class="container">
          ${sectionHead("How it's built", "Browser-first, server-minimal", "The heavy lifting happens where only you can see it.")}
          <div class="how-grid">
            <div class="how-step" data-reveal><span class="how-num">1</span><h3>Your browser encrypts</h3><p>Web Crypto derives keys and seals content using standard primitives — no plugins, no uploads of plaintext.</p></div>
            <div class="how-step" data-reveal data-delay="80"><span class="how-num">2</span><h3>The vault stores sealed bytes</h3><p>Encrypted reports, files, and envelopes are content-addressed and retained on your schedule.</p></div>
            <div class="how-step" data-reveal data-delay="160"><span class="how-num">3</span><h3>Recipients unwrap locally</h3><p>Investigators and reporters decrypt only on their own devices, using keys that were never transmitted.</p></div>
            <div class="how-step" data-reveal data-delay="240"><span class="how-num">4</span><h3>Everything is auditable</h3><p>Signed receipts and tamper-evident events let you verify the trail end-to-end.</p></div>
          </div>
        </div>
      </section>
      ${ctaSection()}
    `, { active: "#/about" });
    bindShell(mount);
  }

  function renderSecurity(mount) {
    const stack = [
      { icon: "lock", title: "AES-256-GCM", text: "Authenticated encryption for all content objects." },
      { icon: "key", title: "HKDF-SHA-256", text: "Derives the data key from your recovery secret." },
      { icon: "shield", title: "HPKE · X25519", text: "Wraps the data key for the case envelope." },
      { icon: "check", title: "Ed25519", text: "Signs receipts and audit events for verification." },
      { icon: "fingerprint", title: "SHA-256", text: "Content addressing and integrity checks." },
      { icon: "flame", title: "Burn-on-read", text: "One-shot messages that expire after a single open." },
    ];
    mount.innerHTML = shellHTML(`
      ${pageHero("Security", "Zero-knowledge by construction.", "I publish exactly what the system does and does not protect, so you can decide how much to trust the system — or how little you need to.")}
          <section class="section section-tinted">
            <div class="container">
              ${sectionHead("Threat model", "What VeilDrop defends against", "The system is designed so that a compromise of the service does not reveal your content.")}
              <div class="grid g3">
                <div class="card card-pad feature-card" data-reveal><span class="feature-icon">${U.icon("shield")}</span><h3>Server compromise</h3><p>An attacker who obtains the vault's database and disks gets ciphertext, sizes, and timestamps — nothing readable.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="70"><span class="feature-icon">${U.icon("users")}</span><h3>Insider access</h3><p>Operators never hold decryption keys. Recovery secrets exist only on the reporter's device.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="140"><span class="feature-icon">${U.icon("flame")}</span><h3>Retention after the fact</h3><p>Burn-on-read messages are removed from listings and consumed in a single atomic operation. Expired cases are purged.</p></div>
              </div>
              <div class="card card-pad threat-note" data-reveal>
                <h3>${U.icon("info")} What encryption does not do</h3>
                <p>Client-side encryption protects <strong>content</strong>. Network metadata — your IP address, the timing and volume of traffic — remains visible to the hosting provider. Use a VPN or Tor for additional anonymity. VeilDrop cannot hide the fact that someone connected.</p>
              </div>
            </div>
          </section>
          <section class="section">
            <div class="container">
              ${sectionHead("Cryptographic stack", "Standard primitives, audited implementations", "No bespoke algorithms. Everything is built on well-studied constructions.")}
              <div class="grid g3">
                ${stack.map((s, i) => `
                  <div class="card card-pad feature-card" data-reveal data-delay="${(i % 3) * 70}">
                    <span class="feature-icon">${U.icon(s.icon)}</span>
                    <h3>${s.title}</h3>
                    <p>${s.text}</p>
                  </div>`).join("")}
              </div>
              <div class="card card-pad threat-note" data-reveal>
                <h3>${U.icon("key")} Key custody</h3>
                <p>Your recovery secret derives the key that wraps your case's data key. The vault stores only the wrapped key. Without your secret, the case is unrecoverable — including by VeilDrop staff. There is no backdoor and no reset.</p>
              </div>
            </div>
          </section>
          <section class="section section-tinted">
            <div class="container">
              ${sectionHead("Operational hardening", "Layers around the sealed core", "Defense in depth so the ciphertext stays safe and the trail stays honest.")}
              <div class="grid g3">
                <div class="card card-pad feature-card" data-reveal><span class="feature-icon">${U.icon("activity")}</span><h3>Tamper-evident audit log</h3><p>Every security event is hashed and signed. Any modification to the log is detectable.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="70"><span class="feature-icon">${U.icon("check")}</span><h3>Signed receipts</h3><p>Submissions return an Ed25519-signed receipt binding you to the exact ciphertext stored.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="140"><span class="feature-icon">${U.icon("file")}</span><h3>Content-addressed evidence</h3><p>Files are stored by SHA-256 hash, so tampering or corruption is immediately detectable.</p></div>
                <div class="card card-pad feature-card" data-reveal><span class="feature-icon">${U.icon("lock")}</span><h3>Row-level access control</h3><p>Case records are scoped to assigned investigators. Unassigned access is denied at the database layer.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="70"><span class="feature-icon">${U.icon("clock")}</span><h3>Auto-expiry sweep</h3><p>A scheduled job marks expired cases and revokes their envelopes, shrinking the attack surface over time.</p></div>
                <div class="card card-pad feature-card" data-reveal data-delay="140"><span class="feature-icon">${U.icon("flame")}</span><h3>Atomic burn</h3><p>Burn-on-read consumes under a row lock — concurrent attempts result in exactly one success.</p></div>
              </div>
            </div>
          </section>
          ${technologySection()}
          ${privacySection()}
          ${ctaSection()}
    `, { active: "#/security" });
    bindShell(mount);
  }

  function renderFeatures(mount) {
    const items = [
      { icon: "lock", title: "End-to-end encryption", text: "Reports, replies, and evidence are sealed with AES-256-GCM keys derived on your device. The server never sees plaintext." },
      { icon: "fingerprint", title: "No-account anonymity", text: "There is no profile, email, or password to compromise. A case ID plus recovery secret is the entire credential." },
      { icon: "flame", title: "Burn-on-read replies", text: "Mark messages to self-destruct after one open. Useful for sensitive one-time disclosures." },
      { icon: "file", title: "Sealed evidence vault", text: "Upload multiple files that are encrypted in-browser and decrypted only on download, on your device." },
      { icon: "check", title: "Verifiable receipts", text: "Each submission returns a signed receipt. Verify it anytime to prove the vault holds exactly what you sent." },
      { icon: "clock", title: "Retention control", text: "Pick how long your case lives. On expiry, sealed materials and envelopes are purged." },
      { icon: "users", title: "Structured case conversations", text: "Return with your case ID to answer investigator questions without ever revealing who you are." },
      { icon: "activity", title: "Tamper-evident audit", text: "Investigator actions are logged and signed, giving administrators a verifiable trail." },
      { icon: "shield", title: "Zero-knowledge storage", text: "The vault stores ciphertext, sizes, timestamps, and wrapped keys — nothing that can read your content." },
    ];
    mount.innerHTML = shellHTML(`
      ${pageHero("Features", "Everything sealed. Nothing to lose.", "Every feature exists to strengthen one guarantee: your materials stay confidential, and you stay in control.")}
      <section class="section section-tinted">
        <div class="container">
          ${sectionHead("The full toolkit", "Nine capabilities, one promise", "All encryption happens in your browser with the Web Crypto API.")}
          ${featuresGrid(items)}
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead("Compare honestly", "What VeilDrop is — and isn't", "Clarity beats marketing.")}
          <div class="compare-grid">
            <div class="card card-pad" data-reveal>
              <h3>${U.icon("check")} It is</h3>
              <ul class="privacy-list">
                <li>Client-side encrypted reporting and file exchange</li>
                <li>Anonymous, credential-free reporter access</li>
                <li>A verifiable, tamper-evident audit trail</li>
                <li>Retention and burn-on-read controls</li>
              </ul>
            </div>
            <div class="card card-pad" data-reveal data-delay="80">
              <h3>${U.icon("alert")} It isn't</h3>
              <ul class="privacy-list">
                <li>An anonymity network — network metadata still exists</li>
                <li>A data-recovery service — lose your secret, lose the case</li>
                <li>A legal-immunity shield — no tool replaces legal advice</li>
                <li>Your only measure — pair it with VPN/Tor and good opsec</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      ${ctaSection()}
    `, { active: "#/features" });
    bindShell(mount);
  }

  const FAQ_CATEGORIES = [
    { id: "privacy", label: "Privacy & anonymity" },
    { id: "access", label: "Access & credentials" },
    { id: "security", label: "Encryption & verification" },
    { id: "retention", label: "Retention & messages" },
  ];

  function renderFaq(mount) {
    const faqs = [
      { cat: "privacy", q: "Is my identity known to VeilDrop?", a: "No. VeilDrop creates no account and stores no name, email, or phone number. Your case ID and recovery secret are generated on your device. I cannot tie a report back to you — though as with any website, your network metadata (IP, timing) is visible to the hosting provider, which is why I recommend a VPN or Tor for maximum anonymity." },
      { cat: "privacy", q: "Can anyone at VeilDrop read my report?", a: "No. Reports are encrypted in your browser before upload. The vault stores only ciphertext and a wrapped key. Your recovery secret — which unwraps that key — exists only on your device. Staff, DBAs, and a fully compromised server still cannot read the content." },
      { cat: "access", q: "How do I get back into my case?", a: "You return with two things: the case ID and your recovery secret. Enter both on the Access page and your browser re-derives the key to decrypt the case. Save them somewhere safe — VeilDrop cannot reset or recover either one." },
      { cat: "access", q: "What if I lose my recovery secret?", a: "The case becomes unrecoverable. There is intentionally no backdoor: the vault cannot unwrap your case's key without it. If you think you've lost it, you can still submit a new case." },
      { cat: "security", q: "Can I verify my receipt?", a: "Yes. Every submission returns a receipt signed with an Ed25519 key. The receipt binds the case ID, the ciphertext hash, and a timestamp. Verification recomputes the signed message and checks the signature, so you can confirm the vault holds exactly what you submitted." },
      { cat: "security", q: "Who decrypts my evidence files?", a: "Only the holder of the case's data key — you, and an investigator assigned to the case. Downloads fetch the sealed bytes and decrypt locally in the browser. The server never decrypts anything." },
      { cat: "security", q: "Is VeilDrop open source?", a: "I publish the cryptographic protocol and cross-language test vectors so the implementation can be independently verified. Contact me for source access or questions about a deployment." },
      { cat: "retention", q: "What is burn-on-read?", a: "A message marked burn-on-read is delivered at most once. When it is opened, the server atomically marks it consumed and removes it from listings. A second attempt returns an error. It is useful for one-time disclosures you don't want lingering." },
      { cat: "retention", q: "What happens when my case expires?", a: "You choose the retention period when you submit. When it passes, a sweep marks the case expired, revokes its envelope, and the sealed materials stop being served. Purposeful, short retention shrinks how long sensitive data exists." },
    ];
    mount.innerHTML = shellHTML(`
      ${pageHero("FAQ", "Questions, answered honestly.", "If your question isn't here, use the contact page — or better, start a report and ask inside your case.")}
      <section class="section section-tinted">
        <div class="container narrow">
          <div class="faq-tabs" role="tablist" aria-label="FAQ categories">
            ${FAQ_CATEGORIES.map((c, i) => `
              <button class="faq-tab" id="faq-tab-${c.id}" role="tab" aria-selected="${i === 0 ? "true" : "false"}" aria-controls="faq-panel-${c.id}" tabindex="${i === 0 ? 0 : -1}">
                ${c.label} <span class="count">${faqs.filter((f) => f.cat === c.id).length}</span>
              </button>`).join("")}
          </div>
          <div class="faq-panels">
            ${FAQ_CATEGORIES.map((c) => `
              <div class="faq-panel" id="faq-panel-${c.id}" role="tabpanel" aria-labelledby="faq-tab-${c.id}" data-reveal>
                <div class="faq-list" role="tablist" aria-label="${c.label} questions">
                  ${faqs.filter((f) => f.cat === c.id).map((f, j) => `
                    <div class="faq-item">
                      <button class="faq-q" data-faq-q role="tab" aria-expanded="false" aria-controls="faq-a-${c.id}-${j}" id="faq-q-${c.id}-${j}">
                        <span>${U.icon("arrow")}</span>
                        <span>${f.q}</span>
                      </button>
                      <div class="faq-a" id="faq-a-${c.id}-${j}" role="tabpanel" aria-labelledby="faq-q-${c.id}-${j}" aria-hidden="true">
                        <p>${f.a}</p>
                      </div>
                    </div>`).join("")}
                </div>
              </div>`).join("")}
          </div>
          <div class="card card-pad faq-cta" data-reveal>
            <h3>Still curious?</h3>
            <p>Get in touch through the contact page, or jump straight into a live, encrypted case.</p>
            <div class="cta-actions">
              <a class="btn btn-primary" href="#/contact">Contact me</a>
              <a class="btn btn-ghost" href="#/submit">Start a report</a>
            </div>
          </div>
        </div>
      </section>
    `, { active: "#/faq" });
    bindShell(mount);
  }

  function renderContact(mount) {
    mount.innerHTML = shellHTML(`
      ${pageHero("Contact", "I'd love to hear from you.", "Questions about deploying VeilDrop, feedback on the product, or press inquiries — reach out below.")}
      <section class="section section-tinted">
        <div class="container">
          <div class="contact-grid">
            <div class="card card-pad" data-reveal>
              <h3>Send a message</h3>
              <p class="contact-sub">This is a static demo — messages aren't transmitted anywhere. For anything sensitive, use a <a href="#/submit">live encrypted report</a> instead; email is not end-to-end encrypted.</p>
              <form id="contact-form" class="contact-form" novalidate>
                <div class="field">
                  <label for="cf-name">Name <span class="req">*</span></label>
                  <input class="input" id="cf-name" name="name" type="text" autocomplete="name" required placeholder="Your name" aria-describedby="cf-name-error" />
                  <span class="field-error" id="cf-name-error">Please enter your name.</span>
                </div>
                <div class="field">
                  <label for="cf-email">Email <span class="req">*</span></label>
                  <input class="input" id="cf-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" aria-describedby="cf-email-error" />
                  <span class="field-error" id="cf-email-error">Please enter a valid email address.</span>
                </div>
                <div class="field">
                  <label for="cf-subject">Subject <span class="req">*</span></label>
                  <input class="input" id="cf-subject" name="subject" type="text" required placeholder="What is this about?" aria-describedby="cf-subject-error" />
                  <span class="field-error" id="cf-subject-error">Please add a subject.</span>
                </div>
                <div class="field">
                  <label for="cf-message">Message <span class="req">*</span></label>
                  <textarea class="textarea" id="cf-message" name="message" rows="5" required placeholder="Tell me a little more…" aria-describedby="cf-message-error"></textarea>
                  <span class="field-error" id="cf-message-error">Please write a short message.</span>
                </div>
                <button class="btn btn-primary" type="submit">${U.icon("arrow")} Send message</button>
                <p class="form-note" id="contact-form-note" role="status" aria-live="polite"></p>
              </form>
            </div>
            <div class="contact-side">
              <div class="card card-pad" data-reveal>
                <h3>${U.icon("users")} Deployment</h3>
                <p>Interested in running VeilDrop for your organization? I'm happy to walk through architecture, threat model, and rollout.</p>
                <a class="btn btn-ghost" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("VeilDrop deployment inquiry")}">${U.icon("arrow")} ${CONTACT_EMAIL}</a>
              </div>
              <div class="card card-pad" data-reveal data-delay="80">
                <h3>${U.icon("shield")} Security disclosures</h3>
                <p>Found a vulnerability? Please follow responsible disclosure — describe the issue without exposing live data.</p>
                <a class="btn btn-ghost" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Security disclosure")}">${U.icon("arrow")} ${CONTACT_EMAIL}</a>
              </div>
              <div class="card card-pad" data-reveal data-delay="160">
                <h3>${U.icon("activity")} Press &amp; partners</h3>
                <p>Media and partner inquiries are welcome. I'll respond to verified requests within a few business days.</p>
                <a class="btn btn-ghost" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Press / partnership")}">${U.icon("arrow")} ${CONTACT_EMAIL}</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    `, { active: "#/contact" });
    bindShell(mount);
  }

  function runSelfCheck() {
    const results = [];
    const t = (name, fn) => {
      try { fn(); results.push({ name, ok: true }); }
      catch (err) { results.push({ name, ok: false, err: err.message }); }
    };

    t("all six routes resolve to renderers", () => {
      const map = {
        "/": renderHome, "/about": renderAbout, "/security": renderSecurity,
        "/features": renderFeatures, "/faq": renderFaq, "/contact": renderContact,
      };
      Object.values(map).forEach((fn) => { if (typeof fn !== "function") throw new Error("missing renderer"); });
    });

    t("PAGES lists all six public pages", () => {
      if (PAGES.length !== 6) throw new Error("PAGES.length = " + PAGES.length);
      if (!PAGES.some((p) => p.href === "#/contact")) throw new Error("contact link missing");
    });

    t("SiteShell mounts nav + footer landmarks", () => {
      const html = shellHTML("<h1>probe</h1>", { active: "#/" });
      if (!html.includes('role="banner"')) throw new Error("missing banner");
      if (!html.includes('role="contentinfo"')) throw new Error("missing contentinfo");
      if (!html.includes("<h1>probe</h1>")) throw new Error("content not mounted");
    });

    t("accordion / carousel / reveal / tabs helpers present", () => {
      const helpers = [initReveal, initCarousel, initFaqTabs, initAccordionList, initScrollNav, initHeroGlow, bindContactForm];
      helpers.forEach((h) => { if (typeof h !== "function") throw new Error("helper missing"); });
    });

    return results;
  }

  const api = {
    renderHome, renderAbout, renderSecurity, renderFeatures, renderFaq, renderContact,
    CONTACT_EMAIL, runSelfCheck,
  };
  if (global) global.VeilSite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof require === "function" && require.main === module) {
    const results = runSelfCheck();
    results.forEach((r) => console.log((r.ok ? "  ok  " : "  FAIL ") + r.name + (r.ok ? "" : " -> " + r.err)));
    const failed = results.filter((r) => !r.ok);
    console.log(failed.length ? failed.length + " site.js self-check failure(s)" : "site.js self-check passed (" + results.length + " checks)");
    process.exit(failed.length ? 1 : 0);
  }
})(typeof window !== "undefined" ? window : null);
