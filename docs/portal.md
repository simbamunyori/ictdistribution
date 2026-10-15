# The customer portal

What a signed-in customer finds under **Your account** (`/account`), and
what staff do behind it. Supplier names, costs and sourcing are never
shown in any of it.

## Whose records

A person can buy for themselves or for an organisation they belong to,
and switch on the account page. Buying for an organisation, every page
shows the whole organisation's records, by anyone on the team; buying
for themselves, only their own.

What each role in an organisation sees and does:

| | Owner | Buyer | Finance | Viewer |
| --- | --- | --- | --- | --- |
| Quotes, orders, invoices, deliveries, returns, lists | yes | yes | yes | yes |
| Statement and payments | yes | | yes | yes |
| Buy, buy again, keep lists, ask for returns | yes | yes | | |
| Credit, the team and company details | as before ([business.md](business.md)) | | | |

A person buying for themselves can do all of it with their own records.

## The pages

- **Overview**: quotes ready, orders in progress, items on the way, what
  is owed and overdue, and open returns, each linking to its page.
- **Orders**: filter by state, or to the ones you placed yourself. Each
  order can be bought again in one click.
- **Quotes**: as before ([quotes.md](quotes.md)). Each quote is also
  emailed when it is ready.
- **Invoices**: every tax invoice, what is still to pay and whether it is
  overdue, with its PDF.
- **Statement**: invoices and payments for a period (the last three
  months to start), the balance after each, and what is owed by how late
  it is: not yet due, 1 to 30, 31 to 60, 61 to 90 and over 90 days. Also
  as a PDF.
- **Payments**: what is waiting to be paid (pro forma orders and unpaid
  invoices), and every payment received.
- **Deliveries**: each item still on its way with where it is, and every
  delivery that has left, with its delivery note and proof of delivery.
- **Returns**: requests and where each one is.
- **Saved lists**: lists of products and quantities.

## Tax invoices

Each order gets one tax invoice, numbered `INV-100001` onwards, when it
is marked sent or ready to collect, or when its last delivery is
dispatched. The customer is emailed a link that opens it without signing
in. It is made out to the organisation (with its tax number) or the
person, and shows our tax number for the market when an Admin has set it
on the market's page (`/admin/markets`). Its due date is the order's
date to pay on account, or the day it was issued when already paid. Staff
find it on the order's page.

## Buying again and lists

**Buy again**, on an order or in the order list, puts the order's
products and bundles in the cart at today's prices. **Saved lists** keep
products and quantities: save a product from its page, the whole cart, or
an order. **Put it all in the cart** does the same as buying again.
Anything no longer sold, or priced for the customer only on a quote, is
left out and named in the cart.

## Returns

On an order that has left us, **Return items** asks for a return: how
many of each line (up to what was sent, less what is already in a
return), why, and what is wrong. A change of mind is accepted within the
return window, set by staff in the shop settings (`/admin/shop`, 14 days
to start, from when the order was sent or made ready); a fault at any
time. The customer is emailed at each step.

Staff answer at `/admin/returns`, counted in the admin menu:

1. **Approve**, optionally saying how to send it back, or **decline**,
   saying why.
2. **Mark received** when the items are back. An item that can be sold
   again is counted into stock on the Stock page.
3. **Settle**, saying how: refunded, replaced or repaired.

A customer can withdraw a request until it is answered.

| | Admin | Sales | Logistics | Support | Finance | Procurement |
| --- | --- | --- | --- | --- | --- | --- |
| See returns | yes | yes | yes | yes | yes | |
| Answer, receive and settle returns | yes | yes | yes | yes | | |
