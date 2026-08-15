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
| `VEILDROP_CORS_ORIGINS` | `*` | Restrict in production |

Production minimums: strong `VEILDROP_SESSION_SECRET`, restricted `CORS_ORIGINS`,
TLS in front of uvicorn, `VEILDROP_LOG_FORMAT=json`.

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
written to disk.

### Restore

```powershell
gpg -d backups/veildrop-YYYYMMDD.dump.gpg | Out-File -Encoding byte veildrop-YYYYMMDD.dump
pg_restore -h localhost -U veildrop -d veildrop --clean --if-exists veildrop-YYYYMMDD.dump
```

Restore order after a fresh DB: create role `veildrop` → restore dump → verify
schema via `python -m pytest` (the suite bootstraps missing schema on startup).

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

Suggested alerts: p99 `duration_seconds` > 2s; 5xx share of
`requests_total` > 1%.

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
- [ ] `VEILDROP_CORS_ORIGINS` restricted to the real origin
- [ ] TLS termination in front of uvicorn (HSTS is already set by middleware)
- [ ] `VEILDROP_LOG_FORMAT=json` and logs shipped to an aggregator
- [ ] `VEILDROP_METRICS_TOKEN` set and `/metrics` reachable only from the scraper
- [ ] `pip install -r backend/requirements-dev.txt` passed in CI
- [ ] Backups running on schedule (see §2) and a restore drill passed
- [ ] `node frontend/tests/wcag-audit.cjs` and SRI test pass for the served assets

## 6. Incident response summary

| Signal | Likely cause | First action |
|---|---|---|
| 5xx spike in logs | DB pool exhausted / upstream | Check `command_timeout`, pool size |
| Slow request log (`duration_ms` high) | Large evidence decrypt/re-encrypt | Chunk size / network |
| `pip-audit` failure in CI | Vulnerable dependency | Pin the fixed version, redeploy |
| Expired case visible | `expire_stale_cases` not running | Trigger startup job or cron |
