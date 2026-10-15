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
- **WhatsApp** carries requests for price to suppliers and their answers
  (see [WhatsApp](#whatsapp) below). Customers can't ask for quotes on
  WhatsApp yet: a message from a number that isn't a supplier's is logged
  and left alone.

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
   an email address get it by email. Once WhatsApp is connected, suppliers
   with a WhatsApp number get it there too, so a supplier with both gets
   it on both (one request, one link; **Send requests for price on
   WhatsApp too** in the rules turns this off). Until then, suppliers
   with only WhatsApp appear in the staff queue with an **Open in
   WhatsApp** button, ready to send, and so does any WhatsApp request
   that can't be delivered.
   They have **Hours suppliers get to answer** to reply (**Hours when
   urgent** for urgent requests), and always a day before a tender closes.
   Suppliers see the lines only, never the customer.
3. **Supplier answers** come from the response page, from a plain email
   or WhatsApp reply to the request, or typed in by staff. Claude reads
   replies, and also the quote they attach or send: a PDF, a spreadsheet
   or a photo. It reads the price per unit, how many they have, the lead
   time, how long the price holds and any delivery charge. Only the
   supplier's own addresses and numbers can set prices; anything else is
   kept on the request with its files for staff. Without
   `ANTHROPIC_API_KEY`, replies are kept for staff to enter. As soon as
   the last supplier answers, or the deadline passes, the quote is
   priced.
4. **The price** of each line is the best supplier's landed cost (by the
   sourcing rule): their price plus freight, insurance, duty and clearing
   estimated from our shipments ([logistics.md](logistics.md)), or the
   supplier's landed cost allowance when those can't be estimated. A
   delivery charge the supplier quotes takes the place of our freight
   estimate. Then comes the markup: the tender or reseller project markup
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

Under **Supplier requests**, each request shows how it went out and how
far it got: the email (waiting to go, sent or failed) and the WhatsApp
message (waiting to go, sent, delivered, read or failed, with WhatsApp's
reason). **Their reply** shows every email and WhatsApp message they
sent, and the files they attached open from there.

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
WhatsApp number. Write WhatsApp numbers in international format, such as
`+8613800000000`: replies are matched to the supplier by that number, its
phone number and its contacts' numbers.

**4. WhatsApp.** See [WhatsApp](#whatsapp) below.

## WhatsApp

Requests for price go to suppliers through the WhatsApp Business Cloud
API, from our own business number, and their replies come back to
`https://ictdistribution.africa/api/whatsapp`. While it isn't set up,
WhatsApp requests are sent by hand from the quote page, as before.
`/admin/quotes/rules` says whether it is connected and which settings
are missing.

How it works:

- The first message to a supplier is an approved template (WhatsApp
  allows free text only within 24 hours of them writing to us). It names
  the request, the deadline and the lines, and links to their response
  page. It never names the customer.
- The supplier answers on the page, or replies on WhatsApp in their own
  words, or sends their quote as a PDF or a photo (up to 10 MB). Claude
  reads it like an email reply, prices the quote again, and the customer
  gets it as our quote, in our name and branding, with our PDF.
- A reply is matched to the request whose message they replied to, else
  a reference such as `RFQ-7K2M9Q` in their text, else their most recent
  open request.
- Messages that can't be delivered (a number not on WhatsApp, a
  template not approved) are retried when that can help, and otherwise
  go back to staff to send by hand.

Setting it up takes an afternoon, plus up to a day for Meta to approve
the template.

**1. A Meta business account.** At https://business.facebook.com, create
the business account **ICT Distribution** (or use the one you have).
Under **Settings > Security center**, start **Business verification**
with the company's registration documents. Messages work before it is
verified, but only up to 250 suppliers a day.

**2. The app.** At https://developers.facebook.com, open **My apps >
Create app**. Choose **Other**, then **Business**, name it `ICTD Quotes`,
and pick the business account from step 1. On the app's page, find
**WhatsApp** and choose **Set up**. This also makes a WhatsApp Business
account for the business.

**3. The phone number.** In the app, open **WhatsApp > API setup > Add
phone number**. Use a number that isn't on WhatsApp now (a number on the
WhatsApp app has to be deleted from the app first). Display name: `ICT
Distribution`. Verify it with the code Meta sends by SMS or call. Copy
the **Phone number ID** shown under the number (a long number; it is not
the phone number itself).

**4. Payment.** In WhatsApp Manager (https://business.facebook.com/wa/manage),
open **Payment settings** and add a card. Meta charges per template
message to a supplier; replies within 24 hours are free.

**5. A permanent token.** In https://business.facebook.com, open
**Settings > Users > System users > Add**. Name it `ictd-whatsapp`, role
**Admin**. Choose **Assign assets**: the app `ICTD Quotes` with full
control, and the WhatsApp account with full control. Then **Generate new
token**: app `ICTD Quotes`, expiry **Never**, and tick
`whatsapp_business_messaging` and `whatsapp_business_management`. Copy
the token; Meta shows it once.

**6. The template.** In WhatsApp Manager, open **Message templates >
Create template**. Category **Utility**, name `price_request`, language
**English** (its code, `en`, goes in `WHATSAPP_TEMPLATE_LANGUAGE`; if you
pick English (US) it is `en_US`). No header, no buttons. Body, exactly:

```text
Hello {{1}}, ICT Distribution would like your best prices for request {{2}} by {{3}}. Lines: {{4}}. Answer on your page: {{5}} or reply to this message with your price per unit, quantity available, lead time and any delivery cost. A PDF or photo of your quote is fine.
```

Footer (optional): `ICT Distribution Africa`. For the samples Meta asks
for, use `Shenzhen Networks`, `RFQ-7K2M9Q`, `16 Oct 2026, 14:00`,
`L1: 6 x Ubiquiti U7 Pro access point; L2: 2 x USW-Pro-24-PoE switch`
and `https://ictdistribution.africa/supplier/rfq/sample`. Submit it, and
wait until it shows **Active**.

**7. The app secret and a verify token.** In the app, open **App
settings > Basic**, choose **Show** next to **App secret**, and copy it.
Make a verify token on any computer:

```sh
openssl rand -hex 24
```

**8. The server.** Open the settings:

```sh
ssh -t root@SERVER 'nano /opt/ictd/.env'
```

add these lines with the values from above, save, and restart:

```sh
WHATSAPP_TOKEN=the token from step 5
WHATSAPP_PHONE_NUMBER_ID=the phone number ID from step 3
WHATSAPP_TEMPLATE=price_request
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_APP_SECRET=the app secret from step 7
WHATSAPP_VERIFY_TOKEN=the verify token from step 7
```

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```

**9. The webhook.** In the app, open **WhatsApp > Configuration >
Webhook > Edit**. Callback URL:
`https://ictdistribution.africa/api/whatsapp`. Verify token: the one from
step 7. Choose **Verify and save** (the server must be restarted with the
new lines first). Then under **Webhook fields**, choose **Manage** and
subscribe to `messages`.

**10. Live mode.** In **App settings > Basic**, add a privacy policy
address, save, and switch **App mode** at the top of the page to
**Live**. Until then Meta only sends replies from the app's own testers.

**11. Check it.** On a supplier's page, put your own mobile number in
**WhatsApp**, and make sure the supplier supplies a test category. Ask
for a quote for a line in that category. Within a minute the request
arrives on your phone and `/admin/quotes/<quote>` shows it **delivered**,
then **read**. Reply with a price, such as `L1: 120.00 each, 5 in stock,
3 days`, and the answer shows on the quote within a minute. Put the
supplier's own number back afterwards.

To stop sending on WhatsApp without removing the settings, untick **Send
requests for price on WhatsApp too** at `/admin/quotes/rules`.
