#!/usr/bin/env bash
# Non-destructive, repeatable upgrade. Take a database backup first.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL=$(rg '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
fi
: "${DATABASE_URL:?Set DATABASE_URL to the database to upgrade}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0003_stock_entry.sql -f db/migrations/0004_integrity.sql -f db/migrations/0005_bill_form_review.sql
