# VeilDrop

Post-quantum-ready zero-knowledge anonymous reporting and secure evidence exchange platform.

All sensitive content is encrypted in the browser before transmission. The server stores only ciphertext. Investigators decrypt content client-side after authenticating via WebAuthn passkeys.

## Features

- **Client-side encryption** — AES-256-GCM + HKDF + HPKE envelope protocol; keys never leave the browser
- **Zero-knowledge server** — database stores only ciphertext and wrapped keys; server cannot read reports
- **Anonymous reporting** — reporters access cases via Case ID + 256-bit Recovery Secret, no account required
- **WebAuthn / passkey authentication** — investigators authenticate with biometrics or hardware keys
- **Burn-on-read** — messages self-destruct after viewing
- **Signed receipts** — Ed25519-signed audit trail for every submission
- **Post-quantum ready** — ML-KEM-768 + X25519 hybrid HPKE registered, activated when browser support lands
- **WCAG 2.2 AA** — full accessibility compliance (84/0/0 static audit, 66/0/0 dynamic audit)
- **Row-Level Security** — PostgreSQL RLS policies enforce per-role data access at the database layer
- **Streaming replication** — WAL-based primary + standby with automated failover scripts

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+ / FastAPI 0.141 / asyncpg |
| Database | PostgreSQL 16 with Row-Level Security |
| Frontend | Vanilla JavaScript SPA (no frameworks, no build step) |
| Crypto | Web Crypto API — AES-256-GCM, HKDF, X25519, Ed25519, HPKE |
| CSS | Custom design system with tokens, light/dark theme |
| CI | GitHub Actions — ruff, mypy, bandit, pip-audit, pytest, Playwright WCAG |

## Getting Started

### Prerequisites

- Python 3.11+
- PostgreSQL 16+
- Node.js 22+ (for frontend tests only)

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
VEILDROP_DATABASE_URL=postgresql://veildrop:veildrop@localhost:5432/veildrop
VEILDROP_SESSION_SECRET=<random-64-char-hex>
```

Initialize the database and start the server:

```bash
python -c "import asyncio; from app.database import create_pool, init_db; asyncio.run(init_db(asyncio.run(create_pool())))"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The app is available at `http://127.0.0.1:8000`.

### Reporter Flow

1. Open the app and submit a report — title and body are encrypted in the browser before upload
2. Receive a Case ID and 256-bit Recovery Secret — store these securely
3. Use the Case ID to send follow-up messages or evidence

### Investigator Flow

1. Register a passkey (WebAuthn) or use Argon2id credentials
2. An admin assigns cases via `POST /api/v1/admin/assignments`
3. Enter your Recovery Secret to derive decryption keys and read encrypted messages

### Admin Setup

Default admin credentials (change in production):

```
username: admin
password: VeilDrop-Cb6Z4uYXAQ!x9
role: security_admin
```

## Running Tests

```bash
# Backend tests (100+ tests)
cd backend
python -m pytest -q

# Replication tests (requires primary + standby on 55432/55433)
python -m pytest -q -m replication

# Frontend crypto tests
cd frontend
node tests/crypto.test.cjs

# WCAG audit
node tests/wcag-audit.cjs
```

## Project Structure

```
VeilDrop/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, middleware, health/metrics
│   │   ├── config.py            # Env-driven settings
│   │   ├── database.py          # Schema (12+ tables with RLS), connection pool
│   │   ├── crypto/              # AES-GCM, HPKE, HKDF, Ed25519, hybrid KEM
│   │   ├── routers/             # reporter, investigator, admin endpoints
│   │   ├── services/            # auth, case, envelope, evidence, message, receipt
│   │   └── middleware/          # logging, rate limiting, security headers
│   ├── tests/                   # 100+ tests (crypto, auth, replication, SRI, WCAG)
│   └── requirements.txt
├── frontend/
│   ├── index.html               # SPA shell with SRI-hashed assets
│   ├── js/                      # crypto, reporter, investigator, router, UI
│   ├── css/                     # design tokens, base, components, pages
│   └── tests/                   # crypto vectors, WCAG audit
├── scripts/                     # backup, replication, failover (PowerShell + bash)
├── deploy/                      # Prometheus alerting rules
├── .github/workflows/ci.yml    # CI: SAST + tests + replication + WCAG
├── ARCHITECTURE.md              # Security architecture and threat model
└── ROADMAP.md                   # Implementation progress
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full security architecture, threat model, and cryptographic design.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for implementation status across all 12 phases.

## License

Private — All rights reserved.
