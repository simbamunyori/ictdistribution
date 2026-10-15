# Search, the site assistant and search engines

## Search

The search box and category pages match a product when every word
typed is in its name, brand, part number, category or specifications.
Common other words count as the same thing, so "laptop" finds
notebooks and "ups" finds uninterruptible power supplies. The groups
are in `src/lib/assistant.ts`.

When nothing matches every word, the page says so, links to the
assistant with the words already typed, and shows close matches: first
products with most of the words, then products whose wording is close
to what was typed, so a slip like "thinkpda" still finds ThinkPads.

## The assistant

`/assistant` (linked as **Ask our assistant** in the site header) takes
a need in plain words, such as "laptops for a 20 person office under
P12,000 each", and answers with products from our range.

- It sees only what the shop shows that visitor: name, part number,
  specifications, their own price and lead time. Never a supplier, a
  cost or a margin.
- Individuals and visitors not signed in see retail prices, including
  tax. Products sold to businesses only show that they need a business
  account or a quote.
- Approved businesses see their own prices. For businesses the
  assistant drafts a quote request with lines and quantities; **Check
  and send it** opens the quote form already filled in.
- **Rather talk to a person?** passes the conversation to Sales with the
  visitor's name and email. Sales are emailed a link and the
  conversation appears in `/admin/assistant`.

Conversations are found again by a secret kept in a cookie in the
visitor's browser, so nobody else can read them. A conversation started
before signing in carries on afterwards; someone else's never does.
Every answer is checked against our copy rules (no exclamation marks or
em dashes) before it is shown.

With `ANTHROPIC_API_KEY` set, Claude answers: it searches the catalogue
through a tool, chooses what to show and explains why. Without the key,
or when Claude can't be reached, simple rules search for the words
typed, read a budget ("under P12,000") and a number ("for 20 users", "5
x") and offer the same next steps. Visitors see the same page either
way.

### For staff

`/admin/assistant` lists conversations passed to Sales (oldest first),
recent ones and closed ones. Open one to read it, see the drafted quote
lines and the visitor's details, then **Mark dealt with**. The badge in
the menu counts those waiting.

Who can do what:

| Role | Read and close conversations | Settings |
| --- | --- | --- |
| Admin | Yes | Yes |
| Sales | Yes | Yes |
| Support | Yes | No |
| Others | No | No |

Settings on the same page: turn the assistant off, send handovers to
one address instead of every Sales member, and the most messages in one
conversation (30 to start with). Each visitor can ask 40 questions in
ten minutes and pass to Sales 5 times an hour.

## Search engines

- Product pages carry a description, a canonical address and
  structured data (schema.org Product with brand, part number, warranty
  and availability, and the breadcrumb). The price is included only for
  products individuals can buy, as the retail price; trade prices never
  appear.
- Category pages carry a description and canonical address. Filtered
  and searched product lists are marked not to be indexed.
- `/sitemap.xml` lists the products, categories, specials and the
  assistant. `/robots.txt` keeps search engines out of accounts, the
  admin area, the cart, checkout, invoices and credit notes.

After the first deploy, add the site in Google Search Console and submit
`https://ictdistribution.africa/sitemap.xml` under **Sitemaps**.

## Hand steps

The assistant uses the same `ANTHROPIC_API_KEY` as the automated
quotations. If it is already set for quotes, there is nothing to do. If
not, follow step 1 in [quotes.md](quotes.md), then restart:

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```
