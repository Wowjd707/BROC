# Branded sign-up and invitation emails

Supabase sends the account emails — the sign-up confirmation and the team
invitation — from its own default templates unless you replace them. Two
branded templates ship in `supabase/email-templates/`:

| File | Supabase template | Subject line |
| --- | --- | --- |
| `confirm-signup.html` | **Confirm signup** | `Confirm your BROC account` |
| `invite-user.html` | **Invite user** | `You've been invited to BROC` |

Both use the BROC wordmark, the app's green, and a layout built for email
clients: tables, inline styles, a system font stack (most clients block web
fonts) and a PNG logo with alt text (Gmail and Outlook do not render SVG).

## Setting them up (Supabase Cloud)

1. **Authentication → URL Configuration.** Set **Site URL** to your app's public
   address, e.g. `https://esg-tan.vercel.app`. The templates use it for the
   confirmation link and to load the logo
   (`/brand/broc-wordmark-email.png`). Under **Redirect URLs**, add
   `https://<your-domain>/**`.
2. **Authentication → Email Templates → Confirm signup.** Paste the subject
   above and the whole of `confirm-signup.html` as the message body. Save.
3. **Authentication → Email Templates → Invite user.** Same, with
   `invite-user.html`.
4. **Authentication → Sign In / Providers → Email.** Make sure **Confirm
   email** is on if you want new accounts verified.
5. **Send one to yourself.** Sign up with a second address, or invite one from
   Settings → Team, and check it in the inbox you actually use — Gmail and
   Outlook render email differently from a browser.

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

## Sending from your own address

Supabase's built-in mailer sends from a Supabase address, is rate-limited, and
is meant for testing. For real use, set **Authentication → SMTP Settings** to
your own provider. If you already use Resend for supplier surveys, its SMTP
details are on the Resend dashboard; send from a domain you have verified there
so the emails are not marked as spam.

## Changing the wording or brand

The templates are plain HTML with Supabase's Go-template variables
(`{{ .Email }}`, `{{ .Data.first_name }}`, `{{ .SiteURL }}` …). Edit them in the
repository and paste again; keep the button `href` exactly as it is. If you
rebrand (`lib/branding.ts`), replace `public/brand/broc-wordmark-email.png` with
your own logo at about 3× its display size, and change the product name in the
text.

## Not yet built

There is no "forgot password" flow in the app yet, so the **Reset password**
template is not used, and someone who forgets their password has no way back in
from the login page. It is the next account email worth building: a request
form on the login page, a branded reset template linking to `/auth/confirm`
with `type=recovery`, and a page to choose the new password.
