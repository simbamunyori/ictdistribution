# ICT Distribution Africa: platform build plan

ictdistribution.africa sells ICT products across Africa, starting with SADC markets, to two kinds of customer:

1. Individuals and small buyers in an open shop: laptops, phones (including current flagship models), desktops, monitors, SSDs, RAM and other simple products, at retail prices, with specials.
2. Registered businesses: IT resellers, systems integrators, and government and enterprise buyers, who sign up, are verified, and get trade pricing, quotes, tender support and their own portal.

The full catalogue covers laptops, desktops, phones, monitors, storage, memory, networking (switches, routers, access points, Wi-Fi extenders, firewalls), cables, power (UPS), peripherals, servers and software licences, with room for any new category.

This is a new build. Fourth Generation Technologies builds and hosts it.

## Working rules

- New repository, `ictdistribution`. One PR per milestone, all checks green before review, automatic deploy on merge with rollback, nightly backups with a tested restore, hand steps as exact clicks or commands.
- Same stack as our other platforms: Next.js and TypeScript, PostgreSQL, Redis, a job queue, Docker Compose, GitHub Actions.
- Its own brand, built in D1, at the same quality standard as the Fourth Generation site: light and dark, phone first, fast.
- Copy: plain, confident, no exclamation marks, no em dashes.
- Business rules live in the admin area, not in code: markups per customer type, specials, credit limits, payment terms, currencies, freight rates, duties and taxes, lead times, automation thresholds.
- Sourcing is never shown to customers. Supplier names, supplier prices, origin of supply and sourcing channels are internal only. Customers see our products, our prices, our quotes and our invoices, under our brand. Where the law requires a detail (for example country of manufacture on a customs document), it appears only on that document.

## Milestones

### D1: Brand and foundations

1. Brand pack (logo, colours, type, icons, light and dark) in `brand/`.
2. Repository, CI, deploy pipeline, backups.
3. Customer types: Individual, Business, Reseller, Government and enterprise. Each has its own price level, set in the admin area. Business-type accounts are organisations with their own users (Owner, Buyer, Finance, Viewer).
4. Staff roles: Admin, Sales, Procurement, Logistics, Finance, Support; full audit log.
5. Sign-in with Microsoft, Google, email and passkeys; guest checkout for individuals.
6. Markets and currencies: Botswana (BWP), South Africa (ZAR), Zimbabwe (USD), more added in the admin area; prices in the customer's currency; exchange rates updated automatically.

### D2: Catalogue and suppliers

1. Categories and subcategories managed in the admin area.
2. Products with brand, manufacturer part number, specifications by category, images, datasheets and warranty.
3. Suppliers (internal only): local distributors, international and China-based suppliers, with contacts, how to reach them (email, WhatsApp, supplier portal), currencies, categories they supply, typical lead times, minimum order quantities, and a performance record.
4. Each product can have several suppliers with their own cost and lead time; the platform picks by rules (cheapest landed cost, fastest, preferred).
5. Bulk import of supplier price lists (CSV and Excel, with column mapping saved per supplier), scheduled re-imports, and a review screen showing changes.
6. Search and filters by specification, compare up to four products, and suggested compatible items.

### D3: The shop and specials (individuals)

1. Storefront home with a featured section for headline products (flagship phones, popular laptops) and current specials, all chosen in the admin area.
2. Retail section with prices visible to everyone for products marked "sell to individuals" (laptops, phones, desktops, monitors, SSDs, RAM and similar). Other products, such as networking equipment, show "Sign up as a business to see prices".
3. Specials: a special price for a product, a category or a bundle, with start and end dates, limited quantity, per-customer-type eligibility, and a countdown. Bulk stock we bring in (for example a laptop consignment) can be launched as a special in a few clicks.
4. Cart, checkout and payment (card through a gateway when live, bank transfer meanwhile), with delivery or collection.
5. Clear "Buying for a business? Register for trade prices" prompts throughout.

### D4: Business registration and pricing

1. Business sign-up with verification: company registration, tax number, directors, documents. Staff approve before trade prices show.
2. Price levels: Individual (highest), Business, Reseller and Government or enterprise, each a markup rule by category, plus volume breaks and per-customer special prices.
3. Credit: customers can apply for credit terms; Finance sets limits and terms; the platform tracks balances and blocks orders over limit.

### D5: Automated quotations

The goal: a customer request is turned into a priced, branded quotation without anyone doing it by hand, and staff only step in on exceptions.

1. Request intake: a customer submits a request for quote from the portal or by email (and WhatsApp through the Fourth Generation hub once live): typed lines, a pasted list, an uploaded spreadsheet or bill of materials, or a tender document. Each request is tagged with its type: standard, reseller project, or government or enterprise tender (with reference, deadline and required documents).
2. Understanding the request: AI reads the request into clean line items (product, specification, quantity), matched to catalogue products where possible. Unclear lines are flagged.
3. Price from catalogue first: lines with a current supplier price are priced straight away.
4. Automatic requests to suppliers: for lines without a current price, the platform sends a request for price to every matching supplier (by category and preference), by email or WhatsApp, each with a unique link to a simple supplier response page (price, quantity available, lead time, validity, notes). Replies by plain email are read by AI and turned into the same structured response. A deadline per request is set by rules (for example 24 hours, shorter for urgent requests).
5. Choosing and costing: when responses arrive or the deadline passes, the platform picks the best supplier per line by the rules, then adds:
   - landed cost: freight, insurance, duties and clearing, estimated from our shipment history (see D7)
   - markup for the request type and customer price level (tender, reseller, business, individual)
   - currency conversion and any rounding rules
6. Branded quotation as a PDF with our logo, company details, lines, delivery time, validity, payment terms and bank details, plus an Accept online button.
7. Sending: the quote is emailed and appears in the customer's portal. It goes out automatically when every line is within the automation rules set by an Admin (maximum value, minimum margin, confident matches, no flagged lines). Anything outside the rules goes to a staff review queue with everything pre-filled, so a person only checks and clicks send.
8. Tender pack: for tenders, the quote can include datasheets and warranty documents per line, and staff are reminded of the deadline.
9. Tracking: every request shows its status to staff (waiting on suppliers, ready, sent, accepted) and the time taken. Quote win rate is reported by type and category.

Note on suppliers on marketplaces such as Alibaba: those platforms do not offer a general way to message suppliers automatically. Suppliers found there are added with their direct email or WhatsApp, and the automation uses those.

### D6: Orders and procurement

1. Orders from checkout or accepted quotes, with pro forma invoice and payment or credit approval.
2. Purchase orders to suppliers created automatically from each order, grouped per supplier, sent after staff approval (or automatically within rules).
3. Supplier response page extended for order confirmation, ship dates, invoices, packing lists and serial numbers.

### D7: Logistics and landed cost

1. Freight estimates from our own shipment records: each past shipment is recorded (route, mode such as air, sea or road, weight, volume, cost, duties, clearing fees, days in transit), and the platform estimates new shipments from them per route and mode, using volumetric weight. Staff can override any estimate. The first shipment samples are loaded in this milestone.
2. Duty and tax rules by product category and destination country.
3. Shipment tracking per order line: ordered, shipped, in transit, at customs, cleared, in warehouse, out for delivery, delivered.
4. Warehouses and stock, or drop-ship per order; both supported.
5. Delivery notes, commercial invoices and proof of delivery.

### D8: Customer portal

For every signed-in customer: quotations (also sent by email), orders, invoices, statements, payments, deliveries and tracking, returns, saved lists and one-click reorder. Business accounts see this for their whole organisation by role.

### D9: After-sales

Serial and warranty records per item sold; returns and repairs with approval, tracking, replacement or credit notes.

### D10: Finance and reporting

Invoices, credit notes, statements and overdue reminders; margin per order, category, supplier and customer type including landed cost; dashboards for sales by market and category, quote win rate and response times, top customers, supplier performance, stock and open orders; export for Sage, QuickBooks or Xero.

### D11: AI assistant and search

An assistant on the site that helps buyers find products by need ("laptops for a 20-person office within a budget"), shows retail prices to individuals, builds a quote request for businesses, and hands over to Sales. Product pages built for search engines.

## Order of work

D1 to D3 first, so the shop and specials can sell. Then D4 and D5, the automated quotations. Then D6 to D11.

## Decisions and inputs from the business (not blocking the build)

1. Which legal entity trades, and in which countries first.
2. Markups per customer type and category, and automation thresholds for auto-sent quotes.
3. Whether we hold stock, drop-ship, or both.
4. Credit terms policy.
5. The first suppliers to load, with their contact details.
6. Sample shipment records (route, weight, volume, freight cost, duties, clearing fees, days), to train the freight estimates.
