# Exchange rates

Our costs are kept in US dollars (the base currency). Customers see every
price in their market's currency: Botswana in pula, South Africa in rand,
Zimbabwe in US dollars.

## Where they come from

Every six hours (at 00:15, 06:15, 12:15 and 18:15 Gaborone time) the app
fetches the day's rates from US dollars to every currency switched on at
`/admin/markets`, from the free [ExchangeRate-API](https://www.exchangerate-api.com)
open endpoint (no key; `RATE_SOURCE=open-er-api`). Its terms ask for a link
back, which `/admin/exchange-rates` carries. With `RATE_SOURCE=off`, staff
type the rates instead.

## Checks before a rate is used

- A rate that moved more than the hold threshold (10% to start) since the
  one in use is stored but **held back**. Prices keep using the earlier
  rate until an Admin or Finance accepts it at `/admin/exchange-rates`.
  The overview page and the admin menu show how many are waiting.
- A fetch that fails, or sends rates missing a currency we use, changes
  nothing and is shown on the overview with the reason.
- A rate older than the warning age (48 hours to start) is flagged.
- Staff can set a rate by hand at any time; it is used at once, until a
  newer fetch replaces it. Every acceptance and change is in the audit log.

## From cost to price

For a product that costs us `cost` in US dollars:

1. **Markup** for the customer's type (`/admin/customer-types`):
   Individual, Business, Reseller, Government and enterprise.
2. **Conversion** at the rate in use plus the market's exchange buffer
   (2% to start, 0% for Zimbabwe), which covers the rate moving between
   the sale and our payment to the supplier.
3. **Rounding up** to the market's step (1.00 to start, so P 13,924.23
   shows as P 13,925.00).

The maths is exact (whole minor units and exact fractions, never floating
point) and lives in `src/lib/pricing.ts`. `/admin/markets` shows what an
example cost sells for in every market at every price level with today's
rates. Product categories, specials and supplier costs arrive in later
milestones and slot into the same steps.
