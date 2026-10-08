#!/usr/bin/env bash
# Rehearses production on a scratch folder, with the real deploy scripts
# (run by CI on every change; needs Docker):
#   1. a first deploy onto an empty database, which adds the markets,
#      currencies and customer types;
#   2. inviting the first staff Admin from the command line;
#   3. a second deploy, which backs up first;
#   4. a release that never becomes healthy, which must roll back to (3);
#   5. a restore test from the off-site copy (a folder here, S3 in production);
#   6. a backup and restore test while off-site storage is not set up yet
#      (bucket named but no access key), which must stay on the server.
set -euo pipefail
cd "$(dirname "$0")/.."

home=$(mktemp -d)/ictd
mkdir -p "$home/incoming"
export ICTD_HOME=$home
cat > "$home/.env" <<ENV
APP_URL=https://ictd.example.test
DOMAIN=ictd.example.test
MAIL_FROM="ICT Distribution Africa <no-reply@example.test>"
SMTP_URL=smtp://mail.invalid:25
COMPANY_LEGAL_NAME="ICT Distribution Africa"
POSTGRES_PASSWORD=$(openssl rand -hex 16)
APP_SECRET=$(openssl rand -base64 32)
BACKUP_PASSPHRASE=$(openssl rand -hex 16)
RATE_SOURCE=off
OFFSITE_TYPE=local
OFFSITE_S3_BUCKET=/backups/offsite
ENV

step() { printf '\n== %s\n' "$*"; }
pack() { git archive --format=tar.gz -o "$home/incoming/$1.tar.gz" HEAD; }
live() { curl -fsS http://127.0.0.1:3100/api/health; }
dc() { docker compose -p ictd -f "$home/current/docker-compose.prod.yml" --env-file "$home/.env" "$@"; }
cleanup() { docker compose -p ictd -f docker-compose.prod.yml --env-file "$home/.env" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

step "1. First deploy onto an empty database"
pack one && bash deploy/deploy.sh one "$home/incoming/one.tar.gz"
live | grep -q '"release":"one"'
markets=$(dc exec -T db psql -U ictd -d ictd -tAc 'SELECT count(*) FROM "Market"')
[[ $markets -eq 3 ]] || { echo "expected the three launch markets, found $markets"; exit 1; }
# Product images are resized with sharp, whose native library must be in the image.
dc exec -T app node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#000'}}).webp().toBuffer().then((b)=>console.log('sharp resizes images', b.length))" | grep -q "sharp resizes images"

step "2. Invite the first staff Admin"
dc exec -T app node ops.cjs create-admin "Rehearsal Admin" admin@example.test | tee "$home/admin.log"
grep -q "https://ictd.example.test/admin/invite/" "$home/admin.log"
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3100$(grep -o '/admin/invite/[A-Za-z0-9_-]*' "$home/admin.log")" | grep -q 200

step "3. Second deploy (backs up first)"
pack two && bash deploy/deploy.sh two "$home/incoming/two.tar.gz"
live | grep -q '"release":"two"'
ls "$home/backups" | grep -q '^ictd-' || { echo "no backup was taken before the second deploy"; exit 1; }

step "4. A release that never becomes healthy rolls back"
work=$(mktemp -d) && git archive HEAD | tar -x -C "$work"
echo 'CMD ["sh", "-c", "echo broken on purpose; exit 1"]' >> "$work/Dockerfile"
tar -czf "$home/incoming/broken.tar.gz" -C "$work" . && rm -rf "$work"
if bash deploy/deploy.sh broken "$home/incoming/broken.tar.gz"; then echo "the broken release was reported healthy"; exit 1; fi
live | grep -q '"release":"two"'
[[ $(cat "$home/current-release") == two ]]

step "5. Restore test from the off-site copy"
bash deploy/ictd restore-test | tee "$home/restore.log"
grep -q "restore-test: OK" "$home/restore.log"
grep -q "markets 3," "$home/restore.log"

step "6. Backups stay on the server while off-site storage is not set up"
no_offsite=(-e RCLONE_CONFIG_OFFSITE_TYPE=s3 -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID= -e OFFSITE_S3_BUCKET=ictd-backups)
dc run --rm "${no_offsite[@]}" backup /backup.sh | tee "$home/local.log"
grep -q "on the server only" "$home/local.log"
dc run --rm "${no_offsite[@]}" backup /restore-test.sh | tee "$home/local-restore.log"
grep -q "testing the copy on the server" "$home/local-restore.log"
grep -q "restore-test: OK" "$home/local-restore.log"

step "Rehearsal passed"
