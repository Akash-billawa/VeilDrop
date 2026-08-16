# VeilDrop — Project Roadmap & Progress

**Post-Quantum-Ready Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform**

Last updated: 2026-08-16

---

## 1. What This Project Is

VeilDrop lets anonymous reporters submit sensitive reports and evidence that are **encrypted in the browser before they ever reach the server**, with keys separated from ciphertext. Investigators authenticate via passkeys/WebAuthn and decrypt only what they're assigned. Crypto targets HPKE (DHKEM-X25519 + HKDF-SHA-256 + AES-256-GCM) today, with a registered post-quantum hybrid (ML-KEM-768 + X25519, V2) that is gated on browser ML-KEM support.

- **Backend:** FastAPI + PostgreSQL (asyncpg), RLS-enabled schema
- **Frontend:** Vanilla JS SPA (hash router), Web Crypto API, no frameworks, no build tooling
- **Source of truth docs:** `ARCHITECTURE.md` (threat model + crypto + 12 phases) and `frontend/README.md` (design system + page inventory)

---

## 2. Progress by Phase (from ARCHITECTURE.md §23)

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation — architecture, schema, project structure, config | ✅ Done |
| 2 | Cryptographic Core — AES-256-GCM, HKDF, HPKE, Ed25519, versioned provider, test vectors | ✅ Done |
| 3 | Anonymous Reporter — case creation, reporter frontend, client-side crypto, receipts | ✅ Done (live E2E verified) |
| 4 | Investigator Identity — WebAuthn creds, Argon2id fallback, sessions, RBAC | ✅ Mostly done |
| 5 | Recipient Envelopes — investigator HPKE keys, envelope create/retrieve, client decrypt | ✅ Done |
| 6 | Evidence — chunked client encryption, content-addressed upload, secure retrieval | ✅ Done |
| 7 | Database Defense — RLS policies, least-privilege roles | ✅ RLS enabled on core tables; streaming standby (WAL) provisioned with slot, health check + failover scripts, end-to-end `-m replication` tests |
| 8 | Advanced Security — burn-on-read, signed receipts, case expiration, audit log | ✅ Done |
| 9 | Security Hardening — CSP, security headers, rate limiting, middleware | ✅ SRI hashes, pinned deps, SAST/CI (ruff/mypy/bandit/pip-audit/pytest in `.github/workflows/ci.yml`) |
| 10 | Post-Quantum Extension — ML-KEM hybrid HPKE | ✅ `CryptoVersion.V2` hybrid (ML-KEM-768 + X25519, dual-KEM combiner) registered, engine + dispatch + tests; inactive by default — client seal gated on browser ML-KEM |
| 11 | Verification — threat-model tests, concurrency tests, vectors, performance | ✅ Spec KATs (RFC 5869 HKDF, NIST AES-256-GCM), concurrent burn-on-read (10×N, exactly 1 win), `-m perf` benchmarks |
| 12 | Production Readiness — WCAG 2.2 AA, observability, backups, ops docs | ✅ Static WCAG 2.2 AA audit (`frontend/tests/wcag-audit.cjs`, 0 failures) + dynamic real-browser audit (`frontend/tests/wcag-dynamic-audit.py`, 66/0/0, CI-wired), JSON structured logging + request log middleware, Prometheus `/metrics` (token-gated) + alerting rules, `docs/ops.md`, `scripts/backup.ps1` (encrypted `pg_dump`) + `scripts/backup-schedule.ps1` (scheduled task, DPAPI passphrase) + passed restore drill |

**Stage 2 (public website)** — 6-page marketing site (Home, About, Security, Features, FAQ, Contact) with shared nav/footer, scroll-reveal, testimonial carousel, FAQ accordion, contact form. Spec: `docs/superpowers/specs/2026-08-06-stage2-public-website-design.md`. ✅ Done.

---

## 3. What Exists (key files)

### Backend — `backend/app/`
- `main.py` — FastAPI app, middleware, health check, serves frontend at `/`
- `config.py` — env-driven settings (.env in `backend/`)
- `database.py` — schema: `cases`, `encrypted_messages`, `encrypted_evidence`, `investigators`, `webauthn_credentials`, `investigator_keys`, `case_envelopes`, `case_assignments`, `security_events`, `signed_receipts`, `receipt_keys`, `investigator_sessions`, `rate_limit_buckets` + RLS
- `crypto/` — `aes_gcm.py`, `hpke.py`, `hybrid_kem.py` (ML-KEM-768 + X25519 V2), `kdf.py`, `signing.py`, `provider.py` (versioned `AlgorithmSuite` V1 + V2)
- `routers/` — `reporter.py`, `investigator.py`, `admin.py`
- `services/` — `case`, `message`, `evidence`, `envelope`, `receipt`, `audit`, `auth`
- `middleware/` — `security.py` (headers, correlation), `rate_limit.py`, `logging.py` (JSON formatter + request log)
- `tests/` — authz, burn, crypto, database, expiration, hybrid_kem, observability, perf, protocol, receipt, spec_vectors, sri, vectors

### Frontend — `frontend/`
- `css/` — `tokens.css` (design tokens), `base.css`, `components.css`, `pages.css`, `site.css`
- `js/` — `router.js`, `main.js`, `crypto.js`, `mock-data.js`, `theme.js`, `ui.js`, `reporter.js` (~71 KB), `investigator.js` (~50 KB), `site.js` (~58 KB, public site)
- `tests/` — `crypto.test.cjs`, `gen-vectors.cjs`, `wcag-audit.cjs` (static WCAG 2.2 AA audit, exit 0)

### Docs
- `ARCHITECTURE.md` — full security architecture + threat model + 12-phase roadmap
- `docs/ops.md` — backups/restore, key lifecycle, env vars, observability, deploy + incident checklist
- `frontend/README.md` — frontend master spec (design system, tokens, page inventory)
- `docs/superpowers/specs/2026-08-06-stage2-public-website-design.md` — Stage 2 website spec (approved)
- `VeilDrop Premium UI-UX Master Prompt.pdf` — UI/UX master prompt
- `scripts/backup.ps1` — timestamped, GPG-AES256-encrypted `pg_dump` + SHA-256 manifest + retention
- `scripts/backup-schedule.ps1` — registers the scheduled backup task; passphrase stored DPAPI-encrypted (owner-only ACL)

---

## 4. Recent Work — UI Audit (2026-08-09 → 2026-08-12)

- **Security hardening (Phase 9 ✅):** SRI sha384 hashes + `crossorigin` on all CSS/JS in `frontend/index.html` (validated by `backend/tests/test_sri.py`); deps pinned to exact `==` in `requirements.txt` / `pyproject.toml` / `requirements-dev.txt`; SAST/CI added (`.github/workflows/ci.yml` runs ruff check/format, mypy, bandit, pip-audit, pytest against a postgres:16 service, plus frontend node checks and vector tests). `ruff check`, `ruff format --check`, `mypy app`, and `bandit -r app` are all clean.
- **Phase 11 Verification ✅:** spec known-answer vectors (`test_spec_vectors.py` — RFC 5869 HKDF-SHA-256 cases 1–2, NIST AES-256-GCM, cross-checked against OpenSSL), concurrent burn-on-read already covered in `test_burn.py`, and `-m perf` benchmark smoke tests (`test_perf.py`) with loose thresholds.
- **Phase 10 Post-Quantum ✅ (gated):** `CryptoVersion.V2_HYBRID_MLKEM768_X25519` — `app/crypto/hybrid_kem.py` implements X25519 + ML-KEM-768 with a dual-KEM concatenation-then-hash combiner (ARCHITECTURE.md §21). Registered in `SUITES`, `crypto_versions` table (V2 inactive), and `CryptoProvider` dispatch with explicit `version=` routing. 15 tests in `test_hybrid_kem.py` (roundtrip, wrong recipient, tamper/truncation, cross-version isolation, metadata). Client-side seal for V2 is deferred until browsers expose ML-KEM in WebCrypto.
- **Phase 7 replication ✅:** streaming standby supported end-to-end — `scripts/replica.ps1` (Windows provisioning via `pg_basebackup -C -S <slot> -R`), `scripts/ci-replication-setup.sh` + `-m replication` pytest suite (topology, streaming+slot, WAL replay, read-only standby, promotion), `scripts/replication-check.ps1` (exit-code health check), `scripts/promote.ps1` (failover runbook in `docs/ops.md` §2a). Live-verified locally against PostgreSQL 17 pair (5/5 tests, check HEALTHY).
- **Fixed CSP cross-origin bug:** `reporter.js` / `investigator.js` hardcoded `const API='http://localhost:8000'` while the app is served on `127.0.0.1:8000`; CSP `connect-src 'self'` blocked it. Changed both to `const API=''` (same-origin). Live report submissions now work end-to-end (no "Vault unavailable — demo case" fallback).
- **Phase 12 observability ✅:** `app/middleware/logging.py` — `JsonFormatter` (one JSON object per record; only allowlisted extras) + `RequestLogMiddleware` (method/path/status/duration/correlation per request). `CorrelationMiddleware` sets `request.state.correlation_id`; order is RequestLog → Correlation → SecurityHeaders. `VEILDROP_LOG_FORMAT=json` enables it; live-smoke-tested on `/health` (structured startup + request logs, correlation id echoed). `config.py` gained `log_format`.
- **Phase 12 ops ✅:** `docs/ops.md` (env reference, pg_dump restore procedure, what else must be backed up, key rotation, deploy checklist, incident table) + `scripts/backup.ps1` (GPG-AES256-encrypted timestamped `pg_dump -Fc`, SHA-256 manifest, retention pruning, SecureString passphrase, never writes passphrase to disk).
- **Phase 12 WCAG ✅:** `frontend/tests/wcag-audit.cjs` — zero-dependency static WCAG 2.2 AA audit; theme leaks fixed (`parseTheme` explicit selector, comments stripped before matching), text vs graphical contrast classified separately (1.4.11). Muted-text contrast raised in both themes (`--text-muted` light `#646870`, dark `#8d93a0`) → **PASS 77 / WARN 23 / FAIL 0**; tokens.css SRI hash regenerated and verified by `test_sri.py`. Added to CI.
- **Fixed `/access` demo hint:** hint showed truncated recovery secret so users could never unlock; now interpolates `window.VeilMock.reporters.CASE_ID` and `.recovery`.
- **Fixed site shell bugs:** mobile nav backdrop appended to `document.body` (backdrop-filter made `.site-nav` the containing block), footer Privacy→`#/security` / Terms→`#/faq` redirects, `[id]{scroll-margin-top}` for sticky-nav offset.
- **Confirmed non-bugs (by design):** metric styles, wizard stepper dots offscreen on `/submit|mobile` (internally scrollable), `#continue-case` disabled until `#creds-confirm` checked, evidence confirm reset on edit→stage2.
- **Responsive verification:** desktop / tablet / mobile screenshots (e.g. `landing-desktop-responsive.png`, `landing-mobile-responsive.png`) and laptop-hero/CTA/section screenshots at 1366 px; master landing v2 built (`master-landing-desktop-v2.png`).

- **Fixed intermittent 500 on case creation (root cause of "Vault unavailable — demo case"):** `backend/app/middleware/rate_limit.py` `_cleanup` ran `DELETE FROM rate_limit_buckets WHERE window_start < now() - $1` with an untyped Python `timedelta` param; Postgres inferred `now() - $1` as `timestamptz - timestamptz = interval`, then `timestamptz < interval` threw `UndefinedFunctionError` → 500. Since cleanup runs once per 60 s, the **first rate-limited request in every minute window** 500'd, so live reporter submissions intermittently fell back to the client-side demo case (`VEIL-77D913D6E815`). Fixed with explicit `$1::interval` cast; verified by hammering the endpoint across three consecutive 60 s windows (all 200, no errors) and the full live loop (reporter create → admin login/assign → investigator list). Note: `rate_limit_case_per_min` default is 5/min per IP; a 429 also triggers the demo fallback.
- **Admin case list + "Assign to me" for security_admin:** Added `GET /api/v1/admin/cases` endpoint (returns all cases with `is_assigned` / `permission` / `assignment_count` per investigator); added `list_all_cases()` in `case.py` service. Investigator UI (`investigator.js`) now fetches all cases for `security_admin` instead of only assigned ones, adds an **"Unassigned" tab**, and shows an **"Assign to me"** button on unassigned rows (wired to `POST /api/v1/admin/assignments`). Regenerated investigator.js SRI hash (`v=13`).
- **Investigator decryption + message composer (full E2E loop):** On assignment, the admin endpoint now **auto-copies the reporter's wrapped DEK** into an investigator envelope (same algorithm, same wrapped key — demo shortcut for key distribution). Investigator conversation tab now shows a **recovery-secret unlock input** that derives KEK → unwraps DEK → decrypts all messages client-side (via `C.deriveKek` / `C.unwrapDek` / `C.decryptObject`). Once unlocked, the **message composer** encrypts replies client-side (AES-256-GCM via `C.encryptObject`) and POSTs them as Form data. Burn-on-read messages can be revealed and consumed in-browser. Investigator `POST /cases/{id}/messages` endpoint changed from query params to **Form body** (consistent with reporter endpoint). Regenerated investigator.js SRI hash (`v=15`). Full E2E verified: reporter submit → admin assign (auto-envelope) → investigator unlock + decrypt → investigator reply → reporter sees both messages.

### Verification suites (all green unless noted)
| Suite | Result |
|---|---|
| `wizard_probe.py` | 50/50 |
| `stage2_browser_probe.py` | 22 ok |
| `func_probe.py` | passed |
| `geom_audit.py` | 12/12 |
| `app_audit.py` | 19/25 (6 flags = known `/submit|mobile` wizard-dot design) |
| `verify-all.cjs` | 9/9 |
| `node --check` (all JS) | parse ok |
| `site.js` self-check | 4/4 |
| Backend pytest (`backend/tests/`) | green — authz, burn, crypto, database, expiration, hybrid_kem, observability, perf (`-m perf`), protocol, receipt, spec_vectors, sri, vectors, prometheus_rules (`100 passed` full suite) |
| `pytest -m replication` | 5/5 green against a live primary+standby pair (CI: `scripts/ci-replication-setup.sh`) |
| `frontend/tests/wcag-audit.cjs` | PASS 84 / WARN 0 / FAIL 0 (exit 0) |
| `frontend/tests/wcag-dynamic-audit.py` | PASS 66 / WARN 0 / FAIL 0 — real Chromium: tab order + focus indicators on all 9 views, skip link, FAQ accordion ARIA, contact-form error identification + live regions, reduced-motion clamp, 320px reflow (CI: backend job) |
| `backend/tests/test_sri.py` | green — all assets pinned via SRI |
| `backend/tests/test_prometheus_rules.py` | 4/4 — alerting rules reference only families that exist in `metrics.py`, valid severities/durations, balanced parens |
| `scripts/backup-schedule.ps1` + restore drill | registered/unregistered a scheduled task with DPAPI passphrase blob (owner-only ACL, roundtrip verified); full drill passed: seed → `backup.ps1` → gpg decrypt → `pg_restore` into scratch PG 17 → byte-for-byte content match → teardown |
| `python -m ruff check` / `mypy app` / `bandit -r app` | clean |

---

## 5. What's Next

1. **Frontend ML-KEM (Phase 10 follow-up)** — switch reporter/investigator to V2 hybrid envelopes once browsers expose ML-KEM in WebCrypto; update `frontend/js/crypto.js` + regenerate cross-language vectors, then flip `crypto_versions` V2 to active.
2. **Dynamic WCAG verification** — DONE: `frontend/tests/wcag-dynamic-audit.py` (Playwright) automates the static audit's manual items — 2.4.3/2.4.7 tab order + visible focus per view, 2.4.1 skip link, 4.1.2 FAQ accordion `aria-expanded`, 3.3.1/3.3.2/4.1.3 contact-form errors + live regions, 2.3.3 reduced-motion clamp, 1.4.10 reflow at 320px; PASS 66/0/0. Fixed along the way: `<nav>` landmarks on the submit/access/login/case shells (was `div.nav-actions`), heading-level skips (footer columns h4→h3, "Still curious?"/"Send a message" h3→h2). Wired into CI (playwright pinned in `requirements-dev.txt`).
3. **Metrics endpoint** — DONE: Prometheus `/metrics` behind `VEILDROP_METRICS_TOKEN` (404 when unset) with `veildrop_http_requests_total` + duration histogram; `deploy/prometheus/alerting.rules.yml` (p99 > 2s, 5xx ratio > 5%, 401 spike, no-traffic) validated by `backend/tests/test_prometheus_rules.py` and documented in `docs/ops.md` §3.
4. **Backup scheduling** — DONE: `scripts/backup-schedule.ps1` registers a scheduled task running `scripts/backup.ps1` with the passphrase persisted as a DPAPI blob (owner-only ACL, never plaintext); restore drill passed end-to-end against a scratch PG 17 (seed → encrypted backup → gpg decrypt → `pg_restore` → byte-for-byte match → teardown). Runbook in `docs/ops.md` §2.
5. **Platform choices** (to be confirmed): CI/CD provider, deployment target, real WebAuthn provider config, receipt key management.

---

## 6. Known Open Items / Decisions

- App is served from `C:\DataSecure\backend` via uvicorn on `127.0.0.1:8000`; frontend mounted same-origin.
- `.env` holds session secret + receipt key paths (dev); production secrets/rotation not yet set up.
- `app_audit.py` flags 6 items all traced to the intentional `/submit|mobile` wizard-dot design.
- Post-quantum ML-KEM V2 is registered but inactive — client seal waits for browser ML-KEM in WebCrypto.
- Scheduled backup task is registered per-machine (`backup-schedule.ps1`) but not yet run on a real deployment; production Prometheus + Alertmanager wiring still to be stood up.
