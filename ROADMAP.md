# VeilDrop — Project Roadmap & Progress

**Post-Quantum-Ready Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform**

Last updated: 2026-08-13

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
| 7 | Database Defense — RLS policies, least-privilege roles | ✅ RLS enabled on core tables |
| 8 | Advanced Security — burn-on-read, signed receipts, case expiration, audit log | ✅ Done |
| 9 | Security Hardening — CSP, security headers, rate limiting, middleware | ✅ SRI hashes, pinned deps, SAST/CI (ruff/mypy/bandit/pip-audit/pytest in `.github/workflows/ci.yml`) |
| 10 | Post-Quantum Extension — ML-KEM hybrid HPKE | ✅ `CryptoVersion.V2` hybrid (ML-KEM-768 + X25519, dual-KEM combiner) registered, engine + dispatch + tests; inactive by default — client seal gated on browser ML-KEM |
| 11 | Verification — threat-model tests, concurrency tests, vectors, performance | ✅ Spec KATs (RFC 5869 HKDF, NIST AES-256-GCM), concurrent burn-on-read (10×N, exactly 1 win), `-m perf` benchmarks |
| 12 | Production Readiness — WCAG 2.2 AA, observability, backups, ops docs | ✅ Static WCAG 2.2 AA audit (`frontend/tests/wcag-audit.cjs`, 0 failures — muted-text contrast fixed in both themes), JSON structured logging + request log middleware, `docs/ops.md`, `scripts/backup.ps1` (encrypted `pg_dump`) |

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

---

## 4. Recent Work — UI Audit (2026-08-09 → 2026-08-12)

- **Security hardening (Phase 9 ✅):** SRI sha384 hashes + `crossorigin` on all CSS/JS in `frontend/index.html` (validated by `backend/tests/test_sri.py`); deps pinned to exact `==` in `requirements.txt` / `pyproject.toml` / `requirements-dev.txt`; SAST/CI added (`.github/workflows/ci.yml` runs ruff check/format, mypy, bandit, pip-audit, pytest against a postgres:16 service, plus frontend node checks and vector tests). `ruff check`, `ruff format --check`, `mypy app`, and `bandit -r app` are all clean.
- **Phase 11 Verification ✅:** spec known-answer vectors (`test_spec_vectors.py` — RFC 5869 HKDF-SHA-256 cases 1–2, NIST AES-256-GCM, cross-checked against OpenSSL), concurrent burn-on-read already covered in `test_burn.py`, and `-m perf` benchmark smoke tests (`test_perf.py`) with loose thresholds.
- **Phase 10 Post-Quantum ✅ (gated):** `CryptoVersion.V2_HYBRID_MLKEM768_X25519` — `app/crypto/hybrid_kem.py` implements X25519 + ML-KEM-768 with a dual-KEM concatenation-then-hash combiner (ARCHITECTURE.md §21). Registered in `SUITES`, `crypto_versions` table (V2 inactive), and `CryptoProvider` dispatch with explicit `version=` routing. 15 tests in `test_hybrid_kem.py` (roundtrip, wrong recipient, tamper/truncation, cross-version isolation, metadata). Client-side seal for V2 is deferred until browsers expose ML-KEM in WebCrypto.
- **Fixed CSP cross-origin bug:** `reporter.js` / `investigator.js` hardcoded `const API='http://localhost:8000'` while the app is served on `127.0.0.1:8000`; CSP `connect-src 'self'` blocked it. Changed both to `const API=''` (same-origin). Live report submissions now work end-to-end (no "Vault unavailable — demo case" fallback).
- **Phase 12 observability ✅:** `app/middleware/logging.py` — `JsonFormatter` (one JSON object per record; only allowlisted extras) + `RequestLogMiddleware` (method/path/status/duration/correlation per request). `CorrelationMiddleware` sets `request.state.correlation_id`; order is RequestLog → Correlation → SecurityHeaders. `VEILDROP_LOG_FORMAT=json` enables it; live-smoke-tested on `/health` (structured startup + request logs, correlation id echoed). `config.py` gained `log_format`.
- **Phase 12 ops ✅:** `docs/ops.md` (env reference, pg_dump restore procedure, what else must be backed up, key rotation, deploy checklist, incident table) + `scripts/backup.ps1` (GPG-AES256-encrypted timestamped `pg_dump -Fc`, SHA-256 manifest, retention pruning, SecureString passphrase, never writes passphrase to disk).
- **Phase 12 WCAG ✅:** `frontend/tests/wcag-audit.cjs` — zero-dependency static WCAG 2.2 AA audit; theme leaks fixed (`parseTheme` explicit selector, comments stripped before matching), text vs graphical contrast classified separately (1.4.11). Muted-text contrast raised in both themes (`--text-muted` light `#646870`, dark `#8d93a0`) → **PASS 77 / WARN 23 / FAIL 0**; tokens.css SRI hash regenerated and verified by `test_sri.py`. Added to CI.
- **Fixed `/access` demo hint:** hint showed truncated recovery secret so users could never unlock; now interpolates `window.VeilMock.reporters.CASE_ID` and `.recovery`.
- **Fixed site shell bugs:** mobile nav backdrop appended to `document.body` (backdrop-filter made `.site-nav` the containing block), footer Privacy→`#/security` / Terms→`#/faq` redirects, `[id]{scroll-margin-top}` for sticky-nav offset.
- **Confirmed non-bugs (by design):** metric styles, wizard stepper dots offscreen on `/submit|mobile` (internally scrollable), `#continue-case` disabled until `#creds-confirm` checked, evidence confirm reset on edit→stage2.
- **Responsive verification:** desktop / tablet / mobile screenshots (e.g. `landing-desktop-responsive.png`, `landing-mobile-responsive.png`) and laptop-hero/CTA/section screenshots at 1366 px; master landing v2 built (`master-landing-desktop-v2.png`).

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
| Backend pytest (`backend/tests/`) | green — authz, burn, crypto, database, expiration, hybrid_kem, observability, perf (`-m perf`), protocol, receipt, spec_vectors, sri, vectors (`81 passed` full suite) |
| `frontend/tests/wcag-audit.cjs` | PASS 77 / WARN 23 / FAIL 0 (exit 0) |
| `backend/tests/test_sri.py` | green — all assets pinned via SRI |
| `python -m ruff check` / `mypy app` / `bandit -r app` | clean |

---

## 5. What's Next

1. **Frontend ML-KEM (Phase 10 follow-up)** — switch reporter/investigator to V2 hybrid envelopes once browsers expose ML-KEM in WebCrypto; update `frontend/js/crypto.js` + regenerate cross-language vectors, then flip `crypto_versions` V2 to active.
2. **Dynamic WCAG verification** — browser-driven checks (focus order, live-region announcements, reduced-motion behavior) beyond the static audit; currently listed as manual items in the audit output.
3. **Metrics endpoint** — Prometheus `/metrics` (or OpenTelemetry export) now that request logs capture `duration_ms`; alert on p99 and 5xx rate.
4. **Backup scheduling** — wire `scripts/backup.ps1` into a scheduled task/cron and complete a restore drill against a scratch DB.
5. **Platform choices** (to be confirmed): CI/CD provider, deployment target, real WebAuthn provider config, receipt key management.

---

## 6. Known Open Items / Decisions

- App is served from `C:\DataSecure\backend` via uvicorn on `127.0.0.1:8000`; frontend mounted same-origin.
- `.env` holds session secret + receipt key paths (dev); production secrets/rotation not yet set up.
- `app_audit.py` flags 6 items all traced to the intentional `/submit|mobile` wizard-dot design.
- Post-quantum ML-KEM V2 is registered but inactive — client seal waits for browser ML-KEM in WebCrypto.
- Observability is log-only: no metrics endpoint yet, and backup script exists but isn't scheduled.
