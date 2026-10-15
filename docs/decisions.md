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

## D5

- **Quotes show prices before tax.** Businesses compare quotes before
  tax, so lines are priced before tax and the tax is added on the total.
  The shop still shows prices with tax. An agreed price, which includes
  tax, is converted back before it is used on a quote.
- **One quote, many suppliers.** Each line goes to the best supplier by
  the sourcing rule once answers are in, so one quote can mix suppliers.
  A supplier's answer counts only until the date it says it holds.
- **Claude reads, rules decide.** Claude turns requests and supplier
  emails into structured lines and prices (`claude-opus-5-5` with
  server-side fallbacks). It never decides a price or whether a quote
  goes out: that is the pricing code and the Admin's rules. Without a key,
  or if Claude can't be reached, simple rules read what they can and flag
  the rest.
- **Only a supplier's own addresses set prices by email.** A reply from
  any other address is kept on the request for staff to check, so a
  forwarded or spoofed email can't change a quote.
- **Strangers never get an automatic quote.** A request from an address
  without an account always waits for a check, and each address can send
  10 requests a day, so the mailbox can't be used to send our prices to
  anyone who asks.
- **WhatsApp requests to suppliers are sent by hand for now.** Staff get
  the message and link ready to send; the messaging hub sends them in a
  later milestone.
- **Quote numbers** run from Q-100001 on their own sequence, separate
  from order numbers.


## D6

- **Purchase orders wait for approval by default.** Sending by itself is
  off until the Admin switches it on at `/admin/purchase-orders/rules`,
  with a value limit (2,000 in the base currency to start) and preferred
  suppliers only. Money leaving the business stays a human decision
  until the Admin decides otherwise.
- **Purchase orders are made when the order is paid or on account**, not
  when it is placed, so nothing is bought for an order that is never paid.
- **A quote's supplier and cost carry into the order.** The purchase order
  goes to the supplier we priced with, at the cost they gave, even if the
  sourcing rule would pick someone else today. Shop orders use the
  sourcing rule at the time of purchase.
- **Orders from quotes keep quote pricing**: prices before tax, tax on
  the total, delivery included as quoted. Shop orders keep prices with
  tax.
- **Supplier links never expire** while the purchase order is open, like
  request-for-price links. They show only our order: no customer, no
  order number, no selling price.
- **Supplier files are kept in the database**, as company documents are,
  so backups include them.
- **Every order goes to a supplier for now.** Whether some lines come from
  our own stock instead of being bought per order is still to be decided;
  until then a line nobody supplies is flagged to Procurement to buy by
  hand.

## D7

- **Freight is estimated from the median cost per chargeable kilogram**
  over the most recent arrived shipments on each route (origin country and
  mode into our country), not an average, so one unusual shipment doesn't
  move prices. Staff figures win field by field.
- **The supplier's allowance stays as the fallback.** A product without a
  boxed weight, or a route without history, keeps using the supplier's
  landed cost percentage, so nothing goes unpriced while records are
  loaded.
- **Duty is worked out for one country**: the default warehouse's, since
  that is where goods are cleared. Goods from a supplier in that country
  pay none. VAT is left out because it is claimed back.
- **Sample shipments are seeded and marked (demo)** because the business
  has not yet supplied its own records. They are flagged at start-up until
  replaced.
- **Stock first, then buy.** A paid order takes free stock when there is
  enough for the whole line; part lines are bought in full rather than
  split. Bundles are always bought. Admins can switch stock off.
- **Drop-shipping is off by default.** Turning it on shows the customer's
  name, phone and address to the supplier on the purchase order, which D6
  otherwise never does. It is an Admin rule, and staff can change it per
  purchase order before it is sent.
- **Tracking moves forward by itself and back only by hand.** Customers
  see steps and times, never notes or who recorded them, since those can
  name a supplier.
- **Marking an order sent still works** without deliveries: it takes what
  is kept in stock for the order and moves its lines out for delivery.

## D8

- **One tax invoice per order, issued when it is sent or ready to
  collect**, as the pro forma already promised. It charges the order's
  total; payments recorded against the order settle it. Credit notes,
  for returns after an invoice, came with after-sales in D9.
- **Our tax number is set per market** by an Admin, beside the tax rate,
  and printed on tax invoices. It is empty until the business says which
  legal entity trades where.
- **A statement counts invoices when issued and payments when
  received.** Money paid for an order before it is sent shows as a credit
  until the invoice follows. Ageing is by days past each invoice's due
  date.
- **An account page shows one account**: the organisation's when buying
  for one, else the person's own. The order and quote lists follow the
  same rule, so a person's own orders no longer mix into their team's.
- **Roles decide what a member sees and does.** Everyone sees quotes,
  orders, invoices, deliveries, returns and lists. The statement and
  payments are for Owners, Finance and Viewers. Buying again, lists and
  returns are for Owners and Buyers.
- **Returns are asked for per line** for what has left us, within the
  return window in the shop settings (14 days to start), or at any time
  for a fault. Staff approve, decline, receive and settle each with a note
  the customer sees. Serials, warranty and repairs come with after-sales
  in D9.
- **Buying again uses today's prices.** A past order or a list goes into
  the cart priced afresh; anything no longer sold, or priced only on a
  quote, is left out and named.

## D9

- **A serial-numbered item sold is a unit**, with its warranty worked out
  from the product's warranty months when it was sold, from the day it
  left us. Items without serials keep the warranty shown on the product.
- **Serials come from the supplier's shipping notice or are typed by
  staff** on the order. Staff serials win when both name the same one;
  a unit in a return is never removed by editing the list.
- **A replacement carries on the original's warranty** rather than
  starting a new one, the usual maker's rule. Staff can say otherwise in
  the note.
- **A credit note credits the returned lines at the prices charged**,
  with the tax worked out as the invoice did. Delivery charges and part
  credits are not credited by this; settle those another way and say so
  in the note.
- **Credit notes and refunds count everywhere money owed does**: the
  invoice, the statement (credit notes as credits, refunds as charges),
  ageing, the credit position and whether the order is paid.
- **Only Finance and Admins issue credit notes and record refunds.** The
  rest of a return stays with Sales, Logistics and Support.
- **The repairer's reference stays internal**, like every supplier
  detail.
- **Returned items are not put back into stock automatically.** Staff
  count anything that can be sold again into stock on the Stock page, as
  in D8.


## D10

- **Sales count when the order goes ahead**: paid, on account or sent,
  by the day it was placed. Orders waiting for a bank transfer are open
  orders, not sales, until paid.
- **Reports are in the base currency at the rate in use on the order's
  day**, so a past month does not move when rates do. Orders in a
  currency with no rate at all are left out and named on the page.
- **Margin is on landed cost recorded at sale**, the figure the price was
  worked out from, not what the supplier finally charged. Lines without a
  recorded cost are left out of margin and the table says on how much
  margin was worked.
- **Delivery charged to customers is sales with no cost against it**, its
  own row under categories.
- **Credit notes are shown beside sales, not taken off margin.** A credit
  usually brings the item back, so taking only the sale off would
  understate margin.
- **The supplier of a line is the purchase order's**, else the one a
  quote recorded, else our stock. Shop orders are "Not yet bought" until
  their purchase order exists.
- **Reminders go only for invoices past due**, on a schedule Finance sets,
  never more than one in an hour for the same invoice. Each has its own
  link so a forwarded reminder still opens the invoice. Paying, a credit
  note or a cancellation stops them at once.
- **The accounting export is files, not a live link.** CSV in each
  package's own import layout is the one route that works with all
  three and needs no keys kept on our server. Lines go before tax with
  their share of the tax, so totals match to the cent; any difference is
  an "Adjustment" line.
- **Sage 50 gets invoices, credits and receipts.** It has no import for
  money paid back, so refunds are entered by hand from the payments file.
- **Reports are for Admin, Sales and Finance; chasing, exports and
  finance settings for Admin and Finance.** Supplier names in reports are
  staff only, as everywhere.
- **Statement lines are ordered by day, then debits first.** Payments
  carry a date only, so an invoice issued later the same day now comes
  before its payment instead of after it (a fix to D8).

## D11

- **The assistant sees only what the shop shows the visitor.** Its search
  tool returns the shop's own product cards for that visitor: their price,
  whether they can buy it, lead time. Supplier, cost and margin never
  reach the model, so it can't reveal them.
- **One engine shape, two engines.** Claude answers when the key is set;
  rules answer otherwise or when the call fails. The page and the stored
  conversation are the same either way, so the shop works without a key.
- **Every answer goes through the copy rules** before it is stored,
  whichever engine wrote it.
- **Conversations belong to a browser, then a person.** A secret in a
  cookie finds the conversation; signing in claims it. Someone else's
  signed-in conversation is never continued.
- **Quote requests are drafted, not sent.** The visitor checks the lines
  on the quote form and sends them, so nothing reaches Sales unasked.
- **Search widens step by step**: every word, then most words, then
  close spellings (pg_trgm). Exact matches always come first.
- **Structured data carries a price only for retail products**, and only
  the retail price. Trade prices depend on who is signed in, so they stay
  off pages search engines read.
