# Quotes

How a request for quote becomes a priced, branded quote, and what staff
and the Admin control. Every rule here is set at `/admin/quotes/rules`.

## Asking for a quote

- **On the site**: a signed-in customer opens **Account > Quotes > Ask for
  a quote** (`/account/quotes/new`). They type lines (one per line, like
  `5 x Dell P2425H`), paste a list, or attach a spreadsheet, bill of
  materials or tender document (PDF, Excel or CSV, up to 10 MB). Each
  request is a **standard** quote, a **reseller project** or, for
  organisations, a **tender** with its reference, closing time and the
  documents it asks for. In an organisation, Owners and Buyers can ask.
- **By email**: anything sent to `QUOTES_EMAIL` becomes a request. A sender
  with an account is linked to it; a subject with "tender" in it marks a
  tender. Requests from people without an account always wait for a
  check. Each address can send 10 requests a day.
- **WhatsApp** comes with the messaging hub in a later milestone.

## Reading the request

Claude reads the request into clean lines and matches each to the
catalogue: an exact part number is a sure match, a close name is a likely
one. Lines it can't read with confidence are flagged for staff. Without
`ANTHROPIC_API_KEY`, simple rules read typed lines and spreadsheets, and a
PDF becomes one flagged line for staff to type in.

The Claude calls use server-side fallbacks, so a request is still read
if the first model is busy. If Claude can't be reached at all, the rules
read it instead.

## Pricing

1. **Lines with a current catalogue price** are priced straight away from
   the supplier the sourcing rule picks.
2. **The rest go to suppliers.** Every active supplier that offers the
   product, or supplies its category (set on the supplier's page), gets a
   request for price with a link to its own response page. Suppliers with
   an email address get it by email; suppliers with only WhatsApp appear
   in the staff queue with an **Open in WhatsApp** button, ready to send.
   They have **Hours suppliers get to answer** to reply (**Hours when
   urgent** for urgent requests), and always a day before a tender closes.
   Suppliers see the lines only, never the customer.
3. **Supplier answers** come from the response page, from a plain email
   reply to the request (Claude reads the prices; only the supplier's own
   addresses can set prices), or typed in by staff. As soon as the last
   supplier answers, or the deadline passes, the quote is priced.
4. **The price** of each line is the best supplier's landed cost (by the
   sourcing rule) plus the markup: the tender or reseller project markup
   when set, otherwise the category's markup for the customer's price
   level, otherwise the level's own. It is converted at the current rate
   with the market's buffer and rounded up to the market's step. Quotes
   show prices before tax, with the tax added on the total.

## Sending

A priced quote goes out by itself only when every rule is met:
automatic sending is on, its value is at most **Most it can be worth**,
its margin is at least **Lowest margin**, every line is matched at least
as surely as **Surest match needed**, no line is flagged, and the
customer has an account. Anything else waits at `/admin/quotes` with the
reasons listed.

The quote email links to the quote and to its branded PDF (logo, lines,
delivery, validity, payment terms and bank details), with an **Accept**
button on both. The customer
can also see and accept it under **Account > Quotes**. Payment terms are
"on account" for organisations with open credit, and bank transfer
before delivery otherwise. Accepting asks for delivery or collection, a
phone number and how to pay, and turns the quote into an order at the
quoted prices: on account straight away when the credit covers it, or by
bank transfer against a pro forma invoice. Sales hear by email. What
happens next is in [procurement.md](procurement.md).

## Checking a quote (staff)

`/admin/quotes/<quote>` shows why it waits, each line with its match,
cost and supplier answers, and buttons to send it, ask suppliers about
lines without a cost, price it again, or add datasheets and warranty
details per line (the tender pack). **Check or change this line** fixes
the description or quantity, links it to one of our products by part
number, or sets a cost or a price by hand. Costs, suppliers and margins
show only to roles that may see suppliers, and never to customers.

Sales get one email when a tender closes within **Remind staff this many
hours before a tender closes** and its quote is still being prepared.

## Win rate

`/admin/quotes/report` shows requests, quotes sent (and how many went out
by themselves), won, lost, win rate and average time to quote, by type
and by category, for the last 30, 90 or 365 days.

## Setting it up

These are optional: without them, requests come only from the site,
rules read them, and suppliers answer only on their response page.

**1. Claude.** At https://platform.claude.com, open **API keys > Create
key**, name it `ictd-quotes`, and copy it. Then on the server:

```sh
ssh -t root@SERVER 'nano /opt/ictd/.env'
```

Set `ANTHROPIC_API_KEY=` to the key, save, and run:

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```

**2. The quotes mailbox.** In the mail host's control panel, create the
mailbox `quotes@ictdistribution.africa` with a strong password. Then set
these two lines in `/opt/ictd/.env` (an `@` in the user name is written
`%40`):

```sh
QUOTES_EMAIL=quotes@ictdistribution.africa
IMAP_URL=imaps://quotes%40ictdistribution.africa:PASSWORD@mail.ictdistribution.africa:993
```

and restart:

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```

The mailbox is checked every two minutes. Read messages are left in it
and marked as read. To check it works, email a line such as
`2 x DEMO-P2425H` to the address and watch `/admin/quotes`.

**3. Suppliers.** On each supplier's page at `/admin/suppliers`, tick the
categories they supply and make sure they have an email address or a
WhatsApp number.
