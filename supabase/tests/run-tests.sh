#!/usr/bin/env bash
# =============================================================================
# Runs the SQL regression suite against a throwaway PostgreSQL cluster.
#
#   ./supabase/tests/run-tests.sh
#
# Requires PostgreSQL server binaries (initdb, pg_ctl, psql) on PATH or under
# /usr/lib/postgresql/*/bin. Nothing touches your Supabase project.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
PGPORT="${PGPORT:-55432}"

if ! command -v initdb >/dev/null 2>&1; then
  for candidate in /usr/lib/postgresql/*/bin; do
    [ -x "$candidate/initdb" ] && export PATH="$candidate:$PATH" && break
  done
fi

command -v initdb >/dev/null 2>&1 || {
  echo "error: PostgreSQL server binaries not found (initdb)." >&2
  exit 1
}

cleanup() {
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$PGDATA" "$SOCKDIR"
initdb -D "$PGDATA" -A trust -U postgres >/dev/null
pg_ctl -D "$PGDATA" -o "-k $SOCKDIR -p $PGPORT -c listen_addresses=" -l "$WORKDIR/pg.log" start -w >/dev/null

export PGHOST="$SOCKDIR" PGPORT PGUSER=postgres PGDATABASE=postgres

echo "==> applying Supabase stub"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_supabase_stub.sql"

echo "==> applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -f "$migration"
done

echo "==> running tests"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/rls_and_analytics_test.sql"
