# After-sales

Serial numbers and warranties for what we sell, and returns and repairs
through to a repair, a replacement or a credit note. Supplier names,
costs and sourcing are never shown to customers in any of it, including
a repairer's own reference.

## Serial numbers and warranty

Each serial-numbered item sold is a unit with its own record. Serials
come from two places:

- **The supplier's shipping notice**: what a supplier types when they
  mark a purchase order shipped (see [procurement.md](procurement.md)).
- **Staff**, on the order's page (`/admin/orders`), under **Serial
  numbers and warranty**, one per line. Use it for items from our stock
  or missing from a supplier's notice. Removing a serial removes its
  unit, unless it is in a return.

A unit's warranty starts the day it leaves us (the order is sent or made
ready, or the delivery it is in is dispatched) and runs for the
product's warranty months as they were when it was sold, with the
product's warranty terms. Products without warranty months show "No
warranty".

Customers see every unit under **Warranty** in their account
(`/account/warranty`), with how long each warranty runs, and on the
order's page. They can search by serial number, product or order and
ask for a repair from any unit. Staff look any serial up at
`/admin/warranty`. Serials match however they are typed: case, spaces,
dashes, dots and slashes are ignored.

## Returns and repairs

The customer asks on the order (**Return items**) or from a unit
(**Ask for a repair**): how many of each line, which serial numbers, why,
what is wrong, and what they would like (a repair, a replacement, or a
credit or refund). The return window and the rule that a fault can be
returned at any time are as before ([portal.md](portal.md)).

Staff work it at `/admin/returns`:

1. **Approve** (with how to send it back) or **decline** (with why).
   Once approved, the customer can give their courier and tracking
   number on the return's page.
2. **Mark received** when the items are back. Their units show as in for
   repair.
3. Then one of:
   - **Send it for repair**, with the repairer's reference kept for
     staff only, then **Send it back repaired** with the courier and
     tracking number. The units go back to the customer with their
     warranty as it was.
   - **Send a replacement**, with the new serial number for each unit
     and the courier and tracking number. The new unit carries on the
     warranty of the one it replaces; the old one shows as replaced.
   - **Credit it** (Finance or Admin): issues a credit note at the prices
     charged, against the order's invoice. The units show as returned.
   - **Settle it another way**, with a note, for example no fault found.

The customer is emailed at each step and sees the progress, both
trackings, the replacement serials and the credit note on the return's
page.

## Credit notes and refunds

Credit notes are numbered `CN-100001` onwards and emailed with a link
that opens them without signing in. They come off what is owed: on the
invoice, the statement, the account's credit position and the order. If
the customer had already paid more than is now owed, the order's page
says how much we owe back, and Finance records the refund there once it
is paid (amount, date and reference). The customer is emailed, and the
refund shows on their payments page and statement.

| | Admin | Sales | Logistics | Support | Finance | Procurement |
| --- | --- | --- | --- | --- | --- | --- |
| See returns, warranty and serials | yes | yes | yes | yes | yes | |
| Record serial numbers | yes | yes | yes | yes | | |
| Approve, receive, repair, replace and settle returns | yes | yes | yes | yes | | |
| Issue credit notes and record refunds | yes | | | | yes | |
