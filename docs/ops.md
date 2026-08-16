# VeilDrop Operations

Backup / restore, key management, deployment, and observability for VeilDrop.
This is the operational companion to `ARCHITECTURE.md` (threat model + crypto)
and `ROADMAP.md` (status).

## 1. Environment

All configuration is env-driven via `backend/.env` (see `app/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `VEILDROP_HOST` / `VEILDROP_PORT` | `127.0.0.1` / `8000` | Bind address |
| `VEILDROP_DATABASE_URL` | `postgresql://veildrop:veildrop@localhost:5432/veildrop` | App DB role (table owner) |
| `VEILDROP_POSTGRES_ADMIN_URL` | — | Superuser URL used by RLS tests and ops tooling |
| `VEILDROP_SESSION_SECRET` | — (required in prod) | Session signing secret; **rotate on incident** |
| `VEILDROP_CRYPTO_VERSION` | `1` | Active crypto suite (`1` = HPKE-X25519, `2` = hybrid ML-KEM registered/inactive) |
| `VEILDROP_LOG_LEVEL` / `VEILDROP_LOG_FORMAT` | `INFO` / `text` | Set `VEILDROP_LOG_FORMAT=json` for structured logs |
| `VEILDROP_METRICS_TOKEN` | — (endpoint disabled) | Bearer token for `GET /metrics`; unset ⇒ 404 |
| `VEILDROP_DEFAULT_TTL_DAYS` / `VEILDROP_MAX_TTL_DAYS` | `30` / `90` | Case retention |
| `VEILDROP_UPLOAD_DIR` | `data/uploads` | Encrypted evidence blobs (server-side ciphertext) |
| `VEILDROP_CORS_ORIGINS` | — (empty ⇒ CORS off) | Exact origins, comma-separated. `*` makes the app refuse to start |

Production minimums: strong `VEILDROP_SESSION_SECRET`, `VEILDROP_CORS_ORIGINS`
left empty (the SPA is same-origin) or set to exact origins, TLS in front of
uvicorn, `VEILDROP_LOG_FORMAT=json`.

The API is credentialed, so `VEILDROP_CORS_ORIGINS=*` is rejected at startup:
a wildcard plus credentials would let any website issue authenticated requests
on a logged-in investigator's behalf. CORS middleware is only mounted when at
least one origin is configured.

## 2. Database backups

VeilDrop's confidentiality model keeps plaintext out of the DB: rows hold
ciphertext, nonces, tags, wrapped keys, and metadata. A backup of the database
**alone** is therefore not a plaintext leak, but it must still be protected
because it enables decryption *with the corresponding keys* and is needed for
restore.

### Backup (PostgreSQL logical dump)

```powershell
# One-shot
$env:PGPASSWORD="veildrop"
pg_dump -h localhost -U veildrop -d veildrop -Fc -f veildrop-$(Get-Date -Format yyyyMMdd).dump

# Or use the wrapper (writes encrypted, timestamped dumps under backups/)
.\scripts\backup.ps1 -OutDir .\backups -Passphrase (Read-Host -AsSecureString)
```

`scripts/backup.ps1` does: `pg_dump -Fc` → `gpg -c` (AES-256) → hashes the
encrypted file with SHA-256 → writes a manifest. The passphrase is never
written to disk: it is taken from `-Passphrase`, loaded from a
DPAPI-encrypted `-PassphraseFile` (see below), or prompted. Old dumps are
pruned (`-Keep`, default 14).

### Scheduled backups

```powershell
# Persists the passphrase DPAPI-encrypted (owner-only ACL) and registers a
# daily 02:00 task "VeilDrop Backup" that runs backup.ps1 with -PassphraseFile.
.\scripts\backup-schedule.ps1 -OutDir D:\veildrop-backups -DatabaseUrl "postgresql://veildrop:***@db:5432/veildrop"
.\scripts\backup-schedule.ps1 -Unregister          # remove the task
```

The task runs only while the registering user is logged on (`Interactive`
logon). On a server, register the task under the service account instead.
The passphrase blob lives in `%ProgramData%\VeilDrop\backup-passphrase.bin`
with an ACL granting only the current user and SYSTEM — never move that file
to a machine/account that needs to decrypt a different passphrase, and treat
it with the same care as the passphrase itself.

### Restore

```powershell
gpg -d backups/veildrop-YYYYMMDD.dump.gpg | Out-File -Encoding byte veildrop-YYYYMMDD.dump
pg_restore -h localhost -U veildrop -d veildrop --clean --if-exists veildrop-YYYYMMDD.dump
```

Restore order after a fresh DB: create role `veildrop` → restore dump → verify
schema via `python -m pytest` (the suite bootstraps missing schema on startup).

### Restore drill

Before trusting backups, run a round-trip drill on a scratch instance:
backup a seeded database with `backup.ps1`, decrypt with the stored
passphrase, `pg_restore` into a throwaway PostgreSQL cluster, and compare
canonical content (hex-encoded, so client encodings cannot mask corruption).
The drill used during development: seed 3 rows incl. `bytea` and UTF-8 text,
verify `pg_restore` output matches byte-for-byte, then destroy the scratch
instance and drop the seeded database.

### What must ALSO be backed up

- `VEILDROP_SESSION_SECRET` (or the secrets manager entry)
- Signing/receipt key material and investigator key material referenced by the
  `*_keys` tables (export them, or keep a secondary location)
- `backend/.env`
- Recovery secrets / KEKs — **never** store plaintext; keep in a password
  manager or HSM-backed store.

### Recovery testing (Phase 12)

1. Restore the latest dump into a scratch database.
2. Run `python -m pytest` against it with `VEILDROP_DATABASE_URL` pointed there.
3. Confirm a known report decrypts end-to-end (reporter + investigator flows).

## 2a. Database replication (streaming standby)

ARCHITECTURE.md §15 calls for a PostgreSQL primary plus a WAL-streaming
read-only standby. The standby is a byte-for-byte copy of the primary kept
current by streaming WAL; it answers reads and serves as the failover target.
The application writes only to the primary.

### Provision a standby (Windows)

```powershell
# The connecting role must have the REPLICATION attribute, e.g.:
#   CREATE ROLE veildrop_repl LOGIN REPLICATION PASSWORD '<strong>';
.\scripts\replica.ps1 `
  -PrimaryUrl "postgresql://veildrop_repl:***@primary-host:5432/veildrop" `
  -StandbyDir .\replica\standby -StandbyPort 5433
```

The script runs `pg_basebackup -X stream -C -S veildrop_repl_slot -R`
(creates a physical slot, writes `standby.signal` + `primary_conninfo`),
sets the port, starts the node, and waits until the WAL sender reports
`streaming`. Re-run with `-Force` to re-sync from scratch. To survive
reboots, register it as a Windows service:

```powershell
pg_ctl register VeilDropStandby -N VeilDropStandby -D .\replica\standby -o "-p 5433"
```

### Verify

```powershell
# Health check; exit 0 = streaming + standby in recovery, exit 1 = degraded.
.\scripts\replication-check.ps1 -StandbyPort 5433
```

Sample healthy output:

```
[replcheck] primary 127.0.0.1:5432 - WAL senders:
  walreceiver      state=streaming  sync=async    replay_lag=00:00:00.000298
[replcheck] standby 127.0.0.1:5433 - in_recovery=true replay_lsn=0/3000000
[replcheck] HEALTHY: streaming, standby in recovery
```

Wire this into a scheduled task/monitoring hook; alert on exit code 1 or on
`replay_lag` growing past your RPO (replay is normally sub-millisecond).

### End-to-end tests

CI provisions a throwaway primary (55432) + standby (55433) pair and runs:

```bash
scripts/ci-replication-setup.sh     # writes the env vars for the tests
python -m pytest -m replication     # from backend/
```

Coverage: primary/standby topology, streaming state + active slot, WAL replay
(insert on primary → visible on standby), standby read-only enforcement, and
promotion (`pg_promote` flips the standby writable; a second promote errors).

### Failover runbook

1. Confirm the standby is caught up (`replication-check.ps1` shows
   `replay_lag` near zero, or `pg_last_wal_replay_lsn()` == `pg_current_wal_lsn()`
   of the dead primary).
2. Promote:

   ```powershell
   .\scripts\promote.ps1 -StandbyDir .\replica\standby -StandbyPort 5433
   ```

   `pg_ctl promote` signals the postmaster; the script waits until the node
   leaves recovery mode. Running it twice is safe (it warns and continues).
3. Point the app at the new primary: `VEILDROP_DATABASE_URL` →
   `postgresql://...@new-primary:5433/veildrop` (the schema is identical, so
   no migration is needed; app restarts are the only requirement).
4. Re-sync the old primary as the new standby:

   ```powershell
   .\scripts\replica.ps1 -PrimaryUrl "postgresql://veildrop_repl:***@new-primary:5433/veildrop" `
     -StandbyDir <old-primary-data-dir> -Force -StandbyPort <old-primary-port>
   ```
5. Re-run `replication-check.ps1` and `python -m pytest -m replication` (CI
   style) before declaring the failover complete.

Notes:

- A standby **cannot** be promoted while it is behind (it promotes whatever it
  has replayed — see step 1). Promotion is manual here; an automatic
  failover/health-check system (e.g. repmgr/Patroni) is a future platform
  choice, not a current dependency.
- Backups keep running from the primary (`backup.ps1`). In a pinch
  `pg_dump` works against the standby too (it is a consistent snapshot).
- Replication connections carry ciphertext, envelope metadata, and audit
  rows only — no plaintext keys. Still: put primary and standby on a private
  network (firewall 5432/5433 between the pair only) and prefer TLS/SSPI on
  the replication connection in production (`primary_conninfo` + `pg_hba.conf`
  `hostssl`).
- `replica.ps1` / `promote.ps1` auto-detect PostgreSQL binaries from PATH or
  `C:\Program Files\PostgreSQL\<version>\bin`.

## 3. Observability

### Structured logging

Set `VEILDROP_LOG_FORMAT=json`. Each record is one JSON object:

```json
{"ts":"2026-08-13T12:00:00.000000+00:00","level":"INFO","logger":"app.middleware.logging",
 "message":"request","correlation_id":"...","method":"POST","path":"/api/report",
 "status_code":201,"duration_ms":4.12,"client_ip":"127.0.0.1"}
```

- Every request logs `method`, `path`, `status_code`, `duration_ms`,
  `correlation_id`, `client_ip`.
- Query strings, headers, and bodies are **never** logged.
- The correlation id flows from `X-Correlation-ID` and is echoed back on the
  response header for tracing end-to-end.

### Health / readiness

- `GET /health` returns `{"status":"ok",...}`.
- Startup runs `expire_stale_cases()`; failures surface in structured logs.

### Metrics

`GET /metrics` exposes Prometheus text format (v0.0.4), in-process counters:

- `veildrop_http_requests_total{method,route,status}` — counter
- `veildrop_http_request_duration_seconds{method,route}` — histogram
  (`_bucket`/`_sum`/`_count`)

The `route` label is the **route template** (`/api/v1/cases/{case_id}`), never
the resolved path, so case IDs never become label values.

**The endpoint is disabled by default.** Set `VEILDROP_METRICS_TOKEN` to enable
it; without a token it returns 404 (an open metrics endpoint leaks route
inventory and traffic volume). The scraper must send
`Authorization: Bearer <token>`:

```yaml
scrape_configs:
  - job_name: veildrop
    metrics_path: /metrics
    authorization:
      credentials: <VEILDROP_METRICS_TOKEN>
    static_configs:
      - targets: ["127.0.0.1:8000"]
```

Counters are per-process and reset on restart — correct for scrape-based rate
calculation. If you run multiple uvicorn workers, each answers with only its own
counters; move to `prometheus_client` with a multiprocess directory first.

Alerting rules live in `deploy/prometheus/alerting.rules.yml` and are validated
by `backend/tests/test_prometheus_rules.py` (structure, severity, and that every
metric family referenced actually exists in `services/metrics.py`). Point
Prometheus at the file (`rule_files: [deploy/prometheus/alerting.rules.yml]`)
and run `promtool check rules` after editing it. Alerts:

| Alert | Condition | Severity |
|---|---|---|
| VeilDropHighP99Latency | p99 > 2s for 10m | warning |
| VeilDropHighErrorRatio | 5xx ratio > 5% for 10m | critical |
| VeilDropAuthFailureSpike | 401 ratio > 30% for 5m | warning |
| VeilDropNoTraffic | zero requests for 30m | info (silence when idle) |

## 4. Key lifecycle

- **Rotation:** rotate `VEILDROP_SESSION_SECRET` on personnel change or
  suspected exposure. Receipt signing keys: see `receipt_keys` / signing
  service; mark retired keys inactive after rotation and keep them for
  verification.
- **ML-KEM V2:** the hybrid suite (`VEILDROP_CRYPTO_VERSION=2`) is registered
  but inactive. Before activating: confirm browser WebCrypto ML-KEM support for
  the reporter flow and re-run the full test suite plus `-m perf`.
- **Never** log, store, or transmit private keys, session secrets, or recovery
  secrets in clear text outside the encrypted backup.

## 5. Deploy checklist

- [ ] `.env` has a strong, rotated `VEILDROP_SESSION_SECRET`
- [ ] `VEILDROP_CORS_ORIGINS` empty (same-origin) or exact origins — never `*`
- [ ] TLS termination in front of uvicorn (HSTS is already set by middleware)
- [ ] `VEILDROP_LOG_FORMAT=json` and logs shipped to an aggregator
- [ ] `VEILDROP_METRICS_TOKEN` set and `/metrics` reachable only from the scraper
- [ ] `pip install -r backend/requirements-dev.txt` passed in CI
- [ ] Backups running on schedule (see §2) and a restore drill passed
- [ ] Streaming standby provisioned (see §2a), `replication-check.ps1` healthy, replication tests green
- [ ] `node frontend/tests/wcag-audit.cjs`, `python frontend/tests/wcag-dynamic-audit.py` (real-browser WCAG 2.2 AA), and SRI test pass for the served assets

## 5a. Accessibility verification

Static audit (`node frontend/tests/wcag-audit.cjs`): zero-dependency scans of
`index.html`, `js/`, and the CSS token themes — contrast (1.4.3/1.4.11),
focus-visible indicator (2.4.7), skip link, target size, `<html lang>`, `<title>`,
viewport. Exit 0 only when no failures.

Dynamic audit (`python frontend/tests/wcag-dynamic-audit.py`, Playwright +
real Chromium): covers what only a browser can prove. It starts uvicorn on
`127.0.0.1:8000` if needed (add `--keep-server` to reuse a running instance) and
checks, per view:
- 2.4.3 / 2.4.7 — Tab order matches DOM order, every stop shows the focus
  ring and can be scrolled into view (9 views: home, about, security, features,
  faq, contact, submit, access, investigator login)
- 2.4.1 — skip link is the first tab stop and jumps into `#main`
- 1.3.1 — exactly one visible `h1`, no skipped heading levels, landmarks
  (`header`/`nav`/`main`/`footer` on public views, `nav`/`main` on app views)
- 4.1.2 — FAQ accordion `aria-expanded`/`aria-controls` and panel visibility
- 3.3.1 / 3.3.2 / 4.1.3 — contact form errors set `aria-invalid`, move focus to
  the first error, announce via `role="status"` toast and note
- 2.3.3 — `prefers-reduced-motion: reduce` clamps animation/transition
  durations on the landing page
- 1.4.10 — no horizontal scroll at a 320px viewport (home, submit)

Run it as a developer: `pip install playwright==1.60.0 && python -m playwright
install chromium`, then `python frontend/tests/wcag-dynamic-audit.py`. CI runs
it in the backend job after the app boots. If you edit `frontend/js/*.js` or
`frontend/css/*.css`, regenerate the SRI hashes in `index.html` (sha384-base64)
or the browser blocks the asset and every view fails to render.

## 6. Incident response summary

| Signal | Likely cause | First action |
|---|---|---|
| 5xx spike in logs | DB pool exhausted / upstream | Check `command_timeout`, pool size |
| Slow request log (`duration_ms` high) | Large evidence decrypt/re-encrypt | Chunk size / network |
| `pip-audit` failure in CI | Vulnerable dependency | Pin the fixed version, redeploy |
| Expired case visible | `expire_stale_cases` not running | Trigger startup job or cron |
| `replication-check.ps1` exits 1 | Standby lagging, disconnected, or promoted | Check slot + network; see §2a failover runbook |
