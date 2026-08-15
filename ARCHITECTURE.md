# VeilDrop Architecture

**Post-Quantum-Ready Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform**

Version: 0.1.0 — July 2026

---

## Table of Contents

1. [Security Principle](#1-security-principle)
2. [Threat Model](#2-threat-model)
3. [User Model](#3-user-model)
4. [System Architecture](#4-system-architecture)
5. [Cryptographic Architecture](#5-cryptographic-architecture)
6. [Key Hierarchy](#6-key-hierarchy)
7. [Per-Object Key Derivation](#7-per-object-key-derivation)
8. [HPKE Envelope Protocol](#8-hpke-envelope-protocol)
9. [File Encryption](#9-file-encryption)
10. [Reporter Flow](#10-reporter-flow)
11. [Investigator Authentication](#11-investigator-authentication)
12. [Investigator Authorization](#12-investigator-authorization)
13. [Signed Receipts](#13-signed-receipts)
14. [Burn-on-Read](#14-burn-on-read)
15. [Database Architecture](#15-database-architecture)
16. [Row-Level Security](#16-row-level-security)
17. [Transport Security](#17-transport-security)
18. [Browser Security](#18-browser-security)
19. [Data Retention](#19-data-retention)
20. [Audit System](#20-audit-system)
21. [Post-Quantum Extension](#21-post-quantum-extension)
22. [Security Testing](#22-security-testing)
23. [Implementation Phases](#23-implementation-phases)

---

## 1. Security Principle

> **Sensitive content is encrypted on the client before transmission, cryptographic keys are separated from encrypted content, access is continuously authorized, and compromising one infrastructure layer must not automatically expose protected information.**

### Explicit Limitation

VeilDrop cannot guarantee confidentiality when the endpoint (browser/OS) responsible for entering or displaying plaintext is fully compromised. No cryptographic algorithm can make plaintext invisible to a device that must legitimately display it.

---

## 2. Threat Model

### Protected Threats

| Threat | Expected Outcome | Primary Defense |
|--------|-----------------|-----------------|
| **Database Theft** | Ciphertext only. No report plaintext. | Client-side encryption; server never holds plaintext DEK |
| **Storage Theft** | Encrypted evidence only. Original files unrecoverable without keys. | File-level client encryption |
| **Backup Theft** | Protected ciphertext only. | Encryption key material absent from backups |
| **Malicious DBA** | Ciphertext in columns, no plaintext. | Zero-knowledge design |
| **SQL Injection** | Parameterized query binds input as literal. | Parameterized queries + least privilege + RLS |
| **Network Interception** | End-to-end encrypted content + TLS. | Client encryption + TLS 1.3 |
| **Cross-Case Access** | 403 Forbidden. | Authentication → Authorization → Assignment → RLS |
| **Ciphertext Tampering** | AES-GCM authentication failure. | Authenticated encryption with AAD |
| **Credential Phishing** | WebAuthn resists phishing. Passwords never stored plaintext. | Passkeys/WebAuthn primary; Argon2id fallback |
| **XSS** | Cannot extract keys from non-extractable CryptoKey objects. | CSP + safe rendering + no eval |
| **Long-term Quantum** | Protected by optional ML-KEM extension. | Versioned crypto provider abstraction |

### Explicitly Not Protected

- Fully compromised reporter or investigator device
- Recipient copying information after legitimate decryption
- Screen recording or photography after decryption
- Network-level deanonymization (requires Tor or similar)

---

## 3. User Model

### Reporter

- **No conventional account.** No name, email, username, password.
- Access via: **Case ID + Recovery Secret** (high-entropy, 256-bit)
- Recovery Secret never appears in URLs, logs, or server-side storage.

### Investigator

- Organizational account with role-based access.
- **Primary authentication:** WebAuthn / Passkeys
- **Controlled fallback:** Argon2id password hashing
- Roles: `investigator`, `senior_investigator`, `security_admin`

---

## 4. System Architecture

```
REPORTER BROWSER                          INVESTIGATOR BROWSER
     │                                          │
     │   Client Crypto Layer                    │  Client Crypto Layer
     │   ├─ Generate Case DEK                   │  ├─ WebAuthn Authentication
     │   ├─ AES-256-GCM Encrypt                 │  ├─ HPKE Envelope Decrypt
     │   ├─ HKDF Key Derivation                 │  ├─ AES-256-GCM Decrypt
     │   └─ HPKE Envelope Wrap                  │  └─ HKDF Key Derivation
     │                                          │
     └──────────┬──────────┐              ┌─────┴──────────┐
                │          │              │                │
           Ciphertext   Wrapped DEK   Auth Token      Envelope
                │          │              │                │
                ▼          ▼              ▼                ▼
          ┌─────────────────────────────────────────────────────┐
          │                    API GATEWAY                       │
          │  TLS 1.3 · Rate Limiting · CSP · Correlation IDs    │
          │  Security Headers · CORS                             │
          └──────────────────────┬──────────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────────────┐
          │                  APPLICATION                        │
          │  Authentication → Authorization → Case → Message    │
          │  Evidence → Envelope → Receipt → Audit             │
          └──────────────────────┬──────────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────────────┐
          │              POSTGRESQL PRIMARY                     │
          │  Cases · Messages · Evidence · Envelopes             │
          │  Investigators · Sessions · Assignments              │
          │  Receipts · Audit Events · Crypto Registry           │
          │  Row-Level Security · Parameterized Queries          │
          └──────────────────────┬──────────────────────────────┘
                                 │
                          WAL Streaming
                                 │
          ┌──────────────────────┴──────────────────────────────┐
          │              POSTGRESQL STANDBY                     │
          └─────────────────────────────────────────────────────┘

ENCRYPTED OBJECT STORAGE
  ┌──────────────────────────────────────────────────────────────┐
  │  Content-addressed encrypted evidence files                  │
  │  `sha256(ciphertext).enc` — no original filenames           │
  │  Encryption at rest · Access logging · Lifecycle policies    │
  └──────────────────────────────────────────────────────────────┘
```

---

## 5. Cryptographic Architecture

### Version Registry

All cryptographic operations carry an explicit `crypto_version` identifier referencing a registry entry. This enables algorithm migration without altering the storage schema.

| Version | Name | Status |
|---------|------|--------|
| 1 | `hpke-dhkem-x25519-hkdf-sha256-aes256gcm` | **Active** |
| 2 | `ml-kem-hpke-hybrid` (future) | Planned |

### Provider Abstraction

```python
class CryptoProvider:
    encrypt_symmetric(key, plaintext, aad)
    decrypt_symmetric(key, ciphertext, nonce, tag, aad)
    derive_key(ikm, info, length, salt)
    hpke_seal(public_key, plaintext, info)
    hpke_open(private_key, ciphertext, info)
    sign(private_key, data)
    verify(public_key, data, signature)
    generate_hpke_key_pair()
    generate_signing_key()
```

### Active Suite (Version 1)

| Parameter | Value |
|-----------|-------|
| Symmetric | AES-256-GCM |
| Key size | 256 bits |
| Nonce | 96 bits (random per encryption, counter per derived key) |
| Tag | 128 bits |
| AAD | Bound to case_id, object_id, purpose |
| KDF | HKDF-SHA-256 |
| KDF salt | 32 bytes |
| HPKE KEM | DHKEM(X25519) |
| HPKE KDF | HKDF-SHA256 |
| HPKE AEAD | AES-256-GCM |
| Signing | Ed25519 |
| Envelope | HPKE-BASE |

---

## 6. Key Hierarchy

### Per-Case Key Model

```text
                      CASE DEK (256-bit random)
                           │
          ┌────────────────┼────────────────┬────────────────┐
          ▼                ▼                ▼                ▼
    REPORTER          INVESTIGATOR A   INVESTIGATOR B   INVESTIGATOR C
    Envelope           Envelope          Envelope          Envelope
    (Recovery KEK)     (HPKE pub key A)  (HPKE pub key B)  (HPKE pub key C)
```

### The Server Never Possesses

- **Plaintext Case DEK** — only per-recipient wrapped copies
- **Reporter Recovery Secret** — never transmitted or stored
- **Investigator Private Keys** — generated client-side, never uploaded
- **Universal Master Wrapping Key** — no such key exists

### Reporter Envelope

```text
Recovery Secret (256-bit, client-generated)
     │
     ▼
HKDF-SHA-256(salt=0x00, info="veildrop-reporter-kek")
     │
     ▼
Reporter KEK
     │
     ▼
AES-256-GCM(KEK, Case DEK) → Wrapped Reporter DEK
```

### Investigator Envelope

```text
Case DEK
     │
     ▼
HPKE Seal(pk_recipient, Case DEK, info=case_context)
     │
     ▼
Envelope (stored in DB)
```

### Key Separation by Purpose

```text
Case DEK
  │
  ├── HKDF(info="report:msg-1:v1")     → Report Key
  ├── HKDF(info="message:msg-2:v1")    → Message Key
  ├── HKDF(info="evidence:file-1:v1")  → Evidence Key
  └── HKDF(info="wrapping:envelope:v1") → Wrapping Context
```

### Encryption Limit

- Maximum encryptions per derived key: **2³²** (practical limit, not approachable in normal use)
- Maximum encryptions per Case DEK: depends on number of derived keys × 2³²
- Nonce generation per derived key: random for general messages, counter-based for chunked files

---

## 7. Per-Object Key Derivation

### Derivation Formula

```python
def derive_message_key(case_dek, object_id, purpose, crypto_version=1):
    info = b"|".join([purpose, object_id, f"v{crypto_version}".encode()])
    return HKDF-SHA256(ikm=case_dek, info=info, salt=None)
```

### Derivation Contexts

| Purpose | Object ID | Used For |
|---------|-----------|----------|
| `report` | `msg-{uuid}` | Initial report content |
| `message` | `msg-{uuid}` | Reporter/investigator messages |
| `evidence` | `file-{uuid}` | File encryption keys |
| `reporter-kek` | — | Reporter key-encryption key |

### Nonce Strategy

- **Random nonces** for individual messages (report, replies)
- **Counter-based nonces** for chunked file encryption
- Nonce is stored alongside ciphertext and not reused

---

## 8. HPKE Envelope Protocol

### Key Generation (Investigator Client)

```python
sk, pk = HPKE.generate_key_pair()  # X25519
# Store private key in browser (non-extractable CryptoKey)
# Upload public key to server
```

### Envelope Creation (Server)

```python
envelope = HPKE.Seal(
    pkR=investigator_public_key,
    info=b"VeilDrop-Case-Envelope-v1|" + case_id,
    pt=case_dek
)
# Store envelope in case_envelopes table
```

### Envelope Opening (Investigator Client)

```python
case_dek = HPKE.Open(
    skR=investigator_private_key,
    info=b"VeilDrop-Case-Envelope-v1|" + case_id,
    ct=envelope
)
# Use case_dek to derive message keys and decrypt
```

### Key Rotation

```text
DEK-v1 ──→ Generate DEK-v2 ──→ Re-encrypt content
    │                              │
    ▼                              ▼
Revoke old envelopes          Create new envelopes
                              Envelope(DEK-v2, A)
                              Envelope(DEK-v2, C)
```

---

## 9. File Encryption

### Chunked Authenticated Encryption

```python
def encrypt_file(file_key, plaintext, file_id):
    total_chunks = ceil(len(plaintext) / CHUNK_SIZE)
    for i in range(total_chunks):
        chunk = plaintext[i*CHUNK_SIZE : (i+1)*CHUNK_SIZE]
        nonce = struct.pack("!QQ", i, 0)    # counter-based
        aad = pack(i, total_chunks, len(chunk), file_id)
        ct, tag = AES-256-GCM(file_key, chunk, nonce, aad)
        output += ct + tag
    # metadata records algorithm, chunk_size, total_chunks, etc.
```

| Parameter | Value |
|-----------|-------|
| Chunk size | 65,536 bytes (64 KiB) |
| Max file size | 100 MiB (configurable) |
| Max files per case | 20 (configurable) |
| Nonce | 12-byte counter (big-endian chunk index) |
| AAD | chunk_index + total_chunks + chunk_length + file_id |
| Tag | 16 bytes per chunk |
| Total overhead | ~0.024% for 100 MiB file |

### Storage

```text
object_key = sha256(ciphertext).hex() + ".enc"
# No original filename preserved
```

---

## 10. Reporter Flow

### Case Creation

```text
1. Reporter opens VeilDrop (no account)
2. Browser generates:
   ─ Case DEK (256-bit, cryptographically random)
   ─ Recovery Secret (256-bit, cryptographically random)
3. Derives Reporter KEK from Recovery Secret via HKDF
4. Wraps Case DEK with KEK → Reporter Envelope
5. Derives Report Key from Case DEK via HKDF
6. Encrypts report with AES-256-GCM(Report Key, plaintext)
7. Attaches evidence (encrypted client-side with Evidence Key)
8. Sends to server:
   ─ ciphertext + nonce + tag + aad
   ─ wrapped Case DEK
   ─ optional metadata (category, priority, ttl)
9. Server:
   ─ Generates Case ID
   ─ Stores ciphertext
   ─ Stores wrapped DEK as Reporter Envelope
   ─ Computes content hash
   ─ Issues signed receipt
10. Reporter receives:
    ─ Case ID
    ─ Signed Receipt
    Recovery Secret displayed ONCE — must be saved
```

### Case Access (Returning Reporter)

```text
1. Reporter enters Case ID + Recovery Secret
2. Browser derives KEK from Recovery Secret
3. Requests case data + reporter envelope from server
4. Unwraps Case DEK using KEK
5. Derives message keys via HKDF
6. Decrypts content locally
```

### Lost Recovery Secret

> **If the reporter loses the Recovery Secret, VeilDrop cannot recover cryptographic access to the case. This is not a bug; it is a consequence of zero-knowledge design.**

An offline recovery package (downloadable file) is offered at case creation. Server-side recovery would violate the zero-knowledge model.

---

## 11. Investigator Authentication

### Primary: WebAuthn / Passkeys

```text
Registration:
  Client generates asymmetric key pair (platform or cross-platform authenticator)
  Public key uploaded to server
  Private key stored on device (Secure Enclave, TPM, hardware key)

Login:
  Server issues challenge (random nonce)
  Client signs challenge with private key
  Server verifies signature against stored public key
  Session created (server-managed, HttpOnly cookie or Bearer token)
```

### Fallback: Argon2id Password

| Parameter | Value |
|-----------|-------|
| Hash | Argon2id |
| Salt | Per-user, 128-bit random |
| Time cost | 3 (configurable) |
| Memory cost | 65536 KiB (64 MiB) |
| Parallelism | 4 |

### Session Management

- Bearer token with server-side validation
- `HttpOnly; Secure; SameSite=Strict` when cookie-based
- Configurable expiration (default 8 hours)
- Idle timeout (default 30 minutes)
- Server-side revocation
- Rotation on privilege change

---

## 12. Investigator Authorization

### Authorization Chain

```text
Request → Authentication → Role Check → Case Assignment → Permission → RLS → Response
```

### Roles

| Role | Privileges |
|------|-----------|
| `investigator` | Assigned cases only. Read/write own cases. |
| `senior_investigator` | Above + assign cases, expire cases, view envelope metadata. |
| `security_admin` | Above + manage investigators, view all security events, revoke sessions. |

**Administrative privilege does not grant cryptographic access to decrypt cases.** The admin can assign an envelope to an investigator who has the corresponding private key, but cannot decrypt without the investigator's private key.

### Authorization Flow

```python
# Every protected endpoint:
session = validate_session(token)           # Authentication
if session.role not in allowed_roles:       # Role check
    return 403
permission = check_access(case_id, inv_id)  # Assignment check
if not permission:
    return 403
# Proceed with operation
```

### Database Layer

Row-Level Security enforces the same policy at the database level:

```sql
CREATE POLICY investigator_case_select ON cases FOR SELECT
USING (
    EXISTS (SELECT 1 FROM case_assignments
            WHERE case_id = cases.case_id
              AND investigator_id = current_setting('app.investigator_id')::UUID
              AND revoked_at IS NULL)
    OR current_setting('app.role') = 'security_admin'
);
```

---

## 13. Signed Cryptographic Receipts

### Receipt Content

```text
case_id=VEIL-ABCD1234EF56
ciphertext_hash=sha256:abcdef...
crypto_ver=1
ts=2026-07-30T12:00:00Z
```

### Signing

```python
canonical = f"case_id={case_id}&ciphertext_hash={ch}&crypto_ver={cv}&ts={ts}"
signature = Ed25519.Sign(receipt_signing_key, canonical.encode())
```

### Verification

The reporter can verify the receipt independently using the published verification public key. Verification is independent of the case API.

### What the Receipt Proves

> **VeilDrop acknowledged this specific encrypted submission at this specific time.**

It does not prove permanent storage, retention, or that deletion never occurred.

### Key Separation

The Receipt Signing Key is completely separate from:
- Case encryption keys
- Authentication keys
- Database credentials
- TLS private keys
- Any other key material

---

## 14. Burn-on-Read

### Protocol

```sql
BEGIN;
  SELECT ... WHERE message_id = $1
    AND burn_after_read = true
    AND consumed_at IS NULL
  FOR UPDATE;

  UPDATE encrypted_messages
  SET consumed_at = now()
  WHERE message_id = $1;

  -- Return ciphertext
COMMIT;
```

### Atomicity

The `SELECT FOR UPDATE` within a transaction ensures that concurrent requests cannot both consume the same message. Exactly one request succeeds; all others receive `410 Gone`.

### Limitation

Burn-on-read removes future server-side availability. It cannot erase plaintext that was already copied, photographed, screenshotted, or captured by the recipient's device.

---

## 15. Database Architecture

### Topology

```text
Application ──→ PostgreSQL Primary (read/write)
                      │
                WAL Streaming
                      │
                PostgreSQL Standby (read-only)
```

### Core Tables

| Table | Purpose | Sensitive Content |
|-------|---------|-------------------|
| `cases` | Case metadata | Status, timestamps, crypto version |
| `encrypted_messages` | Reporter/investigator messages | Ciphertext only |
| `encrypted_evidence` | Evidence file records | Encrypted paths, metadata |
| `investigators` | Investigator accounts | Password hashes (Argon2id) |
| `webauthn_credentials` | WebAuthn public keys | Public keys, credential IDs |
| `investigator_keys` | HPKE encryption public keys | Public keys |
| `case_envelopes` | Per-recipient wrapped DEKs | Wrapped DEK ciphertext |
| `case_assignments` | Authorization assignments | Permission levels |
| `investigator_sessions` | Session tracking | Token hashes |
| `signed_receipts` | Submission receipts | Ciphertext hashes, signatures |
| `receipt_keys` | Receipt signing verification keys | Public keys |
| `security_events` | Audit log | Event metadata (no plaintext) |
| `crypto_versions` | Algorithm registry | Algorithm parameters |

### Security

- **Parameterized queries** for all operations
- **Least privilege**: application role is not superuser
- **Separate migration account**
- **RLS** enabled on sensitive tables
- **Encrypted connections**
- **Backup encryption**
- **Storage volume encryption**

---

## 16. Row-Level Security

### Enforced Tables

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_envelopes ENABLE ROW LEVEL SECURITY;
```

### Policy: Case Access

```sql
CREATE POLICY investigator_case_select ON cases FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM case_assignments
        WHERE case_id = cases.case_id
          AND investigator_id = current_setting('app.investigator_id')::UUID
          AND revoked_at IS NULL
    )
    OR current_setting('app.role') = 'security_admin'
);
```

### RLS Is Not SQL Injection Prevention

RLS is a **defense-in-depth** authorization boundary. SQL injection prevention comes from **parameterized queries**. RLS limits the damage if another authorization layer is bypassed.

---

## 17. Transport Security

### TLS Configuration

| Parameter | Value |
|-----------|-------|
| Minimum protocol | TLS 1.2 |
| Preferred protocol | TLS 1.3 |
| HSTS | `max-age=31536000; includeSubDomains` |
| Cipher suites | TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256 |

### Layered Protection

```text
Plaintext
    │
    ▼  Client-Side Encryption (AES-256-GCM)
Ciphertext
    │
    ▼  TLS 1.3 (HTTPS)
Encrypted Channel
    │
    ▼
Backend
```

Both layers are independently necessary. Client encryption protects the payload; TLS protects transport metadata.

---

## 18. Browser Security

### Content Security Policy

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'strict-dynamic';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  form-action 'self';
  base-uri 'self';
  frame-ancestors 'none';
  block-all-mixed-content;
```

### Additional Headers

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### JavaScript Security

- No `eval()` or `Function()` constructor
- No arbitrary inline scripts
- Minimized third-party dependencies
- Dependency lockfiles committed
- Regular dependency auditing
- Non-extractable `CryptoKey` where protocol permits

### Key Handling

```text
Recover/Generate DEK → Perform Operation → Release References

Never in: localStorage, sessionStorage, IndexedDB, cookies, URLs, logs, analytics, crash reports
```

---

## 19. Data Retention

### Policies

| Policy | Duration | Use Case |
|--------|----------|----------|
| Short | 24 hours | Test cases, low-sensitivity |
| Standard | 7 days | Default |
| Extended | 30 days | Complex investigations |
| Post-closure | Destroy on close | Maximum sensitivity |

### Expiration Flow

```text
Case Expires
  ├── Case status → 'expired'
  ├── Encrypted messages remain (ciphertext only)
  ├── Encrypted evidence remains
  ├── Envelopes revoked
  └── New operations rejected
```

### Cryptographic Erasure

Destroying the relevant key material provides cryptographic erasure for encrypted data that may persist in backups or replicated storage.

**Limitation**: Cryptographic erasure is best-effort. It is effective only when:
- Key material is separate from encrypted data
- No copies of key material exist in backups, logs, or error dumps
- The KDF is one-way

### Deletion vs. Erasure

- **Logical deletion**: Mark records as deleted in database
- **Physical deletion**: Remove from active storage (may persist in backups)
- **Cryptographic erasure**: Destroy keys making remaining ciphertext undecryptable

---

## 20. Audit System

### Security Events

| Event Type | Severity | Trigger |
|-----------|----------|---------|
| `case_created` | info | New case submission |
| `case_assigned` | info | Investigator assigned to case |
| `case_expired` | info | Automatic or manual expiration |
| `case_closed` | info | Investigator closes case |
| `envelope_assigned` | info | Investigator receives envelope |
| `envelope_revoked` | warning | Envelope access removed |
| `auth_failure` | warning | Failed authentication attempt |
| `auth_success` | info | Successful authentication |
| `auth_logout` | info | Session logout |
| `sessions_revoked` | warning | All sessions revoked |
| `investigator_created` | info | New investigator account |
| `key_rotation` | warning | Case DEK rotated |
| `rate_limit_exceeded` | warning | Rate limit triggered |

### Audit Integrity

Selected events carry cryptographic signatures (Ed25519) for tamper evidence.

```python
canonical = json.dumps(event_data, sort_keys=True).encode()
event_hash = SHA256(canonical)
signature = Ed25519.Sign(audit_key, canonical)
```

### Never in Audit Records

- Report plaintext
- Evidence plaintext
- Encryption keys
- Recovery Secrets
- Passwords

---

## 21. Post-Quantum Extension

### Design Principle

Post-quantum cryptography is an **optional extension** to a complete classical protocol, not a marketing feature bolted onto an underspecified architecture.

### Provider Model

```python
class CryptoProvider:
    # Abstract interface — algorithms are versioned
    # Version 1: classical (DHKEM-X25519 + HKDF-SHA256 + AES-256-GCM)  [active]
    # Version 2: hybrid classical + ML-KEM-768 (dual-KEM combiner)     [registered, inactive]
    pass
```

### Hybrid Profile (implemented as `app/crypto/hybrid_kem.py`)

```text
Classical Shared Secret (X25519)
      +
ML-KEM-768 Shared Secret
      │
      ▼
Dual-KEM Combiner (concatenation-then-hash: SHA-256 over
domain-separator ‖ ss_classical ‖ ss_mlkem ‖ enc_classical ‖ mlkem_ciphertext)
      │
      ▼
HKDF-SHA-256
      │
      ▼
Derived Key Material
```

- Wire format: `enc_classical (32) ‖ mlkem_ciphertext (1088) ‖ nonce (12) ‖ AEAD-ct+tag`
- Public key blob: `classical_pub (32) ‖ mlkem_pub (1184)`; private blob: `classical_sk (32) ‖ mlkem_seed (64)`
- Registered as `CryptoVersion.V2_HYBRID_MLKEM768_X25519` in `SUITES` and the
  `crypto_versions` table (inactive); provider methods accept an explicit
  `version=` for isolated, cross-version-safe dispatch.
- The combiner is the reviewed TLS-hybrid-design concatenation-then-hash
  pattern (both KEMs are IND-CCA), never a custom KDF.
- Client-side sealing for V2 is deferred until browsers expose ML-KEM in
  WebCrypto; the server-side engine, registry, and tests are complete and
  independently verifiable.

### Constraints

- The hybrid construction must follow a reviewed specification (never custom)
- Post-quantum functionality must be independently testable and versioned
- Algorithm identifiers must be explicit in all metadata
- The provider abstraction allows new versions without altering business logic

---

## 22. Security Testing

### Automated Test Categories

| Category | Tests |
|----------|-------|
| **Cryptography** | Encrypt/decrypt roundtrip, wrong key rejection, tampered ciphertext, tampered AAD, nonce uniqueness, chunked file roundtrip |
| **Key Derivation** | Purpose separation, DEK separation, deterministic derivation |
| **HPKE** | Seal/open roundtrip, wrong recipient rejection, tampered envelope |
| **Signing** | Sign/verify, wrong key rejection, tampered data |
| **Authorization** | Cross-case isolation, unauthenticated rejection, role boundaries, session expiry |
| **SQL Injection** | Parameterized query verification, second-order injection |
| **RLS** | Direct DB access with restricted role, unauthorized row blocking |
| **Burn-on-Read** | Single consume, concurrent consume (N-1 must fail), second consume, non-burn isolation |
| **Expiration** | Expired case unavailable, messages/evidence rejected, envelopes revoked |
| **Receipt** | Valid verification, modified hash, modified timestamp, wrong key, retired key |

### Concurrency Tests

Burn-on-read: Run 10 simultaneous requests for the same message. Exactly 1 returns the message; 9 return 410.

### Penetration Testing

- Network capture: Verify TLS + client encryption
- XSS: CSP enforcement, no key leakage
- Dependency scanning
- SAST scanning

---

## 23. Implementation Phases

### Phase 1 — Foundation
Architecture, threat model, database schema, project structure, CI/CD, configuration management.

### Phase 2 — Cryptographic Core
Crypto provider, AES-256-GCM, HKDF, HPKE, signing, test vectors, version registry.

### Phase 3 — Anonymous Reporter
Case creation API, reporter frontend, client-side crypto (Web Crypto API), receipt issuance.

### Phase 4 — Investigator Identity
WebAuthn integration, Argon2id password auth, session management, role-based authorization.

### Phase 5 — Recipient Envelopes
Investigator HPKE key generation, envelope creation/retrieval, client-side decryption.

### Phase 6 — Evidence
Chunked file encryption, encrypted upload, content-addressed storage, secure retrieval.

### Phase 7 — Database Defense
RLS policies, least-privilege roles, replication setup, backup encryption.

### Phase 8 — Advanced Security
Burn-on-read, signed receipts, key rotation, retention enforcement, audit system.

### Phase 9 — Security Hardening
CSP, SRI, secure headers, rate limiting, dependency hardening, SAST integration.

### Phase 10 — Post-Quantum Extension
ML-KEM HPKE integration (only after classical protocol is complete and tested).

### Phase 11 — Verification
Threat-model tests, concurrency tests, cryptographic test vectors, performance benchmarks.

### Phase 12 — Production Readiness
Accessibility (WCAG 2.2 AA), observability, backup/recovery testing, operational documentation.

---

## Principle

> **Do not optimize for having the largest number of security technologies. Optimize for correct protocol design, explicit trust boundaries, minimal server knowledge, strong key management, secure implementation, usability, auditability, maintainability, crypto agility, and defense in depth.**

Before implementing any security-sensitive feature, answer:

1. What asset are we protecting?
2. Who is trusted?
3. Who possesses the key?
4. Where does plaintext exist?
5. What happens if this component is compromised?
6. How is access revoked?
7. How is the operation tested?
8. What metadata leaks?
9. What happens during key loss?
10. Can the security claim actually be demonstrated?
