# Sign-in set-up

Nobody has a password. Customers sign in with any one of:

- a six-digit code emailed to them (always on; needs `SMTP_URL`);
- a passkey (always on; their fingerprint, face or device PIN);
- Microsoft (work, school or personal accounts);
- Google.

Staff sign in at `/admin/sign-in` with an emailed code or Microsoft (only
from our own Microsoft tenant), then always their passkey. A passkey on
its own also signs staff straight in.

Microsoft and Google stay hidden until their settings are in
`/opt/ictd/.env`. Passkeys belong to the address in `APP_URL`
(`https://ictdistribution.africa`), so that must not change after people
add them.

## Microsoft

In the [Microsoft Entra admin centre](https://entra.microsoft.com), signed
in to the ICT Distribution tenant:

1. **Identity > Applications > App registrations > New registration**.
2. Name: `ICT Distribution Africa`. Supported account types: **Accounts in
   any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Web**,
   `https://ictdistribution.africa/auth/microsoft/callback`. **Register**.
4. **Authentication > Add URI**:
   `https://ictdistribution.africa/admin/auth/microsoft/callback`. **Save**.
5. **Token configuration > Add optional claim > ID**, tick `email` and
   `xms_edov`, **Add** (tick "Turn on the Microsoft Graph email
   permission" when asked). Work accounts count as proven only when
   Microsoft vouches for their email domain (`xms_edov`).
6. **Certificates & secrets > New client secret**, 24 months, **Add**.
   Copy the **Value** now; it is shown once.
7. **Overview**: copy the **Application (client) ID** and the
   **Directory (tenant) ID**.

Then on the server:

```sh
ssh -t root@SERVER 'nano /opt/ictd/.env'
```

```
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<the secret's Value>
MICROSOFT_STAFF_TENANT_ID=<Directory (tenant) ID>
```

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```

Put a reminder in the calendar to make a new secret before this one
expires.

## Google

In the [Google Cloud console](https://console.cloud.google.com), in a
project for ICT Distribution:

1. **APIs & Services > OAuth consent screen**: External, app name
   `ICT Distribution Africa`, support email, logo from
   `brand/png/ictd-mark-512.png`, authorised domain
   `ictdistribution.africa`. Scopes: `openid`, `email`, `profile`.
   **Publish app**.
2. **APIs & Services > Credentials > Create credentials > OAuth client
   ID**: Web application, name `ICT Distribution Africa`, authorised
   redirect URI `https://ictdistribution.africa/auth/google/callback`.
   **Create**, then copy the client ID and secret.

```
GOOGLE_CLIENT_ID=<client ID>
GOOGLE_CLIENT_SECRET=<client secret>
```

```sh
ssh root@SERVER 'sudo -u deploy ictd restart'
```

Google is for customers only; staff never sign in with it.

## How accounts are matched

- A Microsoft or Google account already linked signs straight in.
- One whose email matches an existing customer gets an emailed code
  first; entering it links the two, so nobody can take over an account by
  creating a provider account with someone else's address.
- One with a new email goes on to sign up, with the email already proven.
- Customers add and remove passkeys and linked accounts at
  `/account/sign-in-methods`, after a fresh check (a passkey or an emailed
  code in the last 15 minutes). Every change is emailed to them and
  logged.
