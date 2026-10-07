# Business customers, trade prices and credit

Businesses register, send their company details, and see trade prices
once our staff approve them. Approved businesses can apply for credit
and buy on account.

## Checking a business

1. The owner signs up as a business, or sets up an organisation from
   their account.
2. At **Your account, Business details** they enter the registered name,
   registration number, tax number, registered address and directors,
   and add documents: the registration certificate and the tax
   certificate are needed; director IDs and proof of address are
   optional. PDF, JPEG, PNG or WebP, up to 10 MB each, 12 at most.
3. They press **Send for checking**. The details are locked while staff
   check them.
4. Staff with Admin, Sales or Finance roles see a count on **Customers**
   in the admin menu. Tick "Waiting to be checked" to list them, open
   one, read the documents (every opening is in the audit log) and
   either **Approve** or **Send back** with a note the owners receive by
   email.
5. Until approved, a business buys at Individual prices and cannot see
   products sold only to businesses. An approval can be withdrawn later
   from the same page.

Documents are stored in the database with the rest of the customer's
records, so the nightly backup covers them. Only staff can open them, at
`/admin/documents/<id>`.

## Price levels

Each customer type (Individual, Business, Reseller, Government or
enterprise) is a price level at **Price levels** (`/admin/customer-types`):

- **Markup**: the level's own markup on our landed cost.
- **Markup by category**: a different markup for a category and the
  categories under it, unless they have their own.
- **Volume breaks**: a percentage off each unit when buying at least a
  quantity of one product, for every product or one category. The
  highest break reached applies. Breaks do not stack on special units or
  on agreed prices.

A business's level is set on its customer page. Changes apply to the
next page anyone opens.

## Agreed prices

On a customer's page, Sales or an Admin can agree a price for one
product, in the customer's market currency and including tax, with an
optional end date. It replaces the level's price for that business only.
A special that is lower still wins. The customer sees "Your agreed
price" on the product.

## Credit

1. An approved business's owner or finance contact applies at **Your
   account, Credit** with the limit and days to pay they need, their
   usual monthly spend and two trade references.
2. Finance (or an Admin) sees a count on **Credit** in the admin menu and
   approves, with the limit and days to pay, or declines with a note. The
   owners and finance contacts get an email either way.
3. At checkout the business can choose **On account** while it has
   credit available. The order goes ahead straight away and can be sent
   before it is paid; it is due the set number of days after ordering.
4. Every order on account that is not cancelled counts against the
   limit until payments cover it. An order that would take the balance
   over the limit is refused, even when two are placed at the same moment.
5. Finance records payments on the order as before. Once an account
   order is covered the customer is told it is settled.
6. On the customer's page Finance can change the limit and days to pay,
   put the account on hold (no new orders on account), or close it by
   emptying the limit. What is owed stays owed.

The customer's **Credit** page shows the limit, what is owed, what is
overdue and each order still to pay.
