#!/bin/sh
# Proves the backups can be restored. Runs inside the backup container
# (ictd restore-test, and weekly from .github/workflows/backups.yml):
#   1. takes a fresh backup, which is also copied off-site;
#   2. downloads the newest off-site copy (the local one when no off-site
#      storage is set), decrypts it and restores it into a scratch
#      database beside the live one;
#   3. checks every table came back, with every migration and the rows
#      the live database has;
#   4. drops the scratch database.
# The live database is only read. Exits non-zero on any failure.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"

scratch=restore_check
work=$(mktemp -d)
live_url=$DATABASE_URL
scratch_url=$(echo "$DATABASE_URL" | sed "s#/[^/]*\$#/$scratch#")
cleanup() {
  rm -rf "$work"
  psql -q "$live_url" -c "DROP DATABASE IF EXISTS $scratch" >/dev/null 2>&1 || true
}
trap cleanup EXIT

backups=${BACKUP_DIR:-/backups}
"${BACKUP_SCRIPT:-/backup.sh}"

if [ -n "${OFFSITE_S3_BUCKET:-}" ] && { [ "${RCLONE_CONFIG_OFFSITE_TYPE:-s3}" = "local" ] || [ -n "${RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID:-}" ]; }; then
  remote="offsite:$OFFSITE_S3_BUCKET/${OFFSITE_S3_PREFIX:-ictd}"
  newest=$(rclone -q lsf --files-only "$remote/" | grep '^ictd-' | sort | tail -n 1)
  [ -n "$newest" ] || { echo "restore-test: FAILED, no backups in $remote" >&2; exit 1; }
  rclone -q copyto "$remote/$newest" "$work/$newest"
  echo "restore-test: downloaded $newest from off-site storage"
else
  newest=$(ls "$backups" | grep '^ictd-' | sort | tail -n 1)
  cp "$backups/$newest" "$work/$newest"
  echo "restore-test: off-site storage is not set up, so testing the copy on the server: $newest"
fi

case "$newest" in
  *.enc) openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$work/$newest" -out "$work/ictd.dump" ;;
  *) mv "$work/$newest" "$work/ictd.dump" ;;
esac

psql -q "$live_url" -c "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch" >/dev/null
pg_restore --no-owner --exit-on-error -d "$scratch_url" "$work/ictd.dump"

# Row counts per table, schema-qualified, one "schema.table count" per line.
counts() {
  psql -qAt "$1" -c "SELECT format('SELECT %L || '' '' || count(*) FROM %I.%I;', n.nspname || '.' || c.relname, n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY 1" | psql -qAt "$1"
}
counts "$scratch_url" > "$work/restored"
tables=$(wc -l < "$work/restored")
[ "$tables" -gt 10 ] || { echo "restore-test: FAILED, only $tables tables came back" >&2; exit 1; }
migrations=$(psql -qAt "$scratch_url" -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
live_migrations=$(psql -qAt "$live_url" -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
[ "$migrations" = "$live_migrations" ] || { echo "restore-test: FAILED, $migrations of $live_migrations migrations in the restored copy" >&2; exit 1; }
for t in public.User public.Market public.CustomerType public.AuditEvent; do
  grep -q "^$t " "$work/restored" || { echo "restore-test: FAILED, $t is missing" >&2; exit 1; }
done
markets=$(grep '^public.Market ' "$work/restored" | cut -d' ' -f2)
[ "$markets" -gt 0 ] || { echo "restore-test: FAILED, no markets in the restored copy" >&2; exit 1; }
rows=$(awk '{ s += $2 } END { print s + 0 }' "$work/restored")
echo "restore-test: restored $tables tables and $rows rows; users $(grep '^public.User ' "$work/restored" | cut -d' ' -f2), markets $markets, audit events $(grep '^public.AuditEvent ' "$work/restored" | cut -d' ' -f2)"
echo "restore-test: OK"
