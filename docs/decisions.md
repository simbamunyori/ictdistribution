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

## D3

- **Shop prices include sales tax** (VAT 14% in Botswana, 15% in South
  Africa, 15.5% in Zimbabwe as starting values) and are rounded up to the
  market's step. Admins change the rate per market at `/admin/markets`.
- **Everyone sees retail prices until D4.** The shop prices products
  marked "sell to individuals" at the Individual markup for every visitor.
  D4 adds trade prices for signed-in businesses; other products say "Sign
  up as a business to see prices".
- **Each product keeps its landed cost** (the chosen supplier's cost plus
  landed cost, in US dollars) on the product row, refreshed whenever an
  offer, supplier, rule or rate changes and hourly by a job. Shop pages
  read that one column, never offers or suppliers, so pages stay fast and
  supplier data cannot leak into them.
- **Bank transfer until a card gateway is chosen.** Orders wait for
  payment for a set number of days (3 to start, set at `/admin/shop`),
  Finance records the money, and unpaid orders are cancelled by a job so
  their special units go back on sale. Which gateway to use is open
  (DPO, Peach Payments and PayFast all cover the region); the checkout
  already has the card option in its data.
- **Special units are taken in the database** with one conditional
  update when the order is placed, so two buyers can never both get the
  last unit. Cancelled orders give their units back.
- **Order links carry a secret.** A guest's order page is
  `/orders/<number>?t=<secret>`, sent in the confirmation email; only its
  hash is stored. Signed-in customers see their orders without it.
- **Our own stock is a supplier.** A consignment launched as a special is
  recorded as an offer from "Our stock (currency)" at its landed cost, so
  costs, margins and sourcing work the same as for any supplier.

## D4

- **Trade prices need an approved business.** A signed-in business buys
  at Individual prices until staff approve its details and documents;
  only then does its own level apply, and only then can it see and buy
  products not sold to individuals. Withdrawing an approval switches this
  off from the next page.
- **Volume breaks are a percentage off, per product line.** A break
  counts the quantity of one product in the cart, not the whole order,
  and the best break reached applies. It does not stack with a special
  or an agreed price, so a customer never gets two discounts on one unit.
- **Agreed prices are fixed amounts in the market currency**, including
  tax, not a markup. That matches how quotes and contracts are written.
  A lower special still wins.
- **Credit is checked inside the order's transaction.** The
  organisation's row is locked while the balance is read, so two orders
  placed together cannot both use the last of the limit. The balance is
  every order on account that is not cancelled, less payments received.
- **Orders on account can be sent before payment.** They start as "On
  account" rather than "Awaiting payment", are not cancelled for late
  payment, and show as overdue on the customer's credit page after their
  due date. Reminders for overdue accounts come with statements and
  invoices in a later milestone.
- **Approved trade buyers can order up to 10,000 of one item.** The cart
  limit set at `/admin/shop` still applies to everyone else.
- **Company documents are kept in the database** next to the
  organisation, so backups and restores include them and no file storage
  needs setting up. Only staff can open them, and each opening is
  audited.
