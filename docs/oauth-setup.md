# Google and Facebook sign-in

Email + password + two-factor always works. Google, Facebook (and GitHub) are
optional extra buttons on the sign-in screen: each appears once its client id and
secret are in the settings file, and each still asks for the two-factor code
afterwards.

Apple sign-in is not offered: it needs a paid Apple Developer account.

## 1. Find your callback address

Every provider asks for the exact address it sends people back to. It is the
dashboard's own address followed by `/api/auth/oauth/<provider>/callback`, and it
is compared character for character:

| Install | Google | Facebook |
|---|---|---|
| Raspberry Pi (tailnet) | `https://<pi>.<tailnet>.ts.net/api/auth/oauth/google/callback` | `https://<pi>.<tailnet>.ts.net/api/auth/oauth/facebook/callback` |
| Public address (`--public-origin`) | `https://<that address>/api/auth/oauth/google/callback` | `https://<that address>/api/auth/oauth/facebook/callback` |
| Local only (Windows, Linux) | `http://127.0.0.1:8000/api/auth/oauth/google/callback` | see the note below |

`signal status` prints the address (the line `address`). Use `127.0.0.1`, never
`localhost`: they are separate addresses to the browser, and the sign-in would
come back to the wrong one.

**Facebook and a local-only install.** Facebook enforces HTTPS for its callback
addresses. Third-party guides disagree on whether it still makes an exception for
plain-http local addresses, and the exception they describe is for `localhost`,
not `127.0.0.1`. Plan on Facebook working only on an `https://` address: the Pi's
tailnet address, or a public one. Google and GitHub work on the local address.

## 2. Google

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a
   project (or pick one).
2. **Google Auth Platform → Branding**: an app name and your support email.
   **Audience**: *External*. While the app is in *Testing*, only the Google
   accounts you add as test users can sign in; **Publish app** lets anyone in.
   This app asks only for `openid email profile`, which needs no Google review.
3. **Clients → Create client → Web application**. Under **Authorized redirect
   URIs** add the Google callback address from step 1. Several are fine, for
   example the Pi's and a local one.
4. Copy the **Client ID** and **Client secret**.

Google can take from a few minutes to a few hours to accept a newly added
address. Until then it answers `redirect_uri_mismatch`.

## 3. Facebook

1. Open [Meta for Developers](https://developers.facebook.com/apps/) → **Create
   app**. Choose the use case **Authenticate and request data from users with
   Facebook Login**.
2. In that use case's settings, make sure the **email** permission is included
   (with `public_profile`).
3. **Facebook Login → Settings**: **Client OAuth login** and **Web OAuth login**
   on, **Enforce HTTPS** on, and the Facebook callback address from step 1 under
   **Valid OAuth Redirect URIs**. Strict mode needs the exact address, which is
   what this app sends.
4. **App settings → Basic**: copy the **App ID** and **App secret**. Add a privacy
   policy address there; Meta asks for one before the app can go **Live**. Until
   it is Live, only people with a role on the app (you, testers) can sign in.

The app calls Graph API **v25.0**, which Meta lists as supported until
29 July 2028. When Meta retires it, set `STOCKS_OAUTH_FACEBOOK_GRAPH_VERSION` to a
current version; no code change is needed.

## 4. Put the keys in the settings file

`/etc/stocks-dashboard/stocks.env` on a Pi or Linux,
`C:\ProgramData\SignalDashboard\settings.env` on Windows:

```
STOCKS_OAUTH_GOOGLE_CLIENT_ID=...
STOCKS_OAUTH_GOOGLE_CLIENT_SECRET=...
STOCKS_OAUTH_FACEBOOK_CLIENT_ID=...
STOCKS_OAUTH_FACEBOOK_CLIENT_SECRET=...
```

Then apply them:

```bash
sudo signal restart
```

The buttons appear on the sign-in screen.

## Who a social sign-in lets in

- An account that already exists with the same **verified** email is linked to
  the Google or Facebook account on first use. After that, either way of signing
  in reaches the same account.
- A new account is created only when sign-up is open (`STOCKS_REGISTRATION=open`
  or `approval`). In `approval` mode it waits for the admin like any other
  sign-up.
- With `invite` or `closed`, a social sign-in can only link to an existing
  account: there is nowhere to type an invite code on the way back from Google.
  The sign-in screen says so, and suggests creating the account with email and
  the code first.
- A provider that doesn't share a verified email is refused, with a message
  saying why.
