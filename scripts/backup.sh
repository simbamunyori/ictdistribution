#!/bin/sh
# Nightly backup of the database. Runs as the "backup" service in
# docker-compose.prod.yml:
#   backup.sh            one backup now
#   backup.sh --nightly  one backup every day at BACKUP_AT (UTC)
# Each backup is one file, ictd-<time>.dump(.enc): pg_dump's custom format,
# encrypted with BACKUP_PASSPHRASE. Restoring is in docs/deploy.md.
# With OFFSITE_S3_BUCKET and its access key set, each file is also copied
# off the server with rclone (remote "offsite", set up from
# RCLONE_CONFIG_OFFSITE_* in docker-compose.prod.yml), and off-site copies
# older than BACKUP_KEEP_DAYS are deleted there too. Without them, backups
# stay on the server only; that never stops a backup or a deploy.
# pipefail (busybox sh has it): a failing pg_dump fails the backup instead of
# leaving a short file behind.
set -euo pipefail

dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP_DAYS:-30}

# Off-site storage counts as set up once it has a bucket and an access key
# (a "local" remote, used by the CI rehearsal, needs no key).
offsite_on() {
  [ -n "${OFFSITE_S3_BUCKET:-}" ] || return 1
  [ "${RCLONE_CONFIG_OFFSITE_TYPE:-s3}" = "local" ] || [ -n "${RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID:-}" ]
}

backup() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  mkdir -p "$dir"
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    out="$dir/ictd-$stamp.dump.enc"
    pg_dump --format=custom "$DATABASE_URL" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$out.part"
  else
    echo "backup: BACKUP_PASSPHRASE is not set, so this backup is not encrypted" >&2
    out="$dir/ictd-$stamp.dump"
    pg_dump --format=custom --file="$out.part" "$DATABASE_URL"
  fi
  mv "$out.part" "$out"
  find "$dir" -maxdepth 1 -name 'ictd-*' -type f -mtime +"$keep" -delete
  echo "backup: wrote $out ($(du -h "$out" | cut -f1))"
  if offsite_on; then
    remote="offsite:$OFFSITE_S3_BUCKET/${OFFSITE_S3_PREFIX:-ictd}"
    rclone -q copy --no-traverse "$out" "$remote/"
    rclone -q delete --min-age "${keep}d" "$remote/" || echo "backup: could not prune old off-site copies" >&2
    echo "backup: copied off-site to $remote/$(basename "$out")"
  else
    echo "backup: off-site storage is not set up (OFFSITE_S3_* in .env), so this backup is on the server only"
  fi
}

if [ "${1:-}" != "--nightly" ]; then
  backup
  exit 0
fi

at=${BACKUP_AT:-23:30}
echo "backup: every day at $at UTC into $dir, keeping $keep days"
last=""
while true; do
  if [ "$(date -u +%H:%M)" = "$at" ] && [ "$(date -u +%F)" != "$last" ]; then
    last=$(date -u +%F)
    # Its own process, so any failing step stops that backup (set -e) but not the loop.
    "$0" || echo "backup: FAILED on $last" >&2
  fi
  sleep 20
done
