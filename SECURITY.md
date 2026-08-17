# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in VeilDrop, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email the project maintainer with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You should receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Security Measures

VeilDrop implements the following security controls:

- **Client-side encryption** — All sensitive content is encrypted in the browser before transmission
- **Zero-knowledge architecture** — The server never has access to plaintext content or encryption keys
- **Row-Level Security** — PostgreSQL RLS policies enforce per-role data access
- **WebAuthn / Passkey authentication** — Phishing-resistant authentication for investigators
- **Rate limiting** — Per-IP rate limiting on all API endpoints
- **Security headers** — CSP, HSTS, X-Content-Type-Options, and more
- **SRI integrity** — All frontend assets have Subresource Integrity hashes
- **Signed receipts** — Ed25519-signed audit trail for every submission
- **Burn-on-read** — Messages self-destruct after viewing
- **Structured logging** — JSON audit logs for all state changes
- **Dependency scanning** — pip-audit runs in CI to catch known CVEs
