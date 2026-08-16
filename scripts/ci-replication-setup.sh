#!/usr/bin/env bash
# Provision a primary + streaming-standby PostgreSQL pair for the
# `-m replication` test suite. Used by CI (see .github/workflows/ci.yml);
# also runnable on any Linux host with the postgresql package installed.
#
#   scripts/ci-replication-setup.sh
#
# Creates: primary on 127.0.0.1:55432, standby on 127.0.0.1:55433 (both
# trust-auth, user `postgres`), plus a physical replication slot
# `veildrop_repl_slot`. Then sets the env vars the tests read:
#
#   VEILDROP_REPL_PRIMARY_URL=postgresql://postgres@127.0.0.1:55432/veildrop
#   VEILDROP_REPL_STANDBY_URL=postgresql://postgres@127.0.0.1:55433/veildrop
#
# The pair lives under /tmp/veildrop-repl-* and is destroyed on reboot.
set -euo pipefail

PRIMARY_PORT=55432
STANDBY_PORT=55433
BASE=/tmp/veildrop-repl
PRIMARY_DIR=$BASE/primary
STANDBY_DIR=$BASE/standby

if [ -d "$BASE" ]; then
  echo "[repl] cleaning previous pair"
  rm -rf "$BASE"
fi
mkdir -p "$BASE"

if command -v pg_ctl >/dev/null 2>&1; then
  PG_BIN=$(dirname "$(command -v pg_ctl)")
else
  PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
fi
if [ -z "${PG_BIN:-}" ]; then
  echo "[repl] ERROR: no PostgreSQL binaries found (install postgresql)" >&2
  exit 1
fi
echo "[repl] using $PG_BIN"

run_as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u postgres env PATH="$PG_BIN:$PATH" HOME=/var/lib/postgresql "$@"
  else
    "$@"
  fi
}

echo "[repl] initdb primary"
run_as_postgres "$PG_BIN/initdb" -D "$PRIMARY_DIR" -U postgres --auth=trust -E UTF8
echo "port = $PRIMARY_PORT" >> "$PRIMARY_DIR/postgresql.conf"
echo "wal_level = replica" >> "$PRIMARY_DIR/postgresql.conf"
echo "max_wal_senders = 4" >> "$PRIMARY_DIR/postgresql.conf"
echo "max_replication_slots = 4" >> "$PRIMARY_DIR/postgresql.conf"
echo "listen_addresses = '127.0.0.1'" >> "$PRIMARY_DIR/postgresql.conf"

echo "[repl] start primary"
run_as_postgres "$PG_BIN/pg_ctl" -D "$PRIMARY_DIR" -l "$BASE/primary.log" start >/dev/null
sleep 1
run_as_postgres "$PG_BIN/createdb" -h 127.0.0.1 -p "$PRIMARY_PORT" -U postgres veildrop

echo "[repl] pg_basebackup -> standby (creates slot, -R for standby.signal)"
run_as_postgres "$PG_BIN/pg_basebackup" \
  -h 127.0.0.1 -p "$PRIMARY_PORT" -U postgres \
  -D "$STANDBY_DIR" -X stream -C -S veildrop_repl_slot -R
echo "port = $STANDBY_PORT" >> "$STANDBY_DIR/postgresql.conf"
echo "listen_addresses = '127.0.0.1'" >> "$STANDBY_DIR/postgresql.conf"

echo "[repl] start standby"
run_as_postgres "$PG_BIN/pg_ctl" -D "$STANDBY_DIR" -l "$BASE/standby.log" start >/dev/null

echo "[repl] waiting for streaming state..."
for _ in $(seq 1 60); do
  STATE=$(run_as_postgres "$PG_BIN/psql" -h 127.0.0.1 -p "$PRIMARY_PORT" -U postgres -d veildrop \
    -tAc "SELECT state FROM pg_stat_replication WHERE application_name = 'walreceiver'" 2>/dev/null || true)
  if [ "$STATE" = "streaming" ]; then
    echo "[repl] streaming OK"
    break
  fi
  sleep 1
done
if [ "$STATE" != "streaming" ]; then
  echo "[repl] ERROR: standby never reached streaming state" >&2
  cat "$BASE/standby.log" >&2 || true
  exit 1
fi

export VEILDROP_REPL_PRIMARY_URL="postgresql://postgres@127.0.0.1:$PRIMARY_PORT/veildrop"
export VEILDROP_REPL_STANDBY_URL="postgresql://postgres@127.0.0.1:$STANDBY_PORT/veildrop"
echo "[repl] VEILDROP_REPL_PRIMARY_URL=$VEILDROP_REPL_PRIMARY_URL"
echo "[repl] VEILDROP_REPL_STANDBY_URL=$VEILDROP_REPL_STANDBY_URL"

if [ -n "${REPL_ENV_FILE:-}" ]; then
  echo "VEILDROP_REPL_PRIMARY_URL=$VEILDROP_REPL_PRIMARY_URL" >> "$REPL_ENV_FILE"
  echo "VEILDROP_REPL_STANDBY_URL=$VEILDROP_REPL_STANDBY_URL" >> "$REPL_ENV_FILE"
  echo "[repl] exported to $REPL_ENV_FILE"
fi
echo "[repl] ready: export both variables, then run: python -m pytest -m replication"
