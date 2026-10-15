# Logistics and landed cost

How freight, insurance, duty and clearing are estimated from our own
shipments, how goods are tracked from the supplier to the customer, and
how stock, drop-shipping, deliveries and their papers work. The rules are
set by an Admin at `/admin/logistics/rules` and `/admin/logistics/duty`.

## Landed cost

The landed cost of a product from a supplier is its price plus what it
takes to get one unit into our warehouse:

- **Freight and fees** by chargeable weight, at the typical cost per
  kilogram on the supplier's route (their country to ours) and mode (air,
  sea, road or courier, set on the supplier's page).
- **Insurance** as a share of the price: the share seen on past
  shipments, else the rule (0.5% to start).
- **Duty and levies** on the price, freight and insurance together, by
  the product's category and the country goods land in. Goods from a
  supplier in our own country, or from a duty free origin, pay none.

Chargeable weight is the unit's boxed weight or its volumetric weight,
whichever is more. Volumetric weight is the box's volume times a factor
per mode, in kilograms per cubic metre: 167 for air, 200 for courier,
333 for road and 1000 for sea to start. Enter each product's boxed weight
and size on its page, under **Boxed for shipping**.

When a product has no weight, or its supplier's route has no estimate,
the supplier's landed cost allowance (a percentage on their page) is used
as before. The product page shows, per supplier, how the landed cost was
made up.

Landed costs feed supplier choice, shop prices and quotes, and are worked
out again whenever a shipment, figure, duty rule or rule changes.

## Shipments and estimates

`/admin/logistics` lists every shipment. Each has a mode, the countries it
came from and went to, its gross weight and volume, and what it cost:
freight, insurance, duties, clearing and other costs, in the currency they
were paid in, with the dates or days in transit.

- **Past shipments** are history. Record one at a time, or load many from
  a spreadsheet at `/admin/logistics/import` (download the template, fill
  it in, save as CSV and load it; if any row has a problem nothing is
  loaded and every problem is listed).
- **Live shipments** are consignments on their way. Book one, add the
  purchase orders travelling in it, and move it along: in transit, at
  customs, cleared, arrived. Its order lines follow each step. When it
  arrives, its purchase orders are received into the warehouse, and its
  costs count towards the estimates once they are filled in.

`/admin/logistics/estimates` shows, for each route into our country, the
typical freight and fees per chargeable kilogram, the insurance rate and
the days in transit. Each is the median of the most recent arrived
shipments on that route (20 to start), so one odd shipment doesn't move
it. Staff can set their own figure for any route, field by field, when the
history is thin or rates have changed, and go back to the history later.
The page also estimates a consignment from its weight, volume and value.

The first shipment samples are loaded by the seed and marked (demo). The
start-up check refuses to run in production while they exist: load the
business's own records and remove the demo ones from each shipment's page.

## Duty and levies

`/admin/logistics/duty` holds one rule per category and country goods
land in, plus an optional rule for every category. A category without its
own rule uses its parent's, then the rule for every category. Each rule
has a duty rate, other levies charged on the same value, and the origins
that are duty free (for Botswana, the customs union: ZA NA LS SZ). VAT is
left out, as it is claimed back. A category can also carry its customs
tariff (HS) code, printed on commercial invoices.

The country goods land in is the default warehouse's country, else the
one in the rules.

## Tracking

Every order line shows where it is: ordered, shipped by the supplier, in
transit, at customs, cleared customs, in our warehouse, out for delivery,
delivered. Steps are recorded by themselves:

| Step | When |
| --- | --- |
| Ordered | The purchase order reaches the supplier, by email or marked sent on WhatsApp |
| Shipped by the supplier | The supplier says it shipped, on their page |
| In transit, at customs, cleared | Its live shipment reaches that step |
| In our warehouse | Its purchase order is received, or it was taken from stock |
| Out for delivery | Its delivery is dispatched, or the order is marked sent |
| Delivered | Its delivery is signed for, or the supplier delivered it straight to the customer |

Automatic steps only move forward. Staff can set any step by hand on the
order's page, with a note. Customers see each step and its time on their
order page; the notes, and who recorded each step, are for staff only.

## Stock and drop-shipping

Warehouses are set up at `/admin/stock`. One is the default: goods are
bought into it and sent from it, and its address is printed on purchase
orders. `/admin/stock` shows what is on hand, what is kept for orders and
what is free, and staff record counts there. A count below what is kept
for orders is refused.

When an order is paid or put on account, each line is first **kept from
free stock** in the default warehouse when there is enough (switch this
off in the rules to always buy). Only the rest is bought. Bundles are
always bought. When a purchase order arrives, its goods go on hand and
are kept for the order lines they were bought for. They leave stock with
the delivery. Cancelling an order frees what was kept for it.

**Drop-shipping**: with **Ask suppliers to deliver straight to customers**
on, purchase orders for delivery orders ask the supplier to deliver to the
customer, whose name, phone and address then appear on the purchase order.
Staff can switch each purchase order either way before it is sent. A
drop-shipped purchase order never touches stock; marking it received
means the customer has it.

## Deliveries and papers

On an order's page, staff **pack a delivery**: how many of each line go
in it. An order can go in several deliveries. Each is numbered
`DN-100001` onwards and has a **delivery note** (PDF) to print and pack:
what is in it, serial numbers from the supplier, no prices, and a space to
sign. **Dispatch** takes its goods out of stock and moves its lines out
for delivery; once everything has left, the order is marked sent and the
customer emailed. **Mark delivered** records who signed and, optionally,
the signed note or a photo as **proof of delivery**.

The **commercial invoice** (PDF) is for customs on cross-border
deliveries: each line's tariff code, origin country and weight, the
values, the Incoterm from the rules (DAP to start) and a declaration.

Customers see dispatched deliveries on their order page, with the
delivery note, the proof of delivery and the commercial invoice. Suppliers
are never named on any of them.

`/admin/deliveries` lists every delivery. The admin menu counts live
shipments on their way and deliveries being packed or on the road.

## Who can do what

| | Admin | Sales | Procurement | Logistics | Finance |
| --- | --- | --- | --- | --- | --- |
| See shipments, stock and deliveries | yes | yes | yes | yes | yes |
| Record shipments, set freight figures | yes | | yes | yes | |
| Count stock, set up warehouses | yes | | | yes | |
| Pack, dispatch and deliver, set tracking | yes | yes | | yes | |
| Change duty and logistics rules | yes | | | | |
