"""End-to-end WAL streaming replication tests.

These tests need a real primary + standby pair (they mutate and promote a
standby, so they are isolated from the normal test database). Provision with:

  scripts/ci-replication-setup.sh        # Linux / CI
  scripts/replica.ps1                     # Windows (local ops)

and point at them with:

  VEILDROP_REPL_PRIMARY_URL=postgresql://postgres@127.0.0.1:55432/veildrop
  VEILDROP_REPL_STANDBY_URL=postgresql://postgres@127.0.0.1:55433/veildrop

Run with: pytest -m replication
"""

from __future__ import annotations

import asyncio
import os
import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.replication

PRIMARY_URL = os.getenv("VEILDROP_REPL_PRIMARY_URL", "")
STANDBY_URL = os.getenv("VEILDROP_REPL_STANDBY_URL", "")

POLL_ATTEMPTS = 60
POLL_INTERVAL = 0.5


def _require_urls() -> None:
    if not PRIMARY_URL or not STANDBY_URL:
        pytest.skip(
            "replication tests need VEILDROP_REPL_PRIMARY_URL and "
            "VEILDROP_REPL_STANDBY_URL (run scripts/ci-replication-setup.sh "
            "or scripts/replica.ps1 first)"
        )


async def _connect(url: str) -> asyncpg.Connection:
    try:
        return await asyncpg.connect(url)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"PostgreSQL pair not reachable: {e}")


async def _wait_for(fn, attempts: int = POLL_ATTEMPTS) -> object:
    for _ in range(attempts):
        value = await fn()
        if value:
            return value
        await asyncio.sleep(POLL_INTERVAL)
    return None


class TestStreamingReplication:
    async def test_roles_topology(self) -> None:
        """The pair must actually be a primary + standby, never two primaries."""
        _require_urls()
        primary = await _connect(PRIMARY_URL)
        standby = await _connect(STANDBY_URL)
        try:
            primary_in_recovery = await primary.fetchval("SELECT pg_is_in_recovery()")
            standby_in_recovery = await standby.fetchval("SELECT pg_is_in_recovery()")
            assert primary_in_recovery is False
            assert standby_in_recovery is True
        finally:
            await primary.close()
            await standby.close()

    async def test_streaming_state_and_slot(self) -> None:
        """A WAL sender must be streaming to the standby, using a slot."""
        _require_urls()
        primary = await _connect(PRIMARY_URL)
        try:
            row = await _wait_for(
                lambda: primary.fetchrow(
                    """
                    SELECT state, sync_state, replay_lag
                      FROM pg_stat_replication
                     WHERE state = 'streaming'
                     LIMIT 1
                    """
                )
            )
            assert row is not None, "no WAL sender in 'streaming' state"
            slot = await primary.fetchrow(
                """
                SELECT slot_name, active, restart_lsn IS NOT NULL AS has_restart_lsn
                  FROM pg_replication_slots
                 WHERE slot_type = 'physical' AND active
                 LIMIT 1
                """
            )
            assert slot is not None, "no active physical replication slot"
            assert slot["active"] is True
            assert slot["has_restart_lsn"] is True
        finally:
            await primary.close()

    async def test_wal_replays_to_standby(self) -> None:
        """A committed write on the primary must become visible on the standby."""
        _require_urls()
        primary = await _connect(PRIMARY_URL)
        standby = await _connect(STANDBY_URL)
        table = f"repl_probe_{uuid.uuid4().hex[:12]}"
        try:
            await primary.execute(f"CREATE TABLE {table} (id int PRIMARY KEY, payload text)")  # noqa: S608
            await primary.execute(f"INSERT INTO {table} VALUES (1, 'veil')")  # noqa: S608

            seen = None
            for _ in range(POLL_ATTEMPTS):
                try:
                    seen = await standby.fetchval(f"SELECT payload FROM {table} WHERE id = 1")  # noqa: S608
                except asyncpg.UndefinedTableError:
                    seen = None
                if seen == "veil":
                    break
                await asyncio.sleep(POLL_INTERVAL)
            assert seen == "veil", "row never replayed to standby"

            wal_lsn = await standby.fetchval("SELECT pg_last_wal_replay_lsn()")
            assert wal_lsn is not None
        finally:
            await primary.execute(f"DROP TABLE IF EXISTS {table}")
            await primary.close()
            await standby.close()

    async def test_standby_is_read_only(self) -> None:
        """A standby must reject writes: failover authority is single and explicit."""
        _require_urls()
        standby = await _connect(STANDBY_URL)
        try:
            with pytest.raises(asyncpg.PostgresError, match="read-only|recovery"):
                await standby.execute(f"CREATE TABLE repl_ro_probe_{uuid.uuid4().hex[:8]} (id int)")
        finally:
            await standby.close()


class TestFailover:
    async def test_promotion_makes_standby_writable(self) -> None:
        """pg_promote() flips the standby into a writable primary (idempotent no-op after)."""
        _require_urls()
        standby = await _connect(STANDBY_URL)
        try:
            promoted = await standby.fetchval("SELECT pg_promote()")
            assert promoted is True

            in_recovery = None
            for _ in range(POLL_ATTEMPTS):
                in_recovery = await standby.fetchval("SELECT pg_is_in_recovery()")
                if not in_recovery:
                    break
                await asyncio.sleep(POLL_INTERVAL)
            assert in_recovery is False, "standby did not leave recovery mode"

            table = f"repl_post_promote_{uuid.uuid4().hex[:8]}"
            await standby.execute(f"CREATE TABLE {table} (id int)")  # noqa: S608
            await standby.execute(f"INSERT INTO {table} VALUES (42)")  # noqa: S608
            count = await standby.fetchval(f"SELECT count(*) FROM {table}")  # noqa: S608
            assert count == 1
            await standby.execute(f"DROP TABLE {table}")

            # A second promote is an error, not a no-op: authority moved already.
            with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError):
                await standby.fetchval("SELECT pg_promote()")
        finally:
            await standby.close()
