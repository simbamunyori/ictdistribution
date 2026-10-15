#!/usr/bin/env bash
# Puts the site live in one go. Run it once from your own computer, inside a
# checkout of this repository, with the GitHub CLI signed in (gh auth login)
# and SSH access to the server as root. Safe to run again: every step checks
# what is already done. See docs/deploy.md.
#
#   deploy/go-live.sh SERVER you@ictdistribution.africa "Your Name"
#
# It waits for DNS, sets up the server, asks for the mail settings (and
# optionally the Claude key and off-site backup keys), adds the GitHub
# secrets, runs the first deploy and invites you as the first Admin.
set -euo pipefail

usage() {
  echo "Usage: deploy/go-live.sh SERVER ADMIN_EMAIL \"ADMIN NAME\""
  echo "  SERVER       the server's IP address"
  echo "  ADMIN_EMAIL  your work email; the first Admin invitation goes there"
  echo "  ADMIN NAME   your name, in quotes"
  echo "Set SSH_PORT if SSH on the server is not on port 22."
}
[[ ${1:-} == "-h" || ${1:-} == "--help" ]] && { usage; exit 0; }
[[ $# -eq 3 ]] || { usage; exit 1; }

SERVER=$1
ADMIN_EMAIL=$2
ADMIN_NAME=$3
SSH_PORT=${SSH_PORT:-22}
REPO=${REPO:-simbamunyori/ictdistribution}
DOMAIN=${DOMAIN:-ictdistribution.africa}
ENV_FILE=/opt/ictd/.env

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
remote() { ssh -p "$SSH_PORT" -o ConnectTimeout=15 "root@$SERVER" "$@"; }

cd "$(dirname "$0")/.."

say "1/7 Checking what this needs"
command -v gh >/dev/null || fail "Install the GitHub CLI first: https://cli.github.com"
gh auth status >/dev/null 2>&1 || fail "Sign in to GitHub first: gh auth login"
gh repo view "$REPO" >/dev/null || fail "Your GitHub account can't see $REPO."
command -v dig >/dev/null || command -v host >/dev/null || fail "Install dig (dnsutils or bind-utils) first."
remote true || fail "Can't sign in as root@$SERVER over SSH (port $SSH_PORT). Fix that first."
echo "GitHub and SSH work."

say "2/7 DNS"
resolve() {
  if command -v dig >/dev/null; then dig +short A "$1" @1.1.1.1 | tail -n1
  else host -t A "$1" 1.1.1.1 | awk '/has address/ {print $4}' | tail -n1; fi
}
waited=0
until [[ $(resolve "$DOMAIN") == "$SERVER" && $(resolve "www.$DOMAIN") == "$SERVER" ]]; do
  if [[ $waited -eq 0 ]]; then
    echo "At the registrar for $DOMAIN, add these two records:"
    echo "  @    A    $SERVER"
    echo "  www  A    $SERVER"
    echo "Waiting for them to appear (Ctrl+C to stop; run this again later)."
  fi
  sleep 30
  waited=$((waited + 30))
  [[ $waited -ge 3600 ]] && fail "DNS still doesn't point at $SERVER after an hour. Check the records, then run this again."
done
echo "$DOMAIN and www.$DOMAIN point at $SERVER."

say "3/7 The server"
scp -q -P "$SSH_PORT" deploy/server-setup.sh deploy/apache-ictd.conf "root@$SERVER:/root/"
# Its last part prints the GitHub secrets for adding by hand; this adds them itself.
remote 'REPO_RAW=file:///root bash /root/server-setup.sh' | awk '/^Add these at GitHub/ { stop = 1 } !stop'
# Keeps every other line of .env as it is; the value comes in on stdin so
# passwords never appear in a command line.
remote "cat > /root/ictd-set-env.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
f=/opt/ictd/.env
K=$1 V=$(cat) awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
  index($0, k "=") == 1 { print k "=" v; done = 1; next }
  { print }
  END { if (!done) print k "=" v }' "$f" > "$f.new"
cat "$f.new" > "$f"
rm -f "$f.new"
SH
is_set() { remote "grep -qE '^$1=.+' $ENV_FILE"; }
set_env() { printf '%s' "$2" | remote "bash /root/ictd-set-env.sh $1"; }
# Percent-encodes a user name or password for a mail URL.
urlencode() {
  local s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in [a-zA-Z0-9.~_-]) out+=$c ;; *) out+=$(printf '%%%02X' "'$c") ;; esac
  done
  printf '%s' "$out"
}
changed=no

say "4/7 Settings"
if is_set SMTP_URL; then
  echo "Mail is set already."
else
  echo "Sign-in codes go out by email, so the site needs a mailbox to send from."
  read -rp "Mail server (e.g. mail.$DOMAIN): " smtp_host
  read -rp "Port [465]: " smtp_port
  smtp_port=${smtp_port:-465}
  read -rp "User name [no-reply@$DOMAIN]: " smtp_user
  smtp_user=${smtp_user:-no-reply@$DOMAIN}
  read -rsp "Password: " smtp_pass
  echo
  scheme=smtp
  [[ $smtp_port == 465 ]] && scheme=smtps
  set_env SMTP_URL "$scheme://$(urlencode "$smtp_user"):$(urlencode "$smtp_pass")@$smtp_host:$smtp_port"
  set_env MAIL_FROM "\"ICT Distribution Africa <$smtp_user>\""
  changed=yes
fi
if ! is_set ANTHROPIC_API_KEY; then
  echo "Optional: a Claude API key lets Claude read quote requests and answer the site assistant."
  echo "Make one at https://platform.claude.com under API keys. Press Enter to skip."
  read -rsp "Claude API key: " key
  echo
  [[ -n $key ]] && { set_env ANTHROPIC_API_KEY "$key"; changed=yes; }
fi
if ! is_set OFFSITE_S3_ACCESS_KEY_ID; then
  echo "Optional, but needed before real customers: off-site backups."
  echo "In the Contabo panel: Object Storage > Create bucket 'ictd-backups', then Credentials. Press Enter to skip."
  read -rp "Object storage access key: " s3_key
  if [[ -n $s3_key ]]; then
    read -rsp "Object storage secret key: " s3_secret
    echo
    read -rp "Endpoint [https://eu2.contabostorage.com]: " s3_endpoint
    set_env OFFSITE_S3_ACCESS_KEY_ID "$s3_key"
    set_env OFFSITE_S3_SECRET_ACCESS_KEY "$s3_secret"
    set_env OFFSITE_S3_ENDPOINT "${s3_endpoint:-https://eu2.contabostorage.com}"
    changed=yes
  fi
fi

say "5/7 GitHub secrets"
host_key=$(remote "awk '{print \$1\" \"\$2}' /etc/ssh/ssh_host_ed25519_key.pub")
if [[ $SSH_PORT == 22 ]]; then known="$SERVER $host_key"; else known="[$SERVER]:$SSH_PORT $host_key"; fi
gh secret set DEPLOY_HOST -R "$REPO" --body "$SERVER"
gh secret set DEPLOY_KNOWN_HOSTS -R "$REPO" --body "$known"
remote cat /home/deploy/.ssh/github_actions_ictd | gh secret set DEPLOY_SSH_KEY -R "$REPO"
[[ $SSH_PORT != 22 ]] && gh secret set DEPLOY_PORT -R "$REPO" --body "$SSH_PORT"
echo "Secrets set."

say "6/7 Deploying"
if remote 'test -L /opt/ictd/current'; then
  echo "The site is deployed already."
  if [[ $changed == yes ]]; then
    remote 'sudo -u deploy ictd restart'
    echo "Restarted with the new settings."
  fi
else
  before=$(gh run list -R "$REPO" -w deploy.yml -L 1 --json databaseId -q '.[0].databaseId // 0')
  gh workflow run deploy.yml -R "$REPO" --ref main
  run=$before
  while [[ $run == "$before" ]]; do
    sleep 5
    run=$(gh run list -R "$REPO" -w deploy.yml -L 1 --json databaseId -q '.[0].databaseId // 0')
  done
  if ! gh run watch "$run" -R "$REPO" --exit-status; then
    gh run view "$run" -R "$REPO" --log-failed | tail -n 40
    fail "The deploy failed; the lines above say why. Fix it, then run this again."
  fi
fi

say "7/7 The first Admin"
if remote 'test -f /opt/ictd/.first-admin-invited'; then
  echo "An Admin was invited already. More at https://$DOMAIN/admin/staff"
else
  remote "sudo -u deploy ictd create-admin $(printf '%q' "$ADMIN_NAME") $(printf '%q' "$ADMIN_EMAIL")"
  remote "echo $(printf '%q' "$ADMIN_EMAIL") > /opt/ictd/.first-admin-invited"
fi

remote 'rm -f /root/ictd-set-env.sh'
say "Done. https://$DOMAIN is live."
cat <<NEXT
Open the invitation sent to $ADMIN_EMAIL on the device you work on and add a
passkey. Then set up the business in the admin area (docs/deploy.md, "After
going live"). Keep BACKUP_PASSPHRASE from $ENV_FILE in your password manager:
  ssh root@$SERVER "grep BACKUP_PASSPHRASE $ENV_FILE"
NEXT
