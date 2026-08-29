#!/usr/bin/env bash
#
# Spin up a throwaway Postgres, build the schema, run the workflow tests,
# and optionally load the demo data. Nothing here touches Supabase, and
# the cluster lives in a temp directory you can delete.
#
#   ./scripts/db-local.sh test     schema + functions + the 44 assertions
#   ./scripts/db-local.sh seed     schema + functions + demo data, left running
#   ./scripts/db-local.sh psql     open a shell on the running cluster
#   ./scripts/db-local.sh stop     shut it down and delete it
#
set -euo pipefail

PORT=55999
SOCK=/tmp                       # short path: Postgres sockets cap at ~103 bytes
DATA="${TMPDIR:-/tmp}/ifmp-pgdata"
PSQL=(psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1)

# Homebrew keeps these off the default PATH.
for v in 17 16; do
  [ -d "/opt/homebrew/opt/postgresql@$v/bin" ] && \
    export PATH="/opt/homebrew/opt/postgresql@$v/bin:$PATH" && break
done

command -v initdb >/dev/null || {
  echo "Postgres not found. Install it with:  brew install postgresql@17" >&2
  exit 1
}

running() { pg_isready -h "$SOCK" -p "$PORT" -q 2>/dev/null; }

start() {
  if running; then return; fi
  rm -rf "$DATA"
  echo "==> starting a throwaway Postgres on port $PORT"
  initdb -D "$DATA" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$DATA" -o "-p $PORT -k $SOCK" -l "$DATA/log" start >/dev/null
  for _ in $(seq 1 20); do running && break; sleep 0.3; done
  running || { echo "Postgres would not start; see $DATA/log" >&2; exit 1; }
}

build() {
  echo "==> applying the schema"
  "${PSQL[@]}" -q -c 'drop schema if exists public cascade; create schema public;' >/dev/null
  "${PSQL[@]}" -q -f supabase/migrations/0001_schema.sql
  "${PSQL[@]}" -q -f supabase/migrations/0002_functions.sql
}

case "${1:-test}" in
  test)
    start; build
    echo "==> running the workflow tests"
    # Assertions announce themselves as NOTICEs; a failure aborts the file.
    "${PSQL[@]}" -q -f scripts/test_workflow.sql 2>&1 \
      | sed -n 's/^psql[^ ]* NOTICE:  /  /p; /ALL WORKFLOW/p; /FAIL/p'
    ;;

  seed)
    start; build
    echo "==> loading the demo data (this runs the real workflow, so it takes a moment)"
    "${PSQL[@]}" -q -f supabase/seed/0003_demo_data.sql
    echo
    echo "Cluster is still running. Inspect it with:  ./scripts/db-local.sh psql"
    ;;

  psql)
    running || { echo "Nothing running. Start it with:  ./scripts/db-local.sh seed" >&2; exit 1; }
    exec psql -h "$SOCK" -p "$PORT" -U postgres
    ;;

  stop)
    running && pg_ctl -D "$DATA" stop >/dev/null 2>&1 || true
    rm -rf "$DATA"
    echo "stopped and removed"
    ;;

  *)
    sed -n '3,12p' "$0" >&2
    exit 1
    ;;
esac
