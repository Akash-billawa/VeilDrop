from __future__ import annotations

import json
import logging

import asyncpg
from asyncpg import Pool, Record

from .config import get_settings

logger = logging.getLogger(__name__)

pool: Pool | None = None


def require_row(row: Record | None, what: str) -> Record:
    if row is None:
        raise RuntimeError(f"Expected a row from the database for {what}, but got none")
    return row


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def create_pool() -> Pool:
    s = get_settings()
    return await asyncpg.create_pool(
        s.database_url,
        min_size=2,
        max_size=s.database_max_connections,
        statement_cache_size=200,
        command_timeout=30,
        init=_init_conn,
    )


SCHEMA_SQL = """

CREATE TABLE IF NOT EXISTS crypto_versions (
    version         INTEGER PRIMARY KEY,
    algorithm_name  TEXT NOT NULL,
    parameters      JSONB NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deprecated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cases (
    case_id         TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','under_review','waiting','closed','expired')),
    reporter_meta   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    crypto_version  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_expires ON cases(expires_at) WHERE status NOT IN ('expired','closed');
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_versions_one_active ON crypto_versions(active) WHERE active;

CREATE TABLE IF NOT EXISTS encrypted_messages (
    message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    sender_type     TEXT NOT NULL CHECK (sender_type IN ('reporter','investigator')),
    ciphertext      BYTEA NOT NULL,
    nonce           BYTEA NOT NULL,
    tag             BYTEA NOT NULL,
    aad             BYTEA DEFAULT ''::BYTEA,
    crypto_version  INTEGER NOT NULL DEFAULT 1,
    burn_after_read BOOLEAN NOT NULL DEFAULT false,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_case ON encrypted_messages(case_id);

CREATE TABLE IF NOT EXISTS encrypted_evidence (
    evidence_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    object_key          TEXT NOT NULL,
    crypto_metadata     JSONB NOT NULL,
    original_size       BIGINT NOT NULL,
    encrypted_size      BIGINT NOT NULL,
    content_type        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_case ON encrypted_evidence(case_id);

CREATE TABLE IF NOT EXISTS investigators (
    investigator_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    password_hash   TEXT,
    role            TEXT NOT NULL DEFAULT 'investigator'
                    CHECK (role IN ('investigator','senior_investigator','security_admin')),
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    credential_id   BYTEA PRIMARY KEY,
    investigator_id UUID NOT NULL REFERENCES investigators(investigator_id) ON DELETE CASCADE,
    public_key      BYTEA NOT NULL,
    sign_count      BIGINT NOT NULL DEFAULT 0,
    credential_type TEXT NOT NULL,
    transports      TEXT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_inv ON webauthn_credentials(investigator_id);

CREATE TABLE IF NOT EXISTS investigator_keys (
    key_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id UUID NOT NULL REFERENCES investigators(investigator_id) ON DELETE CASCADE,
    public_key      BYTEA NOT NULL,
    algorithm       TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_keys ON investigator_keys(investigator_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_keys_pub ON investigator_keys(investigator_id, public_key);

CREATE TABLE IF NOT EXISTS case_envelopes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    recipient_id    TEXT NOT NULL,
    recipient_type  TEXT NOT NULL CHECK (recipient_type IN ('reporter','investigator')),
    wrapped_dek     BYTEA NOT NULL,
    key_version     INTEGER NOT NULL DEFAULT 1,
    algorithm       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    CONSTRAINT uq_active_envelope UNIQUE (case_id, recipient_id, recipient_type, key_version)
);

CREATE INDEX IF NOT EXISTS idx_envelopes_case ON case_envelopes(case_id);
CREATE INDEX IF NOT EXISTS idx_envelopes_recip ON case_envelopes(recipient_id);

CREATE TABLE IF NOT EXISTS case_assignments (
    assignment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    investigator_id UUID NOT NULL REFERENCES investigators(investigator_id) ON DELETE CASCADE,
    permission      TEXT NOT NULL CHECK (permission IN ('read','write','admin')),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    CONSTRAINT uq_active_assignment UNIQUE (case_id, investigator_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_assign_inv ON case_assignments(investigator_id);

CREATE TABLE IF NOT EXISTS security_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    case_id         TEXT,
    investigator_id UUID,
    details         JSONB,
    event_hash      BYTEA,
    signature       BYTEA,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON security_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_severity ON security_events(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_events_case ON security_events(case_id);
CREATE INDEX IF NOT EXISTS idx_events_investigator ON security_events(investigator_id);

CREATE TABLE IF NOT EXISTS signed_receipts (
    receipt_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    ciphertext_hash TEXT NOT NULL,
    signature       BYTEA NOT NULL,
    signing_key_id  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_case ON signed_receipts(case_id);

CREATE TABLE IF NOT EXISTS receipt_keys (
    key_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key  BYTEA NOT NULL,
    algorithm   TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS investigator_sessions (
    session_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id UUID NOT NULL REFERENCES investigators(investigator_id) ON DELETE CASCADE,
    token_hash      BYTEA NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    idle_deadline   TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_inv ON investigator_sessions(investigator_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON investigator_sessions(token_hash);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key      TEXT PRIMARY KEY,
    window_start    TIMESTAMPTZ NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_receipts_signing_key'
    ) THEN
        BEGIN
            ALTER TABLE signed_receipts
                ADD CONSTRAINT fk_receipts_signing_key
                FOREIGN KEY (signing_key_id) REFERENCES receipt_keys(key_id);
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Could not add fk_receipts_signing_key: %', SQLERRM;
        END;
    END IF;
END $$;

"""

RLS_SQL = """

-- Row-Level Security model
-- ------------------------
-- VeilDrop runs on a single application DB role (the asyncpg pool). Per-row
-- authorization for that role is enforced in application code with
-- parameterized queries (case_svc.check_access, get_assigned_cases, ...).
--
-- RLS provides a table-level defense-in-depth boundary:
--   * Anonymous reporter operations (case_id is a high-entropy bearer
--     credential) run with NO session settings; the `reporter_access_*`
--     FOR ALL policies permit them.
--   * Investigator scoping is expressed through `app.investigator_id` /
--     `app.role` session settings. These are intended for least-privilege
--     roles that may read the schema but must not set session GUCs, so a
--     compromised non-app role is still confined to assigned cases.
--   * When `app.investigator_id` is set on the querying connection, the
--     anonymous policies no longer match and the assignment-scoped SELECT
--     policies are the only path in.

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_envelopes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- cases ---
DROP POLICY IF EXISTS reporter_access_cases ON cases;
CREATE POLICY reporter_access_cases ON cases
    FOR ALL
    USING (current_setting('app.investigator_id', true) IS NULL)
    WITH CHECK (current_setting('app.investigator_id', true) IS NULL);

DROP POLICY IF EXISTS investigator_select_cases ON cases;
CREATE POLICY investigator_select_cases ON cases
    FOR SELECT
    USING (
        current_setting('app.role', true) = 'security_admin'
        OR EXISTS (
            SELECT 1 FROM case_assignments ca
            WHERE ca.case_id = cases.case_id
              AND ca.investigator_id = current_setting('app.investigator_id', true)::UUID
              AND ca.revoked_at IS NULL
        )
    );

-- ----------------------------------------------------- encrypted_messages ---
DROP POLICY IF EXISTS reporter_access_messages ON encrypted_messages;
CREATE POLICY reporter_access_messages ON encrypted_messages
    FOR ALL
    USING (current_setting('app.investigator_id', true) IS NULL)
    WITH CHECK (current_setting('app.investigator_id', true) IS NULL);

DROP POLICY IF EXISTS investigator_select_messages ON encrypted_messages;
CREATE POLICY investigator_select_messages ON encrypted_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM case_assignments ca
            WHERE ca.case_id = encrypted_messages.case_id
              AND ca.investigator_id = current_setting('app.investigator_id', true)::UUID
              AND ca.revoked_at IS NULL
        )
    );

-- ------------------------------------------------------ encrypted_evidence ---
DROP POLICY IF EXISTS reporter_access_evidence ON encrypted_evidence;
CREATE POLICY reporter_access_evidence ON encrypted_evidence
    FOR ALL
    USING (current_setting('app.investigator_id', true) IS NULL)
    WITH CHECK (current_setting('app.investigator_id', true) IS NULL);

DROP POLICY IF EXISTS investigator_select_evidence ON encrypted_evidence;
CREATE POLICY investigator_select_evidence ON encrypted_evidence
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM case_assignments ca
            WHERE ca.case_id = encrypted_evidence.case_id
              AND ca.investigator_id = current_setting('app.investigator_id', true)::UUID
              AND ca.revoked_at IS NULL
        )
    );

-- ----------------------------------------------------------- case_envelopes ---
DROP POLICY IF EXISTS reporter_access_envelopes ON case_envelopes;
CREATE POLICY reporter_access_envelopes ON case_envelopes
    FOR ALL
    USING (current_setting('app.investigator_id', true) IS NULL)
    WITH CHECK (current_setting('app.investigator_id', true) IS NULL);

DROP POLICY IF EXISTS investigator_select_envelopes ON case_envelopes;
CREATE POLICY investigator_select_envelopes ON case_envelopes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM case_assignments ca
            WHERE ca.case_id = case_envelopes.case_id
              AND ca.investigator_id = current_setting('app.investigator_id', true)::UUID
              AND ca.revoked_at IS NULL
        )
    );

"""


async def init_db(p: Pool) -> None:
    async with p.acquire() as conn:
        await conn.execute(SCHEMA_SQL)

        existing = await conn.fetchval("SELECT version FROM crypto_versions WHERE version = 1")
        if existing is None:
            suite = {
                "version": 1,
                "name": "hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
                "sym_alg": "AES-256-GCM",
                "sym_key_bytes": 32,
                "sym_nonce_bytes": 12,
                "sym_tag_bytes": 16,
                "kdf": "HKDF-SHA-256",
                "kdf_salt_bytes": 32,
                "hpke_kem": "DHKEM(X25519)",
                "hpke_kdf": "HKDF-SHA256",
                "hpke_aead": "AES-256-GCM",
                "signing": "Ed25519",
                "envelope": "HPKE-BASE",
            }
            await conn.execute(
                "INSERT INTO crypto_versions (version, algorithm_name, parameters, active) "
                "VALUES (1, $1, $2::JSONB, true)",
                suite["name"],
                suite,
            )

        v2 = await conn.fetchval("SELECT version FROM crypto_versions WHERE version = 2")
        if v2 is None:
            suite_v2 = {
                "version": 2,
                "name": "hpke-hybrid-mlkem768-x25519-hkdf-sha256-aes256gcm",
                "sym_alg": "AES-256-GCM",
                "sym_key_bytes": 32,
                "sym_nonce_bytes": 12,
                "sym_tag_bytes": 16,
                "kdf": "HKDF-SHA-256",
                "kdf_salt_bytes": 32,
                "hpke_kem": "HYBRID(MLKEM-768 + DHKEM-X25519)",
                "hpke_kdf": "HKDF-SHA256",
                "hpke_aead": "AES-256-GCM",
                "signing": "Ed25519",
                "envelope": "HPKE-BASE-DUAL-KEM",
            }
            await conn.execute(
                "INSERT INTO crypto_versions (version, algorithm_name, parameters, active) "
                "VALUES (2, $1, $2::JSONB, false)",
                suite_v2["name"],
                suite_v2,
            )

        await conn.execute(RLS_SQL)
        logger.info("Database schema and RLS initialized")


async def get_pool() -> Pool:
    global pool
    if pool is None:
        pool = await create_pool()
    return pool


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None
