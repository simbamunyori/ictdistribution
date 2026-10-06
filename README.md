# ICT Distribution Africa

The platform behind ictdistribution.africa: a shop for individuals and a
trade portal for businesses, resellers and government buyers across
Southern Africa. Built and hosted by Fourth Generation Technologies.

The build plan is [docs/ICTD_BUILD.md](docs/ICTD_BUILD.md). Each milestone
(D1 to D11) is one pull request.

## Stack

Next.js and TypeScript, PostgreSQL (Prisma), Redis (rate limits), pg-boss
for background jobs (in the same database), Docker Compose, GitHub Actions.
The brand pack is in [brand/](brand/BRAND.md).

## Run it on your computer

You need Node 22 and Docker.

```sh
cp .env.example .env
sed -i.bak "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -base64 32)#" .env && rm .env.bak
docker compose up -d          # PostgreSQL, Redis and Mailpit
npm ci
npx prisma migrate deploy
DATABASE_URL=postgresql://ictd:ictd@localhost:5432/ictd_test npx prisma migrate deploy
npm run db:seed               # markets, customer types and demo accounts
npm run dev
```

Then open http://localhost:3000. Sign-in codes arrive in Mailpit at
http://localhost:8025.

- Customer: sign in with `kabo@example.co.bw` (owner of a demo reseller) or
  `neo@example.co.bw` (an individual).
- Staff: invite yourself as the first Admin, then open the printed link
  and add a passkey:

  ```sh
  npm run ops -- create-admin "Your Name" you@example.com
  ```

## Checks

The same ones CI runs on every pull request:

```sh
npm run lint
npm run typecheck
npm run copy-check            # no em dashes, no exclamation marks
npm test                      # unit tests, and integration tests on TEST_DATABASE_URL
npm run build
npm start &                   # then, with the demo seed:
npm run test:a11y             # axe on every page, phone and desktop, light and dark
```

The integration tests empty and reseed `TEST_DATABASE_URL` (it must end in
`_test`), never `DATABASE_URL`.

## Where things are

| Area | Code | Admin page |
| --- | --- | --- |
| Customer types and price levels | `src/server/pricing/customer-types.ts` | /admin/customer-types |
| Markets and currencies | `src/server/markets/` | /admin/markets |
| Exchange rates | `src/server/pricing/rates.ts` | /admin/exchange-rates |
| Price maths (markup, conversion, rounding) | `src/lib/pricing.ts` | |
| Sign-in (codes, Microsoft, Google, passkeys) | `src/server/auth/` | |
| Organisations and their teams | `src/server/accounts/` | /admin/customers |
| Staff roles and permissions | `src/server/staff/` | /admin/staff |
| Audit log | `src/server/audit.ts` | /admin/audit |
| Email (queued with the change, sent by a job) | `src/server/email/` | |
| Background jobs | `src/server/jobs/boss.ts` | |

Business rules (markups, buffers, rounding, rate rules, who is staff) live
in the admin area, not in code. Supplier names and prices are internal and
are never shown to customers.

## Production

[docs/deploy.md](docs/deploy.md): setting up the server, deploys with
rollback, nightly backups and the weekly restore test. Sign-in with
Microsoft and Google: [docs/sign-in-setup.md](docs/sign-in-setup.md).
Exchange rates: [docs/exchange-rates.md](docs/exchange-rates.md). Choices
made along the way: [docs/decisions.md](docs/decisions.md).
