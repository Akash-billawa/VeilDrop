/* VeilDrop mock data — realistic, internally consistent demo state for the UI. */
window.VeilMock = (() => {
  const H = window.VeilUI;

  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 864e5).toISOString();
  const daysAhead = (n) => new Date(now + n * 864e5).toISOString();

  const evidence = [
    { id: "ev-001", name: "invoice_archive_2026.xlsx", size: "1.8 MB", type: "Spreadsheet", uploadedAt: daysAgo(3), checksum: "sha256:9f2c…e4a1", fingerprint: "docs:421b", selected: true },
    { id: "ev-002", name: "vendor_approval_screenshots.zip", size: "6.2 MB", type: "Archive", uploadedAt: daysAgo(3), checksum: "sha256:7d10…c3f8", fingerprint: "images:009c", selected: true },
    { id: "ev-003", name: "correspondence_0507.pdf", size: "412 KB", type: "PDF", uploadedAt: daysAgo(2), checksum: "sha256:03be…7aa2", fingerprint: "docs:88d1", selected: false },
  ];

  const reporters = {
    CASE_ID: "VEIL-77D913D6E815",
    recovery: "WARROW MOLTO 4471 BRACK FIDO LOMEN",
    burnToken: "burn-9F4E81C2",
  };

  const caseDetails = {
    id: "VEIL-77D913D6E815",
    title: "Procurement kickbacks at Meridian subsidiary",
    summary: "Vendor markup patterns suggesting undisclosed related-party relationships in the Meridian Group procurement pipeline.",
    classification: "UNCLASSIFIED",
    status: "IN PROGRESS",
    priority: "HIGH",
    createdAt: daysAgo(12),
    updatedAt: daysAgo(0.3),
    reporterLabel: "R-884",
    assignedTo: "Case Team Delta",
    retention: { days: 90, mode: "Fixed", expiresAt: daysAhead(78) },
    burnOnRead: false,
    envelope: {
      version: "HPKE v3",
      cipher: "X25519 + ChaCha20-Poly1305",
      wrappedKey: "A4 19 77 … 02 B3",
      fingerprint: "3B7A-9F21-C4D0-881E",
      lastRotated: daysAgo(5),
    },
  };

  const timeline = [
    { id: "t1", title: "Report submitted", detail: "Case created and encrypted under recipient key." , at: daysAgo(12), kind: "system" },
    { id: "t2", title: "Evidence uploaded", detail: "3 files attached, content-hash registered.", at: daysAgo(12), kind: "system" },
    { id: "t3", title: "Assigned to Case Team Delta", detail: "Added by A. Meridian · write access granted.", at: daysAgo(10), kind: "system" },
    { id: "t4", title: "Investigator first message", detail: "Thank-you received by reporter.", at: daysAgo(9), kind: "investigator" },
    { id: "t5", title: "Reporter reply", detail: "Clarification on vendor list.", at: daysAgo(7), kind: "reporter" },
    { id: "t6", title: "Priority raised to High", detail: "New evidence supports escalating severity.", at: daysAgo(4), kind: "system" },
  ];

  const thread = [
    { id: "m1", from: "investigator", name: "A. Meridian", at: daysAgo(9), text: "Thank you for reporting this. We have reviewed the files you attached — the patterns you described match our working hypothesis. Could you confirm whether the approval emails from May also routed through the same vendor mailbox?" },
    { id: "m2", from: "reporter", name: "You (R-884)", at: daysAgo(7), text: "Yes — every May approval went through the same mailbox. I've also noticed the vendor's bidder ID appears on two other contracts not mentioned in my report. I can upload those if useful." },
    { id: "m3", from: "investigator", name: "A. Meridian", at: daysAgo(4), text: "That would be useful. Please upload them and flag them for the financials workstream. No need to include identifying details about yourself." },
    { id: "m4", from: "investigator", name: "A. Meridian", at: daysAgo(2), text: "Sensitive — the shared mailbox is also linked to the Q2 expense anomalies under review. We'll take this privately from here. This message will burn after you open it once.", burn: true, consumed: false },
    { id: "m5", from: "internal", name: "Internal note", at: daysAgo(1), text: "Legal review requested before the next reply. Do not reference the mailbox in reporter-facing messages until the forensic copy is sealed. — AM", kind: "internal" },
  ];

  const messagesReceived = [
    { id: "im1", from: "A. Meridian", snippet: "Thank you for reporting this. We have reviewed the files…", at: daysAgo(9), unread: false },
  ];

  const investigators = [
    { id: "inv-1", name: "Alina Meridian", handle: "a.meridian", role: "Case Lead", status: "Active", keyStatus: "Verified", joinedAt: daysAgo(210) },
    { id: "inv-2", name: "Dmitri Voelker", handle: "d.voelker", role: "Reviewer", status: "Active", keyStatus: "Verified", joinedAt: daysAgo(180) },
    { id: "inv-3", name: "Priya Raman", handle: "p.raman", role: "Evidence Reviewer", status: "Active", keyStatus: "Verified", joinedAt: daysAgo(150) },
    { id: "inv-4", name: "Tomasz Nowak", handle: "t.nowak", role: "Reviewer", status: "Suspended", keyStatus: "—", joinedAt: daysAgo(400) },
  ];

  const audit = [
    { id: "a1", at: daysAgo(0.1), actor: "System", action: "Key rotation", target: "Case VEIL-77D913D6E815", ip: "internal", severity: "warning", category: "crypto", detail: "Envelope re-wrapped under 5 recipient keys. Previous fingerprint 3B7A-9F21-C4D0-881E retained for audit." },
    { id: "a2", at: daysAgo(0.4), actor: "d.voelker", action: "Read case", target: "VEIL-77D913D6E815", ip: "10.20.8.14", severity: "info", category: "access", detail: "Investigator opened the sealed envelope. Plaintext decrypted in session memory only." },
    { id: "a3", at: daysAgo(1.2), actor: "a.meridian", action: "Assigned investigator", target: "p.raman → VEIL-77D913D6E815", ip: "10.20.8.11", severity: "info", category: "access", detail: "Write access granted to Evidence Reviewer for the financials workstream." },
    { id: "a4", at: daysAgo(2), actor: "System", action: "Envelope unwrap", target: "Case VEIL-77D913D6E815", ip: "internal", severity: "notice", category: "crypto", detail: "Automated integrity check passed. All 7 fingerprint hashes valid." },
    { id: "a5", at: daysAgo(4), actor: "a.meridian", action: "Updated priority", target: "VEIL-77D913D6E815 → High", ip: "10.20.8.11", severity: "warning", category: "case", detail: "New evidence supports escalating severity from Medium to High." },
    { id: "a6", at: daysAgo(6), actor: "System", action: "Audit archive", target: "142 events", ip: "internal", severity: "info", category: "system", detail: "Events older than 30 days sealed and archived to cold storage." },
    { id: "a7", at: daysAgo(9), actor: "a.meridian", action: "Sent message", target: "VEIL-77D913D6E815", ip: "10.20.8.11", severity: "info", category: "case", detail: "Standard (non-burn) message sealed under the case envelope." },
    { id: "a8", at: daysAgo(0.05), actor: "System", action: "Login failed", target: "unknown handle", ip: "185.220.101.4", severity: "critical", category: "auth", detail: "Brute-force pattern detected. Source throttled and added to watchlist. No account affected." },
  ];

  const criticalCases = [
    { id: "VEIL-9A23F1C4D8", title: "Credential rotation overdue in prod", summary: "Automated scan flagged 4 long-lived secrets. Root access already removed.", priority: "CRITICAL", status: "New", updatedAt: daysAgo(0.05), reporterLabel: "S-112", progress: 0 },
    { id: "VEIL-31B7A09E2C", title: "Physical access logs inconsistency", summary: "Badge records missing for 14–16 June at vault site. Security footage retained.", priority: "CRITICAL", status: "Needs triage", updatedAt: daysAgo(0.3), reporterLabel: "R-902", progress: 25 },
  ];

  const pendingCases = [
    { id: "VEIL-77D913D6E815", title: "Procurement kickbacks at Meridian subsidiary", priority: "HIGH", status: "In progress", updatedAt: daysAgo(0.3), reporterLabel: "R-884", progress: 60, assigned: "Case Team Delta", category: "Fraud & finance", evidenceCount: 3, expiresAt: daysAhead(78), classification: "UNCLASSIFIED" },
    { id: "VEIL-2C8F4401B9", title: "Offboarding gap — departed contractor access", priority: "HIGH", status: "Awaiting evidence", updatedAt: daysAgo(1), reporterLabel: "R-891", progress: 30, assigned: "Unassigned", category: "Security & safety", evidenceCount: 0, expiresAt: daysAhead(83), classification: "UNCLASSIFIED" },
    { id: "VEIL-5E1A7C90D3", title: "Expense report anomalies, Q2", priority: "MEDIUM", status: "In progress", updatedAt: daysAgo(2), reporterLabel: "R-873", progress: 75, assigned: "d.voelker", category: "Fraud & finance", evidenceCount: 5, expiresAt: daysAhead(70), classification: "CONFIDENTIAL" },
    { id: "VEIL-8F3B2A10E7", title: "Vendor PO without contract reference", priority: "MEDIUM", status: "Needs triage", updatedAt: daysAgo(3), reporterLabel: "R-866", progress: 15, assigned: "Unassigned", category: "Ethics & conduct", evidenceCount: 1, expiresAt: daysAhead(88), classification: "UNCLASSIFIED" },
    { id: "VEIL-0D9E55C2A1", title: "Suspicious API key usage", priority: "LOW", status: "Awaiting evidence", updatedAt: daysAgo(5), reporterLabel: "R-842", progress: 10, assigned: "Unassigned", category: "Security & safety", evidenceCount: 2, expiresAt: daysAhead(85), classification: "RESTRICTED" },
    { id: "VEIL-7B2E1F60A4", title: "Harassment complaint — vendor liaison", priority: "HIGH", status: "New", updatedAt: daysAgo(1.5), reporterLabel: "R-918", progress: 0, assigned: "Unassigned", category: "Ethics & conduct", evidenceCount: 1, expiresAt: daysAhead(90), classification: "CONFIDENTIAL" },
    { id: "VEIL-3C9D77B2E8", title: "Unapproved cloud spending spike", priority: "MEDIUM", status: "Needs triage", updatedAt: daysAgo(2.5), reporterLabel: "R-877", progress: 20, assigned: "p.raman", category: "Fraud & finance", evidenceCount: 4, expiresAt: daysAhead(80), classification: "UNCLASSIFIED" },
    { id: "VEIL-6A11E84F2B", title: "Data handling outside approved tooling", priority: "LOW", status: "Awaiting evidence", updatedAt: daysAgo(6), reporterLabel: "R-835", progress: 5, assigned: "Unassigned", category: "Security & safety", evidenceCount: 0, expiresAt: daysAhead(86), classification: "UNCLASSIFIED" },
    { id: "VEIL-4E8C12A0D9", title: "Travel expense double claims, EU region", priority: "MEDIUM", status: "Resolved", updatedAt: daysAgo(4), reporterLabel: "R-811", progress: 100, assigned: "d.voelker", category: "Fraud & finance", evidenceCount: 6, expiresAt: daysAhead(0), classification: "CONFIDENTIAL" },
    { id: "VEIL-1B6D3F97C0", title: "Stale device inventory entry", priority: "LOW", status: "Resolved", updatedAt: daysAgo(8), reporterLabel: "R-802", progress: 100, assigned: "Case Team Delta", category: "Security & safety", evidenceCount: 2, expiresAt: daysAhead(0), classification: "UNCLASSIFIED" },
  ];

  const metrics = {
    activeCases: 8,
    newThisWeek: 4,
    awaitingEvidence: 3,
    critical: 2,
    avgResponse: "6h",
    keyRotations: 14,
  };

  return { evidence, reporters, caseDetails, timeline, thread, messagesReceived, investigators, audit, criticalCases, pendingCases, metrics };
})();
