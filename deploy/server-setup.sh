#!/usr/bin/env bash
# One-time set-up of the production server (Ubuntu 24.04 with Apache, the
# same Contabo server as Cloud Console). Run as root; safe to run again.
# See docs/deploy.md.
#
#   scp deploy/server-setup.sh deploy/apache-ictd.conf root@SERVER:/root/
#   ssh root@SERVER 'REPO_RAW=file:///root bash /root/server-setup.sh'
#
# It installs Docker if needed, makes sure the "deploy" user GitHub Actions
# signs in as exists, writes /opt/ictd/.env with fresh secrets (you fill in
# the rest), adds the Apache site and its certificate, and prints the
# GitHub secrets to add.
set -euo pipefail

DOMAIN=${DOMAIN:-ictdistribution.africa}
REPO_RAW=${REPO_RAW:-https://raw.githubusercontent.com/simbamunyori/ictdistribution/main}
HOME_DIR=/opt/ictd
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[[ $(id -u) -eq 0 ]] || { echo "Run this as root (sudo)."; exit 1; }

say "1/6 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
docker compose version

say "2/6 The deploy user"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# Its own key, separate from Cloud Console's, so either can be revoked alone.
if [[ ! -f /home/deploy/.ssh/github_actions_ictd ]]; then
  sudo -u deploy ssh-keygen -q -t ed25519 -N '' -C "github-actions@ictdistribution" -f /home/deploy/.ssh/github_actions_ictd
fi
pub=$(cat /home/deploy/.ssh/github_actions_ictd.pub)
touch /home/deploy/.ssh/authorized_keys
grep -qF "$pub" /home/deploy/.ssh/authorized_keys || echo "no-port-forwarding,no-X11-forwarding,no-agent-forwarding $pub" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
if sshd -T 2>/dev/null | grep -qiE '^allowusers '; then
  echo "NOTE: sshd has AllowUsers set. Add deploy to it in /etc/ssh/sshd_config, then: systemctl reload ssh"
fi

say "3/6 /opt/ictd and its settings"
install -d -o deploy -g deploy "$HOME_DIR" "$HOME_DIR/releases" "$HOME_DIR/backups" "$HOME_DIR/incoming"
if [[ ! -f $HOME_DIR/.env ]]; then
  cat > "$HOME_DIR/.env" <<ENV
# Production settings for ICT Distribution. Fill in every line marked
# FILL IN, then save. Never commit or share this file. docs/deploy.md
# explains each.

# The public address. Passkeys belong to this host: don't change it later.
APP_URL=https://$DOMAIN
DOMAIN=$DOMAIN

# Made by server-setup.sh. Leave as they are.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -base64 32)
# Encrypts every backup. Also keep a copy in your password manager:
# without it no backup can be restored.
BACKUP_PASSPHRASE=$(openssl rand -hex 32)

# FILL IN: the mail server sign-in codes are sent from, e.g.
# smtps://user:password@mail.ictdistribution.africa:465
SMTP_URL=
MAIL_FROM="ICT Distribution Africa <no-reply@$DOMAIN>"

# The legal entity that trades, shown in the footer and emails
# (docs/ICTD_BUILD.md, decision 1). Change it once decided.
COMPANY_LEGAL_NAME="ICT Distribution Africa"

# Optional: sign in with Microsoft and Google (docs/sign-in-setup.md).
# The buttons stay hidden while these are empty.
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_STAFF_TENANT_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional: automated quotations (docs/quotes.md). Claude reads requests
# and supplier replies when ANTHROPIC_API_KEY is set; rules read them
# otherwise. IMAP_URL lets customers email requests to QUOTES_EMAIL and
# suppliers reply to it, e.g.
# imaps://quotes%40$DOMAIN:password@mail.$DOMAIN:993
ANTHROPIC_API_KEY=
QUOTES_EMAIL=quotes@$DOMAIN
IMAP_URL=

# Exchange rates, fetched every six hours (docs/exchange-rates.md).
RATE_SOURCE=open-er-api

# Optional until real customer data goes in: off-site backup storage (any
# S3-compatible storage). While the access key is empty, nightly backups
# stay on this server only and everything else works.
# Contabo Object Storage: OFFSITE_S3_PROVIDER=Other and the endpoint from
# the Object Storage panel (for example https://eu2.contabostorage.com).
OFFSITE_S3_PROVIDER=Other
OFFSITE_S3_ENDPOINT=https://eu2.contabostorage.com
OFFSITE_S3_BUCKET=ictd-backups
OFFSITE_S3_ACCESS_KEY_ID=
OFFSITE_S3_SECRET_ACCESS_KEY=

# Optional: office addresses allowed to open /admin (empty allows any).
ADMIN_IP_ALLOWLIST=
# Optional: the header with the visitor's country, when behind Cloudflare.
GEO_COUNTRY_HEADER=
ENV
  chown deploy:deploy "$HOME_DIR/.env"
  chmod 600 "$HOME_DIR/.env"
  echo "Wrote $HOME_DIR/.env"
else
  echo "$HOME_DIR/.env is already there; left as it is."
fi
ln -sfn "$HOME_DIR/current/deploy/ictd" /usr/local/bin/ictd

say "4/6 Apache site for $DOMAIN"
a2enmod -q proxy proxy_http headers rewrite ssl >/dev/null
curl -fsSL "$REPO_RAW/deploy/apache-ictd.conf" | sed "s/ictdistribution\.africa/$DOMAIN/g" > /etc/apache2/sites-available/ictd.conf
a2ensite -q ictd >/dev/null
apache2ctl configtest
systemctl reload apache2

say "5/6 Certificate"
server_ip=$(curl -4fsS https://api.ipify.org || hostname -I | awk '{print $1}')
dns_ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)
www_ip=$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1 {print $1}' || true)
if [[ "$dns_ip" == "$server_ip" && "$www_ip" == "$server_ip" ]]; then
  certbot --apache -d "$DOMAIN" -d "www.$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
else
  echo "$DOMAIN points to '${dns_ip:-nothing}' and www.$DOMAIN to '${www_ip:-nothing}', not this server ($server_ip)."
  echo "Add both DNS A records, wait a few minutes, then run this script again."
fi

say "6/6 GitHub secrets"
ssh_port=$(sshd -T 2>/dev/null | awk '/^port / {print $2; exit}')
host_key=$(awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub)
if [[ "${ssh_port:-22}" == "22" ]]; then known="$server_ip $host_key"; else known="[$server_ip]:$ssh_port $host_key"; fi
cat <<OUT
Add these at GitHub > simbamunyori/ictdistribution > Settings > Secrets and
variables > Actions > New repository secret:

DEPLOY_HOST
$server_ip
$( [[ "${ssh_port:-22}" != "22" ]] && printf '\nDEPLOY_PORT\n%s\n' "$ssh_port" )

DEPLOY_KNOWN_HOSTS
$known

DEPLOY_SSH_KEY  (everything between the lines, including BEGIN and END)
----------------------------------------------------------------------
$(cat /home/deploy/.ssh/github_actions_ictd)
----------------------------------------------------------------------

Next: fill in the FILL IN lines with   sudo nano $HOME_DIR/.env
OUT
