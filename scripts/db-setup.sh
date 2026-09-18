#!/usr/bin/env bash
#
# Build the portal's database on the Postgres named by DATABASE_URL.
#
#   ./scripts/db-setup.sh          create the database if needed, apply the
#                                  schema and functions, load the demo data
#   ./scripts/db-setup.sh --no-seed   the same, without the demo data
#
# DATABASE_URL is read from the environment, or from .env if it is not set.
#
# 0001_schema.sql drops the tables it creates, so this REBUILDS the
# database from scratch. It refuses to run over a database that already
# holds bills unless FORCE=1 is set.
#
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=1
for arg in "$@"; do
  case "$arg" in
    --no-seed) SEED=0 ;;
    *) sed -n '3,14p' "$0" >&2; exit 1 ;;
  esac
done

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (and not found in .env)." >&2
  echo "Example: DATABASE_URL=postgres://localhost:5432/ifmp" >&2
  exit 1
fi

command -v psql >/dev/null || {
  echo "psql not found. Install Postgres with:  brew install postgresql@17" >&2
  exit 1
}

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
# "table does not exist, skipping" on a first run is noise, not news.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

# Create the database itself if it does not exist yet, by connecting to the
# server's maintenance database with the same credentials.
DB_NAME=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^/]*/([^?]*).*#\1#')
ADMIN_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#^([a-z]+://[^/]*/)[^?]*#\1postgres#')
if ! psql "$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; then
  echo "==> creating database \"$DB_NAME\""
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "create database \"$DB_NAME\""
fi

BILLS=0
if [ "$("${PSQL[@]}" -tA -c "select to_regclass('public.bills') is not null")" = "t" ]; then
  BILLS=$("${PSQL[@]}" -tA -c "select count(*) from public.bills")
fi
if [ "$BILLS" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "\"$DB_NAME\" already holds $BILLS bills. Rebuilding would delete them." >&2
  echo "Run again with FORCE=1 if that is what you want." >&2
  exit 1
fi

echo "==> applying the schema"
"${PSQL[@]}" -f db/migrations/0001_schema.sql
echo "==> applying the workflow functions"
"${PSQL[@]}" -f db/migrations/0002_functions.sql

if [ "$SEED" = 1 ]; then
  echo "==> loading the demo data (this runs the real workflow, so it takes a moment)"
  "${PSQL[@]}" -f db/seed/0003_demo_data.sql
fi

echo "done: $("${PSQL[@]}" -tA -c "select count(*) || ' employees, ' || (select count(*) from public.bills) || ' bills' from public.employees")"
