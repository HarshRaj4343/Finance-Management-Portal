#!/usr/bin/env bash
#
# Back up the portal's database.
#
#   ./scripts/db-backup.sh                 -> backups/ifmp-YYYYmmdd-HHMM.sql.gz
#   ./scripts/db-backup.sh /mnt/backups    -> writes there instead
#
# The purchase register and the event log are the institute's financial
# record and exist in exactly one place: the `pgdata` volume on this
# machine. Run this from cron, daily, and copy the output somewhere else:
#
#   0 2 * * *  cd /srv/ifmp && ./scripts/db-backup.sh >> /var/log/ifmp-backup.log 2>&1
#
# Restore (DESTROYS what is there now):
#   gunzip -c backups/ifmp-<stamp>.sql.gz | docker compose exec -T db psql -U ifmp -d ifmp
#
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR=${1:-backups}
KEEP=${KEEP:-30}                       # how many backups to retain
STAMP=$(date +%Y%m%d-%H%M)
FILE="$OUT_DIR/ifmp-$STAMP.sql.gz"

mkdir -p "$OUT_DIR"

if docker compose ps db --status running 2>/dev/null | grep -q db; then
  # The deployed shape: the database is inside the compose network and
  # publishes no port, so dump through the container.
  docker compose exec -T db pg_dump -U ifmp -d ifmp --clean --if-exists | gzip > "$FILE"
elif [ -n "${DATABASE_URL:-}" ] || grep -qE '^DATABASE_URL=' .env 2>/dev/null; then
  [ -n "${DATABASE_URL:-}" ] || DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)
  pg_dump "$DATABASE_URL" --clean --if-exists | gzip > "$FILE"
else
  echo "No running db container and no DATABASE_URL: nothing to back up." >&2
  exit 1
fi

# A dump that cannot be read back is not a backup.
gzip -t "$FILE"
SIZE=$(wc -c < "$FILE" | tr -d ' ')
if [ "$SIZE" -lt 1000 ]; then
  echo "Backup $FILE is only $SIZE bytes -- that is not a real dump." >&2
  exit 1
fi

# Keep the last $KEEP, delete older ones.
ls -1t "$OUT_DIR"/ifmp-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
done

echo "wrote $FILE ($((SIZE / 1024)) KB)"
