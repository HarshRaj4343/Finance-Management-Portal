#!/usr/bin/env bash
# Fresh EMPTY database only. Existing databases: npm run db:upgrade.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL=$(rg '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
fi
: "${DATABASE_URL:?Set DATABASE_URL to an existing empty database}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
if [ "$("${PSQL[@]}" -tA -c "select exists(select 1 from pg_tables where schemaname='public')")" = t ]; then
  echo "Refusing to rebuild a database containing tables. Back up and run npm run db:upgrade." >&2
  exit 1
fi
"${PSQL[@]}" --single-transaction -f db/migrations/0001_schema.sql -f db/migrations/0002_functions.sql -f db/migrations/0003_stock_entry.sql
"${PSQL[@]}" -f db/migrations/0004_integrity.sql -f db/migrations/0005_bill_form_review.sql -f db/migrations/0006_edit_window.sql -f db/migrations/0007_fund_heads.sql -f db/migrations/0008_movement_registers.sql -f db/migrations/0009_edit_pause_and_receipts.sql -f db/migrations/0010_send_back.sql
echo "Schema ready. Configure LDAP and provision the first Dean (README.md)."
