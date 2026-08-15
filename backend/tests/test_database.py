from __future__ import annotations

import os

import asyncpg
import pytest
import pytest_asyncio

DB_URL = os.getenv(
    "VEILDROP_DATABASE_URL",
    "postgresql://veildrop:veildrop@localhost:5432/veildrop",
)

RLS_TABLES = ["cases", "encrypted_messages", "encrypted_evidence", "case_envelopes"]


def _admin_url() -> str | None:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("VEILDROP_POSTGRES_ADMIN_URL="):
                    return line.split("=", 1)[1].strip()
    return None


def _admin_pool_url(database: str = "postgres") -> str:
    url = _admin_url()
    if not url:
        raise RuntimeError("VEILDROP_POSTGRES_ADMIN_URL not configured")
    base = url.rsplit("/", 1)[0]
    return f"{base}/{database}"


async def _admin_pool(database: str = "postgres"):
    if not _admin_url():
        pytest.skip("VEILDROP_POSTGRES_ADMIN_URL not configured; skipping live RLS role test")
    try:
        return await asyncpg.create_pool(_admin_pool_url(database), min_size=1, max_size=2)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"admin connection unavailable: {e}")


@pytest_asyncio.fixture(scope="module")
async def pool():
    try:
        p = await asyncpg.create_pool(DB_URL, min_size=1, max_size=10)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"PostgreSQL not reachable: {e}")
    yield p
    await p.close()


async def _seed_case(pool, case_id: str, message_id: str = "msg-1") -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
        await conn.execute(
            "INSERT INTO cases (case_id, status) VALUES ($1, 'open')",
            case_id,
        )
        await conn.execute(
            "INSERT INTO encrypted_messages (case_id, sender_type, ciphertext, nonce, tag) "
            "VALUES ($1, 'reporter', '\\x01'::BYTEA, '\\x02'::BYTEA, '\\x03'::BYTEA)",
            case_id,
        )


class TestSQLInjection:
    """Parameterized-query verification against a live database."""

    async def test_injection_case_id_treated_as_literal(self, pool):
        malicious = "' OR '1'='1; DROP TABLE cases; --"
        case_id = "VEIL-INJECT-1"
        try:
            await _seed_case(pool, case_id)
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO cases (case_id, status) VALUES ($1, 'open')",
                    malicious,
                )
                row = await conn.fetchrow(
                    "SELECT case_id FROM cases WHERE case_id = $1",
                    malicious,
                )
                assert row is not None and row["case_id"] == malicious

                unrelated = await conn.fetchrow(
                    "SELECT case_id FROM cases WHERE case_id = $1",
                    case_id,
                )
                assert unrelated is not None and unrelated["case_id"] == case_id
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM cases WHERE case_id = $1", malicious)

    async def test_injection_does_not_execute(self, pool):
        """An injection payload must never execute; tables stay intact."""
        malicious = "' OR 1=1; DROP TABLE cases; --"
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO cases (case_id, status) VALUES ($1, 'open')",
                malicious,
            )
            await conn.execute("DELETE FROM cases WHERE case_id = $1", malicious)

            count = await conn.fetchval("SELECT count(*) FROM cases")
            assert isinstance(count, int)
            table = await conn.fetchval("SELECT to_regclass('public.cases')")
            assert table is not None, "cases table must still exist"

    async def test_second_order_injection_uses_parameters(self, pool):
        """Stored attacker-controlled values remain bound as literals on read-back."""
        malicious = "x'; DELETE FROM cases; --"
        case_id = "VEIL-INJECT-2"
        try:
            await _seed_case(pool, case_id)
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO cases (case_id, status) VALUES ($1, 'open')",
                    malicious,
                )
                stored = await conn.fetchval(
                    "SELECT case_id FROM cases WHERE case_id = $1",
                    malicious,
                )
                assert stored == malicious
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM cases WHERE case_id = $1", malicious)


class TestRLS:
    """Row-Level Security defense-in-depth checks."""

    async def test_rls_enabled_on_sensitive_tables(self, pool):
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT relname, relrowsecurity FROM pg_class "
                "JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace "
                "WHERE nspname = 'public' AND relname = ANY($1::text[])",
                RLS_TABLES,
            )
        enabled = {r["relname"]: r["relrowsecurity"] for r in rows}
        for table in RLS_TABLES:
            assert enabled.get(table) is True, f"RLS not enabled on {table}"

    async def test_direct_db_access_blocked_for_unassigned_case(self, pool):
        """A least-privilege role must not see unassigned cases when scoped."""
        admin = await _admin_pool()
        admin_vd = await _admin_pool("veildrop")
        case_a, case_b = "VEIL-RLS-A", "VEIL-RLS-B"
        investigator = "11111111-1111-1111-1111-111111111111"
        username = "veildrop_rls_probe"
        password = "rls-probe-pass-9f4c2a"
        try:
            async with admin.acquire() as ac:
                await ac.execute("DROP ROLE IF EXISTS " + username)
                await ac.execute(f"CREATE ROLE {username} LOGIN PASSWORD '{password}'")
                await ac.execute("GRANT CONNECT ON DATABASE veildrop TO " + username)
            async with admin_vd.acquire() as ac:
                await ac.execute("GRANT USAGE ON SCHEMA public TO " + username)
                grant_tables = RLS_TABLES + ["case_assignments"]
                for table in grant_tables:
                    await ac.execute(f"GRANT SELECT ON public.{table} TO " + username)

            await _seed_case(pool, case_a)
            await _seed_case(pool, case_b)
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO investigators (investigator_id, username) VALUES ($1, 'rls_probe')",
                    investigator,
                )
                await conn.execute(
                    "INSERT INTO case_assignments (case_id, investigator_id, permission) VALUES ($1, $2, 'read')",
                    case_b,
                    investigator,
                )

            probe_url = DB_URL.rsplit("@", 1)[1]
            probe_url = "postgresql://" + username + ":" + password + "@" + probe_url
            async with asyncpg.create_pool(probe_url, min_size=1, max_size=2) as probe:
                async with probe.acquire() as conn:
                    await conn.fetchval(
                        "SELECT set_config('app.investigator_id', $1, false)",
                        investigator,
                    )
                    visible = {r["case_id"] for r in await conn.fetch("SELECT case_id FROM cases")}
                assert case_b in visible, "assigned case must be visible to scoped role"
                assert case_a not in visible, "unassigned case must be blocked by RLS"
        finally:
            async with pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM case_assignments WHERE investigator_id = $1",
                    investigator,
                )
                await conn.execute(
                    "DELETE FROM investigators WHERE investigator_id = $1",
                    investigator,
                )
                for case_id in (case_a, case_b):
                    await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
            for admin_pool in (admin_vd, admin):
                async with admin_pool.acquire() as ac:
                    await ac.execute("DROP OWNED BY " + username)
            async with admin.acquire() as ac:
                await ac.execute("DROP ROLE IF EXISTS " + username)
            await admin_vd.close()
            await admin.close()

    async def test_anonymous_reporter_still_sees_own_case(self, pool):
        """Without app.investigator_id, the reporter policy permits access."""
        case_id = "VEIL-RLS-ANON"
        try:
            await _seed_case(pool, case_id)
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT case_id FROM cases WHERE case_id = $1",
                    case_id,
                )
                assert row is not None and row["case_id"] == case_id
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
