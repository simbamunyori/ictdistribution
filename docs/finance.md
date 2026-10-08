# Finance and reporting

Invoices, credit notes and statements are in [portal.md](portal.md) and
[aftersales.md](aftersales.md). This covers chasing what is owed, the
reports and the export to the accounting package. Supplier names, costs
and margins appear only in the admin area.

Who can do what:

| Role | Reports | Chase invoices, export, finance settings |
| --- | --- | --- |
| Admin | Yes | Yes |
| Finance | Yes | Yes |
| Sales | Yes | No |
| Others | No | No |

## Receivables and reminders

`/admin/finance` lists what customers owe, by currency and by age (not
yet due, 1 to 30 days late, 31 to 60, 61 to 90 and over 90), and every
overdue invoice with what is still to pay after credit notes, payments
and refunds. **Send a reminder** emails the customer straight away.

The daily job (`invoice-reminders`, 08:00 Botswana time) sends reminders
on the schedule in `/admin/finance/settings`:

- the first a set number of days after the due date (3 to start with);
- then every so many days (7);
- up to a most per invoice (3).

Each reminder says what is still to pay, shows the bank details and has
its own link to the invoice, which opens it without signing in. Turning
reminders off stops the job; sending by hand still works. The order's
page in the admin area lists the reminders sent.

A business customer's page has an **Accounts** card: open invoices, their
statement as a PDF, and their account code for the accounting package.

## Reports

`/admin/reports`, for any period (the last three months by default):

- **Sales and margin** by market, category, customer type, supplier and
  top customers, and margin per order. Sales are orders that went ahead,
  before tax, in the base currency at the rate in use on the day each was
  placed. Cost is the landed cost recorded on each line when it was sold.
- **Credited**: credit notes issued in the period, before tax.
- **Quotes**: requests, quotes sent, quotes sent by themselves, win rate,
  and the middle and average time from request to quote.
  `/admin/quotes/report` breaks the win rate down by type and category.
- **Supplier performance**: purchase orders, how soon each supplier
  confirms and ships, how often they ship by the date they gave, and how
  many requests for price they answer and how quickly.
- **Stock**: units held and their value at landed cost, by warehouse and
  category.
- **Open orders**: orders not yet sent, by state, with their value and
  the oldest.

## Export to accounting

`/admin/finance/export`: choose a period, then download one of:

| File | Import it in |
| --- | --- |
| Xero: sales invoices and credit notes | Business, Invoices, Import. Credit notes come in as negative invoices, which Xero turns into credit notes. |
| QuickBooks Online: invoices and credit memos | Settings, Import data, Invoices. Credit notes have negative amounts. |
| Sage 50: invoices, credits and receipts | File, Import, Audit trail transactions. |
| Payments and refunds | Any package, or the bank reconciliation. |

Codes come from the finance settings: the sales account, the bank
account (Sage receipts), the tax codes for taxed and zero-rated sales,
and the customer account used for individuals. Business customers go
under their account code, set on their page; with none set, one is made
from their name (for example `KALAHARI`). Create the same customer
accounts in the package first, or let it create them on import.

Every line goes in before tax with its share of the tax, so the totals in
the package match ours to the cent. Sage 50 has no import for money paid
back: enter refunds from the payments file. Each download is recorded in
the audit log.

Dates are written dd/mm/yyyy. If the package is set to another date
order, change it on the import screen.
