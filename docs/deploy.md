# Deploying

ICT Distribution runs on the Contabo server that already hosts Cloud
Console, behind the same Apache, in its own folder (`/opt/ictd`), on its
own port (127.0.0.1:3100) and its own Docker network. Every merge to `main`
that passes CI goes live on its own, and rolls back on its own if the new
release doesn't come up healthy.

```
GitHub Actions ──ssh──▶ deploy@server: /opt/ictd/incoming/deploy.sh <release>
                            build image ▸ back up ▸ migrate ▸ start ▸ health check ▸ (roll back)
Apache :443 ──▶ 127.0.0.1:3100 ──▶ app ──▶ PostgreSQL, Redis   (docker compose -p ictd)
                                        backup ──▶ /opt/ictd/backups ▸ off-site storage
```

## One-time set-up

Replace `SERVER` with the server's IP address in every command. Run them
from your computer, inside a checkout of this repository, with the GitHub
CLI signed in (`gh auth login`).

### 1. DNS

At the registrar for ictdistribution.africa, add two A records pointing at
the server, and wait until both answer:

| Name | Type | Value |
| --- | --- | --- |
| `@` | A | `SERVER` |
| `www` | A | `SERVER` |

```sh
dig +short ictdistribution.africa www.ictdistribution.africa
```

### 2. The server

```sh
scp deploy/server-setup.sh deploy/apache-ictd.conf root@SERVER:/root/
ssh root@SERVER 'REPO_RAW=file:///root bash /root/server-setup.sh'
```

It installs Docker if it isn't there, gives the `deploy` user a new SSH key
for this repository, writes `/opt/ictd/.env` with fresh secrets, adds the
Apache site and gets the certificate for both names. It is safe to run
again (for example once DNS has caught up). Keep `BACKUP_PASSPHRASE` from
`/opt/ictd/.env` in the password manager: without it no backup can be
restored.

### 3. Settings

```sh
ssh -t root@SERVER 'nano /opt/ictd/.env'
```

Set `SMTP_URL` to the mail server the sign-in codes go out through, for
example `smtps://no-reply%40ictdistribution.africa:PASSWORD@mail.ictdistribution.africa:465`
(an `@` in the user name is written `%40`). The other lines can stay as
they are for now; each is explained in the file.

### 4. GitHub secrets

```sh
gh secret set DEPLOY_HOST -R simbamunyori/ictdistribution --body "SERVER"
ssh root@SERVER cat /home/deploy/.ssh/github_actions_ictd | gh secret set DEPLOY_SSH_KEY -R simbamunyori/ictdistribution
ssh root@SERVER 'cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub' | sed "s/^/SERVER /" | gh secret set DEPLOY_KNOWN_HOSTS -R simbamunyori/ictdistribution
```

If SSH listens on a port other than 22, also run
`gh secret set DEPLOY_PORT -R simbamunyori/ictdistribution --body "PORT"`
and write `[SERVER]:PORT` instead of `SERVER` in the known-hosts line.

### 5. The first deploy

Merging the D1 pull request deploys it. To deploy `main` again by hand:

```sh
gh workflow run deploy.yml -R simbamunyori/ictdistribution --ref main
gh run watch -R simbamunyori/ictdistribution $(gh run list -R simbamunyori/ictdistribution -w deploy.yml -L 1 --json databaseId -q '.[0].databaseId')
```

The first deploy adds the markets (Botswana, South Africa, Zimbabwe), the
currencies, the four customer types and the first exchange rates. If it
stops at "The app will refuse to start until these are fixed", it lists
what to change in `/opt/ictd/.env`; fix it and run the workflow again.

### 6. The first Admin

```sh
ssh root@SERVER 'sudo -u deploy ictd create-admin "Your Name" you@ictdistribution.africa'
```

It emails the invitation and prints the link. Open it on the phone or
computer you use for work and add a passkey. From then on, invite everyone
else at https://ictdistribution.africa/admin/staff.

### 7. Off-site backups (before real customers)

Until this is done, nightly backups stay on the server only. In the Contabo
customer panel: **Object Storage > Create bucket**, name it `ictd-backups`,
then **Object Storage > Credentials** for the access key and secret. Then:

```sh
ssh -t root@SERVER 'nano /opt/ictd/.env'
```

Fill in `OFFSITE_S3_ACCESS_KEY_ID` and `OFFSITE_S3_SECRET_ACCESS_KEY` (and
`OFFSITE_S3_ENDPOINT` if your storage region isn't `eu2`), then:

```sh
ssh root@SERVER 'sudo -u deploy ictd restart && sudo -u deploy ictd restore-test'
```

The restore test ends with `restore-test: OK` once a backup has gone
off-site and come back.

## Day to day

On the server, as the deploy user (`ssh root@SERVER`, then `sudo -u deploy -i`):

| Command | What it does |
| --- | --- |
| `ictd status` | The live release and its health |
| `ictd logs` | Follow the app's log |
| `ictd restart` | Start the app and the backups again, after changing `.env` |
| `ictd create-admin "Name" email` | Invite a staff Admin |
| `ictd backup` | Take a backup now |
| `ictd restore-test` | Prove the newest backup restores |
| `ictd releases` | The releases kept on the server, newest first |
| `ictd rollback <release>` | Start an earlier release again |

## How a deploy works

`.github/workflows/deploy.yml` runs after CI passes on `main`. It packs the
commit and runs `deploy/deploy.sh` on the server, which:

1. builds the image `ictd:<release>` while the live release keeps serving;
2. backs up the database (every deploy but the first);
3. applies migrations and adds any missing reference data;
4. starts the new release and waits up to three minutes for
   `/api/health` to report it;
5. if it never does, starts the previous release again and fails the
   workflow, with the new release's last log lines.

Migrations only ever add (new tables and columns), so the previous release
still runs on the newer database after a rollback. The last five releases
and their images are kept for `ictd rollback`.

## Backups

Every night at 23:30 UTC the `backup` service writes
`/opt/ictd/backups/ictd-<time>.dump.enc` (pg_dump, AES-256 with
`BACKUP_PASSPHRASE`), keeps 30 days, and copies it off-site once that is
set up. Every Monday at 03:30 UTC `.github/workflows/backups.yml` runs
`ictd restore-test`: a fresh backup, downloaded back from off-site storage,
restored into a scratch database and checked table by table. A failed run
emails the repository's watchers.

### Restoring for real

This replaces the live database with a backup. Take one first.

```sh
ssh root@SERVER
sudo -u deploy -i
ictd backup
ls -1t /opt/ictd/backups | head          # pick the file to restore
cd /opt/ictd/current
export $(grep -E '^(POSTGRES_PASSWORD|BACKUP_PASSPHRASE)=' /opt/ictd/.env | xargs)
docker compose -p ictd -f docker-compose.prod.yml --env-file /opt/ictd/.env stop app backup
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in /opt/ictd/backups/ictd-YYYYMMDD-HHMMSS.dump.enc \
  | docker compose -p ictd -f docker-compose.prod.yml --env-file /opt/ictd/.env exec -T db pg_restore --clean --if-exists --no-owner -U ictd -d ictd
ictd restart
ictd status
```

## Without Apache

On a server with nothing else on ports 80 and 443, Caddy can serve it with
automatic HTTPS instead: set `DOMAIN` in `.env` and add
`--profile caddy` to the compose commands.
