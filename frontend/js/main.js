/* VeilDrop app entry — mounts routes and starts the router. */
(function () {
  window.VeilTheme.init();
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go && !go.closest("a")) {
      e.preventDefault();
      window.location.hash = go.dataset.go;
    }
  });

  const app = document.getElementById("app");
  app.setAttribute("id", "main");
  app.setAttribute("role", "main");
  app.setAttribute("tabindex", "-1");

  const router = window.VeilRouter.init({
    "/": (el) => window.VeilSite.renderHome(el),
    "/about": (el) => window.VeilSite.renderAbout(el),
    "/security": (el) => window.VeilSite.renderSecurity(el),
    "/features": (el) => window.VeilSite.renderFeatures(el),
    "/faq": (el) => window.VeilSite.renderFaq(el),
    "/contact": (el) => window.VeilSite.renderContact(el),

    "/submit": (el) => window.VeilReporter.renderSubmit(el),
    "/case": (el) => window.VeilReporter.renderReporterCase(el),
    "/access": (el, p) => window.VeilReporter.renderAccess(el, p),

    "/investigator/login": (el) => window.VeilInvestigator.renderLogin(el),
    "/investigator/overview": (el) => window.VeilInvestigator.renderShell(el, "overview"),
    "/investigator/cases": (el) => window.VeilInvestigator.renderShell(el, "cases"),
    "/investigator/critical": (el) => window.VeilInvestigator.renderShell(el, "critical"),
    "/investigator/security": (el) => window.VeilInvestigator.renderShell(el, "security"),
    "/investigator/audit": (el) => window.VeilInvestigator.renderShell(el, "audit"),
    "/investigator/settings": (el) => window.VeilInvestigator.renderShell(el, "settings"),
    "/investigator/case/:id": (el, p) => window.VeilInvestigator.renderShell(el, "case", p),
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      window.VeilUI.openPalette([
        { label: "Home", hint: "Reporter landing", href: "/", icon: "shield" },
        { label: "Submit a report", hint: "Start the wizard", href: "/submit", icon: "plus" },
        { label: "Access a case", hint: "Enter case ID + secret", href: "/access", icon: "key" },
        { label: "Investigator overview", hint: "Dashboards", href: "/investigator/overview", icon: "activity" },
        { label: "All cases", hint: "List, filter, sort", href: "/investigator/cases", icon: "file" },
        { label: "Critical queue", hint: "Needs immediate triage", href: "/investigator/critical", icon: "flame" },
        { label: "Security center", hint: "Posture and policies", href: "/investigator/security", icon: "shield" },
        { label: "Audit log", hint: "Tamper-evident events", href: "/investigator/audit", icon: "clock" },
        { label: "Settings", hint: "Profile and preferences", href: "/investigator/settings", icon: "settings" },
      ], { placeholder: "Jump to a page…" });
    }
  });

  router.start();
})();
