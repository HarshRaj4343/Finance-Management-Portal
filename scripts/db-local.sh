#!/usr/bin/env bash
# Isolated test cluster. Never reuses or drops an existing database.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-test}" = test ] || { echo "Usage: $0 test" >&2; exit 1; }
for v in 17 16; do
  if [ -d "/opt/homebrew/opt/postgresql@$v/bin" ]; then export PATH="/opt/homebrew/opt/postgresql@$v/bin:$PATH"; break; fi
done
command -v initdb >/dev/null || { echo "Install PostgreSQL 17 to run database tests." >&2; exit 1; }
TEST_ROOT=$(mktemp -d /tmp/ifmp-tests.XXXXXX)
TEST_PORT="${IFMP_TEST_PORT:-55999}"
cleanup() { pg_ctl -D "$TEST_ROOT/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
initdb -D "$TEST_ROOT/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$TEST_ROOT/data" -o "-p $TEST_PORT -k $TEST_ROOT -h 127.0.0.1" -l "$TEST_ROOT/log" start >/dev/null
PSQL=(psql -h "$TEST_ROOT" -p "$TEST_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f db/migrations/0001_schema.sql -f db/migrations/0002_functions.sql -f db/migrations/0003_stock_entry.sql
"${PSQL[@]}" -f tests/migration-fixture.sql -f db/migrations/0004_integrity.sql -f db/migrations/0005_bill_form_review.sql -f db/migrations/0006_edit_window.sql -f db/migrations/0007_fund_heads.sql -f db/migrations/0008_movement_registers.sql -f db/migrations/0009_edit_pause_and_receipts.sql -f db/migrations/0010_send_back.sql
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$TEST_PORT/postgres" npm test
echo "Stopped isolated cluster. Diagnostic files retained at $TEST_ROOT."
