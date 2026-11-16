# Branded account emails

Supabase sends the account emails — the sign-up confirmation, the team
invitation and the password reset — from its own default templates unless you
replace them. Three branded templates ship in `supabase/email-templates/`:

| File | Supabase template | Subject line |
| --- | --- | --- |
| `confirm-signup.html` | **Confirm signup** | `Confirm your BROC account` |
| `invite-user.html` | **Invite user** | `You've been invited to BROC` |
| `reset-password.html` | **Reset password** | `Reset your BROC password` |

Both use the BROC wordmark, the app's green, and a layout built for email
clients: tables, inline styles, a system font stack (most clients block web
fonts) and a PNG logo with alt text (Gmail and Outlook do not render SVG).

## Setting them up (Supabase Cloud)

Do these in order. Supabase locks the template editor until a project has its
own email sender, and its built-in mailer only delivers to members of your
Supabase organisation, a few emails an hour, so the people you invite would
never receive anything. The sender comes first.

1. **Choose a sender** and enter it under **Authentication → Emails → SMTP
   Settings** (turn on *Enable custom SMTP*). Either of these works:

   | | Resend | Gmail |
   | --- | --- | --- |
   | Needs | A domain you own, verified in Resend | A Google account with 2-Step Verification |
   | Host / port | `smtp.resend.com` / `465` | `smtp.gmail.com` / `465` |
   | Username | `resend` | the full Gmail address |
   | Password | a Resend API key | an App Password (myaccount.google.com/apppasswords) |
   | Sender email | an address **on the verified domain**, e.g. `no-reply@yourdomain.com` | the same Gmail address |
   | Suits | Anything beyond a handful of people | Trying it out with people you know (about 500 emails a day) |

   Resend refuses to send *from* an address on a domain it has not verified —
   including `gmail.com` — and logs `Domain not verified`. In BROC that shows up
   as "Supabase could not send the invitation email". Resend's dashboard
   (**Logs**) shows the exact reason for every refused send.

2. **Authentication → URL Configuration.** Set **Site URL** to your app's public
   address, e.g. `https://app.yourdomain.com`. The templates use it for the
   confirmation link and to load the logo (`/brand/broc-wordmark-email.png`).
   Under **Redirect URLs**, add `https://<that address>/**`.

   If you also invite people from Vercel *preview* deployments, add a wildcard
   for those too, e.g. `https://*-<your-team>.vercel.app/**`. An invitation
   sent from an address that is not on this list falls back to the Site URL's
   home page instead of `/invite/accept`, and the invitee never gets to choose a
   password. (Setting `NEXT_PUBLIC_APP_URL` to the production address makes
   every invitation point there, wherever it was sent from.)
3. **Authentication → Emails → Templates → Confirm sign up.** Paste the subject
   from the table above and the whole of `confirm-signup.html` as the body. Save.
4. **Templates → Invite user** and **Templates → Reset password.** Same, with
   `invite-user.html` and `reset-password.html`. Check both subject
   lines: Supabase's defaults ("Confirm your email address", "You have been
   invited") stay until you replace them.
5. **Authentication → Sign In / Providers → Email.** Make sure **Confirm
   email** is on if you want new accounts verified.
6. **Authentication → Rate Limits.** With your own sender, raise the email limit
   above Supabase's default if you expect more than a few sign-ups an hour.
7. **Send one to yourself.** Sign up with a second address, or invite one from
   Settings → Team **on the production address**, and check it in the inbox you
   actually use — Gmail and Outlook render email differently from a browser.

Self-hosted Supabase takes the same templates through the auth service's
`GOTRUE_MAILER_TEMPLATES_CONFIRMATION` and `GOTRUE_MAILER_TEMPLATES_INVITE`
settings, which point at a URL serving each file.

## How the links work

**Confirm signup** links to the app's own `/auth/confirm` route with a token
hash (`{{ .TokenHash }}`), and the route verifies it on the server
(`app/auth/confirm/route.ts`). That works on any device. The default
`{{ .ConfirmationURL }}` uses a code that only the browser which signed up can
redeem, so a link opened on a phone after signing up on a laptop failed. If a
link has expired, the login page says so and offers to send a new one.

**Invite user** keeps `{{ .ConfirmationURL }}` deliberately: the invitation
flow (`/invite/accept`) reads the session Supabase returns in that link and
then asks the invitee to choose a password. Do not swap it for a token-hash
link.

## Changing the wording or brand

The templates are plain HTML with Supabase's Go-template variables
(`{{ .Email }}`, `{{ .Data.first_name }}`, `{{ .SiteURL }}` …). Edit them in the
repository and paste again; keep the button `href` exactly as it is. If you
rebrand (`lib/branding.ts`), replace `public/brand/broc-wordmark-email.png` with
your own logo at about 3× its display size, and change the product name in the
text.

## Password reset

"Forgot your password?" on the sign-in page goes to `/forgot-password`, which
asks Supabase to send the **Reset password** email. That page says the same
thing whether or not an account exists, so it cannot be used to find out who
has one. The email's link goes to `/auth/confirm?type=recovery`, which verifies
the token on the server, signs the person in, and always continues to
`/reset-password`, whatever else the link says. Signed-in users reach the same
page from **Change your password** in the profile menu.

Paste the branded template before relying on this. Supabase's default reset
email does not link through `/auth/confirm`, so the person is never taken to
the page that asks for a new password.
