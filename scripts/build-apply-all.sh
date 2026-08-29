#!/usr/bin/env bash
# Regenerate supabase/apply-all.sql from the three source files.
# Strips psql meta-commands so the result pastes into the Supabase SQL editor.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=supabase/apply-all.sql
{
  cat <<'HDR'
-- =====================================================================
-- apply-all.sql  --  GENERATED, do not edit
--
-- The three migration files concatenated with psql-only commands
-- stripped, so the whole thing pastes into the Supabase SQL editor at
-- once. Edit the sources and re-run scripts/build-apply-all.sh.
--
-- ---------------------------------------------------------------------
-- THIS DROPS AND RECREATES employees, pda_balances AND bills.
-- Anything already in them is lost. Back up first.
-- ---------------------------------------------------------------------
-- =====================================================================
HDR

  for f in supabase/migrations/0001_schema.sql \
           supabase/migrations/0002_functions.sql \
           supabase/seed/0003_demo_data.sql; do
    printf '\n\n-- ###################################################################\n'
    printf -- '-- %s\n' "$f"
    printf -- '-- ###################################################################\n\n'
    grep -v '^[[:space:]]*\\' "$f"
  done
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
