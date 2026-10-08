# Catalogue and suppliers

Everything here is set in the admin area. Staff with the Admin or
Procurement role change the catalogue and suppliers; Sales, Logistics and
Finance can look at suppliers but not change them.

Supplier names, costs, codes and sourcing are internal. The shop reads
products through its own queries (`src/server/catalogue/shop.ts`), which
never load offers or suppliers, and a test checks that no supplier name,
cost or code reaches a shop page.

## Categories

`/admin/categories`. Categories go one level deep: a top-level category
(Networking) with subcategories (Switches, Routers). The first deploy adds
21 starter categories with their specifications; change or remove them
freely.

Each category has its **specifications**: the fields products in it
fill in, such as Memory (GB) or Wi-Fi standard. A subcategory has its own
fields and its parent's. For each field you choose:

- **Kind**: text, number (with a unit), yes or no, or one of a list.
- **Filter on it**: shown as a filter in the shop. A number with more than
  15 different values becomes a from and to range.
- **Show on cards**: shown under the name in product lists.
- **Must match for suggestions**: see below.

The field's key (`memory_type`) is fixed once added, because product
values are stored under it. Keys are unique across a category, its parent
and its subcategories.

**Suggestions.** On a category you choose the categories whose products
the shop suggests with it ("You may also need"): laptops suggest memory,
bags and docks. Where both categories have the same field marked "must
match", such as Memory type, only products with the same value are
suggested, so a DDR5 laptop never suggests DDR4 memory.

## Products

`/admin/products`. A product has a brand, a manufacturer part number,
a category, its specifications, up to 12 images and 6 PDF datasheets,
a warranty, and a status: Draft, In the shop, or Archived. Brand and part
number together are unique. "Sell to individuals" off means the shop
shows the product only with trade prices, from D3.

Images are resized on upload (1600 px and a 480 px thumbnail, WebP) and
kept in the database with everything else, so the nightly backup has
them. Each needs a short description for people who can't see it.

"Goes well with" links two products both ways, such as a switch and its
SFP modules.

## Suppliers

`/admin/suppliers`. Each supplier has a kind (local distributor,
international, China-based), a country, the currency they bill in,
contacts (email, WhatsApp, phone, portal), the categories they supply,
their usual lead time, a minimum order, and a **landed cost** percentage:
freight, duties and clearing added to their price to compare it fairly
with a local supplier's.

The **performance record** is a list of events staff add: delivered on
time, late, a quality problem, a wrong item, or a note. The supplier page
shows the on-time share and the problems over the last year.

## Offers and the sourcing rule

On a product page, each supplier's **offer** is their cost in their
currency, with their own code, lead time, minimum order and stock. A
product can have any number of offers.

The **rule** picks which offer we buy from:

- **Cheapest landed cost**: the lowest cost once the landed cost
  percentage is added, in US dollars at today's rate. Ties go to the
  fastest.
- **Fastest**: the shortest lead time. Ties go to the cheapest.
- **Preferred supplier**: suppliers marked preferred first, the cheapest
  of them.

An offer with stock 0 is chosen only when nobody else has it. The rule is
set at `/admin/sourcing` for everything, and can be changed per category,
per subcategory or per product; the most specific one wins. The product
page shows every offer ranked, which one is chosen and why, and what each
customer type would pay in each market.

## Price lists

On a supplier's page, **Upload a price list** takes a CSV (comma,
semicolon or tab) or an Excel `.xlsx` file of up to 10 MB. Old `.xls`
files must be saved as `.xlsx` or CSV first.

1. **Columns, the first time.** Say which column holds the part number
   and the cost (both needed), and, if the list has them, the brand, name,
   the supplier's own code, stock, lead time, minimum order and currency.
   Choose the sheet and the row the headings are on. This is saved for the
   supplier, and later lists in the same layout skip this step.
2. **Review.** Every line is matched to a product: by the supplier's own
   code on an existing offer first, then by part number (ignoring spaces,
   dashes and dots) and brand. The review shows prices up and down with
   how far they moved, new offers, lines with no matching product, lines
   that can't be read and why, and offers missing from the list.
3. **Apply.** Offers are added and updated. You can switch off offers the
   list no longer has, and add unmatched lines as draft products in a
   category you choose, to finish before they go in the shop. A cost
   typed by hand after the list was read is compared again, so it's
   never undone without showing. Only the newest list from a supplier can
   be applied; older ones waiting are set aside.

Costs are read the way suppliers write them: `1,234.50`, `1 234,50`,
`R 1234.5`. A currency column overrides the supplier's currency per line.

### Scheduled re-imports

When a supplier publishes their list at a fixed address, set it under
**Fetch on a schedule**: the https address, daily or weekly, and
optionally a percentage under which changes apply by themselves. The
hourly job fetches lists that are due. A list applies by itself only when
no matched price moved more than that percentage, no line has an error,
and (when "switch off missing offers" is on) nothing is missing. Anything
else waits for review, and the overview and the menu show a count.
Fetch errors are shown on the supplier's page.

Only https addresses on the public internet are fetched, without
following redirects, up to 10 MB. A list behind a sign-in has to be
downloaded and uploaded by hand.

## Shop

- `/products`: everything, with search.
- `/categories/<slug>`: one category, with filters for its specifications
  and brands. Each filter shows how many products ticking it would show.
- `/products/<slug>`: the product page.
- `/compare`: up to four products side by side, differences marked.

Search looks through the name, brand, part number, category and
specification values. Filters and counts work over up to 5,000 matching
products per search; past that the shop asks for a narrower search, and
D11's search index takes over.
