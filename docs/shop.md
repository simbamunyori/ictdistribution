# The shop

What individuals see and buy, and how staff run it. Everything here is
set in the admin area.

## Prices

A shop price is the product's landed cost plus the Individual markup
(`/admin/customer-types`), plus the market's sales tax, converted at the
current rate with the market's buffer, and rounded up to the market's
step (`/admin/markets`). Prices include tax, and pages say so.

Only products marked **Sell to individuals** show a price. The rest show
"Sign up as a business to see prices". Products with no active supplier
offer, or a market with no exchange rate yet, show no price and can't be
added to a cart.

The landed cost comes from the supplier the sourcing rule picks
(`docs/catalogue.md`). It is kept on the product and refreshed when an
offer, supplier, rule or rate changes, and hourly. Customers never see
costs or suppliers; staff see an order's cost on its
admin page.

## Home page

`/admin/shop`: the headline and line under it, and the **Popular now**
products (added by part number or address, in the order you set).
Specials marked **Show on the home page** appear above them.

## Specials

`/admin/specials`. A special lowers the price for a while:

- **On** one product, a whole category (and the categories under it), or
  a bundle of two to six products bought together.
- **Discount**: a percentage off, or (for a product or bundle in one
  market) a fixed price including tax. A fixed price above the usual one
  does nothing.
- **When**: start and end, in Gaborone time. Customers see a countdown.
- **How many**: units on offer (the shop shows how many are left once 20 or fewer remain, and stops
  when they are sold), and the most per order (more than that are at the
  usual price).
- **Who**: the customer types it is for. Until D4 the shop prices only
  for individuals.

When two specials cover a product, the customer gets the lower price.
**End now** stops a special at once; it stays in the list with what it
sold.

### Launching stock as a special

`/admin/specials/consignment`, for stock we bring in ourselves: choose the
product, the units that arrived and their landed cost per unit, then the
special. In one step this records the stock as an offer from **Our stock**
at that cost and starts a special limited to those units.

## Cart and checkout

The cart is kept for 60 days in a cookie, with up to the set number of
each item (`/admin/shop`). Prices are worked out again at checkout and
kept on the order.

Customers check out as a guest or signed in (the Individual price level
sets whether guests may). They choose:

- **Delivery** (`/admin/markets/<code>`): the fee, free delivery above an
  amount, and a note such as areas and times. Off means collection only.
- **Collection** from a collection point (same page).
- **Bank transfer**: the market's bank details (Admins set them) are
  shown and emailed with the order number as the reference. A market with
  no bank details takes no orders. Card payments come when a gateway is
  chosen.

## Orders

`/admin/orders`. The menu shows how many wait for payment or sending.

1. **Waiting for payment.** Finance records each transfer (amount,
   reference, date). When payments cover the total the order is **Paid**
   and the customer is emailed.
2. **Paid.** Sales or Logistics mark it **sent** (with a note such as a
   tracking number) or **ready to collect**. The customer is emailed.
3. **Cancelled.** Sales, Finance or Admins cancel with a reason, which is
   emailed. Orders not paid by their date are cancelled by a job. Either
   way, special units go back on sale. If money was received, arrange the
   refund.

Customers see their orders at `/account/orders`, and guests through the
link in their email.

## Before launch

Replace the demo values (the server lists them when it starts):

1. `/admin/markets/bw`: real bank details, delivery fee and note, and a
   real collection point. Close "Gaborone office (demo)".
2. `/admin/specials`: end the three demo specials.
3. `/admin/shop`: choose the Popular now products.
