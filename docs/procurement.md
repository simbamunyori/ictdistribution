# Orders and procurement

How an order becomes purchase orders to suppliers, what suppliers do on
their page, and what staff and the Admin control. Every rule here is set
at `/admin/purchase-orders/rules`.

## Where orders come from

- **The shop.** Checkout makes an order paid by bank transfer, or on
  account for a business with open credit ([shop.md](shop.md),
  [business.md](business.md)).
- **An accepted quote.** The customer accepts on the quote page and
  chooses delivery or collection and how to pay. The order keeps the
  quoted lines and prices, before tax with the tax on the total, and each
  line keeps the supplier and cost agreed when quoting. On account needs
  open credit that covers the total; otherwise it is a bank transfer.

Every order has a **pro forma invoice** (PDF) with the lines, totals, the
date to pay by and the bank details, with the order number as the
reference. It is linked from the order email and the order page, and staff
see it on `/admin/orders/<order>`.

## When purchase orders are made

As soon as an order is **paid** (staff record payments that cover it) or
placed **on account**, it is split by supplier:

- A line from a quote goes to the supplier and cost agreed then.
- A shop line goes to the supplier the sourcing rule picks now.
- A bundle is bought as its products.
- One purchase order per supplier (and currency), numbered `PO-100001`
  onwards, in the supplier's currency.
- A line nobody supplies is left out, and Procurement are emailed to buy
  it by hand. The order page shows it under **Purchase orders**.

A job checks every five minutes for paid orders without purchase orders,
so nothing is missed if a step fails.

## Approval rules

A purchase order goes to its supplier by itself only when every rule is
met:

- **Send purchase orders automatically** is on (off by default).
- Its value, in the base currency, is at most **Most one can be worth**.
- With **Only to preferred suppliers**, the supplier is marked preferred on
  its page.
- The supplier is switched on, has an email address or WhatsApp number,
  and its currency has an exchange rate.

Anything else waits at `/admin/purchase-orders` with the reasons listed,
and Procurement are emailed. Procurement (or an Admin) approve it there.
Only an Admin changes the rules.

## Sending

- **Email**: the supplier gets the purchase order with a button to its
  page and a link to the PDF. Replies go to `QUOTES_EMAIL`.
- **WhatsApp**: suppliers with only a WhatsApp number appear with **Open in
  WhatsApp** (the message and link ready to send). Staff send it, then
  **Mark as sent**.

The purchase order and its PDF show what we buy, the supplier's price,
**Deliver to** and **Payment terms** from the rules. Never the customer,
our order number or our selling price.

## The supplier's page

`/supplier/po/<link>` lets the supplier, without an account:

1. **Confirm the order**: their reference, when it ships, and per line how
   many they can supply and any later ship date.
2. **Mark it shipped**: the date, waybill, and serial numbers (one per
   line, up to the quantity confirmed).
3. **Send files**: invoice, packing list or anything else (PDF, PNG, JPEG,
   Excel or CSV, up to 10 MB, 30 per purchase order).

Each change is audited and emailed to Procurement. Staff can record the
same things for a supplier who answered by phone or email, from the
purchase order's admin page.

## Afterwards

- **Mark as received** when the goods are in our hands.
- **Cancel** a purchase order with a reason; a supplier who already had it
  is emailed. A shipped or received one can't be cancelled.
- **Cancelling the order** cancels its purchase orders not yet with a
  supplier, and lists the ones that are so staff settle them with the
  supplier.

## Roles

| | See | Approve, send, cancel, receive | Change the rules |
| --- | --- | --- | --- |
| Admin | yes | yes | yes |
| Procurement | yes | yes | |
| Sales, Logistics, Finance | yes | | |

## Hand steps before going live

Set the real delivery address and payment terms (the demo seed marks the
address "(demo)", and the start-up check refuses to start until it is
changed):

1. Open `/admin/purchase-orders/rules` as an Admin.
2. Fill in **Deliver to** (receiving address, contact name and phone) and
   **Payment terms**, then decide on **Send purchase orders automatically**
   and its limit.

Production servers are seeded without demo values, so on a real server
the fields start empty; the purchase orders still go out without them,
but suppliers then have to ask where to deliver.
