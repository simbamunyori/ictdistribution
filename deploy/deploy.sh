#!/usr/bin/env bash
# Puts one release live on the production server. Run by the deploy user,
# over SSH from .github/workflows/deploy.yml, after CI passed on main:
#
#   deploy.sh <release> <source.tar.gz>
#
# 1. unpacks the source into /opt/ictd/releases/<release>;
# 2. builds the image ictd:<release> (the running app keeps serving);
# 3. takes a backup of the database (not on the very first deploy);
# 4. applies database migrations and adds first-start reference data;
# 5. starts the new release and waits for /api/health to report it;
# 6. if it doesn't come up healthy, starts the previous release again and fails.
set -euo pipefail

release=${1:?release}
source_tgz=${2:?source tarball}
home=${ICTD_HOME:-/opt/ictd}
dir="$home/releases/$release"
health=http://127.0.0.1:3100/api/health
say() { echo "deploy: $*"; }

[[ -f "$home/.env" ]] || { say "no $home/.env: follow docs/deploy.md first"; exit 1; }
mkdir -p "$home/releases" "$home/backups"
rm -rf "$dir" && mkdir -p "$dir"
tar -xzf "$source_tgz" -C "$dir"
rm -f "$source_tgz"
ln -sfn "$home/.env" "$dir/.env"
ln -sfn "$home/backups" "$dir/backups"
cd "$dir"

compose() { RELEASE="$1" docker compose -p ictd -f "$home/releases/$1/docker-compose.prod.yml" --env-file "$home/.env" "${@:2}"; }
previous=$(cat "$home/current-release" 2>/dev/null || true)

say "building $release"
docker build --quiet -t "ictd:$release" . >/dev/null
compose "$release" build --quiet backup

compose "$release" up -d --wait db
if [[ -n "$previous" ]]; then
  say "backing up before the change"
  compose "$release" run --rm backup /backup.sh
fi

say "applying migrations"
compose "$release" run --rm migrate

healthy() {
  local want=$1
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 "$health" 2>/dev/null | grep -q "\"release\":\"$want\""; then return 0; fi
    sleep 3
  done
  return 1
}

say "starting $release"
compose "$release" up -d --remove-orphans app backup
if healthy "$release"; then
  echo "$release" > "$home/current-release"
  ln -sfn "$dir" "$home/current"
  say "$release is live"
  # Keep the last five releases and their images for rolling back by hand.
  for old in $(ls -1t "$home/releases" | tail -n +6); do
    rm -rf "${home:?}/releases/$old"
    docker image rm "ictd:$old" >/dev/null 2>&1 || true
  done
  docker image prune -f >/dev/null
  exit 0
fi

say "$release did not become healthy. Its last log lines:"
compose "$release" logs --tail 80 app || true
if [[ -n "$previous" && -d "$home/releases/$previous" ]]; then
  say "rolling back to $previous"
  compose "$previous" up -d --remove-orphans app backup
  if healthy "$previous"; then
    say "rolled back: $previous is live again"
  else
    say "the rollback did not become healthy either; look at: docker compose -p ictd logs app"
  fi
else
  say "no earlier release to go back to"
fi
exit 1
