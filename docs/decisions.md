# Decisions

Choices made while building, and why. Business decisions still open are
in [ICTD_BUILD.md](ICTD_BUILD.md), "Decisions and inputs from the business".

## D1

- **Same server and pattern as Cloud Console.** Both are built and hosted
  by Fourth Generation Technologies, so ICT Distribution reuses the proven
  deploy (build on the server, back up, migrate, health check, roll back),
  backup and restore-test scripts, in its own folder, port, network and
  Docker project so neither can affect the other.
- **Job queue: pg-boss, in PostgreSQL.** A job and the change that queued
  it commit together, and there is one less thing to back up. **Redis**
  holds what may be lost: rate-limit counters, and later caches.
- **No passwords.** Customers sign in with an emailed code, a passkey,
  Microsoft or Google. Nothing to leak, reset or reuse.
- **Staff always use a passkey.** After an email code or Microsoft, a
  staff sign-in finishes only with the passkey on their own device. Losing
  it means an Admin switches the account off and invites them again.
- **The first Admin is invited from the server** (`ictd create-admin`),
  never created with a default password.
- **One audit log, append-only in the database.** A trigger refuses any
  change or removal. Every change staff make to a customer's organisation
  is also shown to that customer.
- **Markups are starting values.** Individual 25%, Business 18%,
  Reseller 12%, Government and enterprise 15%, until decision 2. Staff
  change them at `/admin/customer-types`.
- **Exchange rates from ExchangeRate-API's free endpoint**, with a 10%
  hold-back for big moves and a 2% buffer per market. Zimbabwe prices in
  US dollars, so it has no buffer.
- **One address: ictdistribution.africa.** `www` redirects to it, because
  passkeys belong to one exact host.
- **Migrations only add.** New tables and columns, never a drop or rename
  in the same release that stops using them, so a rollback always finds a
  database it can run on.
- **Product images and datasheets live in PostgreSQL**, resized to WebP
  on upload. The nightly backup and the restore test cover them with no
  second store to sync, and the volume (a few hundred KB per product) is
  small for a database. They are served with a year's cache, so the
  database is read once per file per browser.
- **Search uses PostgreSQL** (a trigram index on a search text column),
  and filters and their counts are worked out in the app over at most
  5,000 matches. This is enough for the launch catalogue; D11 adds a
  search index if the range outgrows it.
- **Specifications are stored as JSON per product** with their fields
  defined per category in the admin area, so new categories and fields
  need no code change or migration.
- **Landed cost is a percentage per supplier** (freight, duties and
  clearing) added to their cost before comparing suppliers, in US dollars.
  Staff set it from experience; D5 can refine it per shipment.
