# Single sign-on

BROC federates to Entra ID (Azure AD), Google Workspace, Okta, Keycloak, or
any SAML 2.0 identity provider, and provisions users into the right
organization on their first login.

Two halves, and they are configured in different places:

| Half | Where | What it does |
| --- | --- | --- |
| **Authentication** | Supabase Auth | Proves who someone is |
| **Authorization** | `sso_domains` in BROC | Decides which organization they join and with what role |

Supabase will happily authenticate anyone from a provider you configure. It has
no opinion about which tenant they belong to. That is what the second half is
for, and skipping it produces the worst possible failure: the person signs in
successfully, lands on the dashboard, has no `users` row, and every row-level
security policy returns nothing. The app looks broken rather than closed, and
the first conclusion IT draws is that the software does not work.

---

## 1. Configure the provider in Supabase

**Entra ID / Azure AD** — the common case for a mid-sized company on Microsoft 365.

1. Azure portal → App registrations → New registration.
2. Redirect URI (Web): `https://<your-supabase-project>/auth/v1/callback`. For a
   self-hosted stack that is your API gateway URL, e.g.
   `https://supabase.acme.internal/auth/v1/callback`.
3. Note the Application (client) ID, create a client secret, note the tenant ID.
4. Supabase → Authentication → Providers → Azure. Paste the client ID, secret,
   and set the Azure tenant URL to
   `https://login.microsoftonline.com/<tenant-id>/v2.0`.
5. Supabase → Authentication → URL Configuration → add `https://<your-broc-host>/auth/callback`
   to the redirect allowlist. **Miss this and the provider returns to a blank page.**

Google Workspace, Okta and Keycloak follow the same shape. For a generic SAML
2.0 IdP use Supabase's SSO support and sign-in happens by domain rather than by
a provider button.

## 2. Tell BROC which providers to offer

```bash
# deploy/.env — comma-separated: azure, google, okta, keycloak
NEXT_PUBLIC_SSO_PROVIDERS=azure

# SAML 2.0 by email domain, for a generic IdP
NEXT_PUBLIC_SSO_SAML=false
```

These are `NEXT_PUBLIC_`, so they are baked in at build time — changing them
means rebuilding the image, not restarting the container. Unset means the login
page offers password sign-in only, which is the right default: a "Continue with
Microsoft" button that fails because nobody configured the provider is worse
than no button.

## 3. Map your email domains

This is the authorization half, and it is enforced in the database.

```sql
-- Everyone with an @acme.com address joins Acme as a viewer.
INSERT INTO sso_domains (organization_id, domain, default_role, notes)
VALUES (
  (SELECT id FROM organizations WHERE name = 'Acme Industrial'),
  'acme.com',
  'viewer',
  'Primary corporate domain'
);

-- A subsidiary on its own domain, same organization.
INSERT INTO sso_domains (organization_id, domain, default_role)
VALUES ((SELECT id FROM organizations WHERE name = 'Acme Industrial'), 'acme-eu.com', 'editor');

-- An external assurance provider. 'auditor' is read-only by construction.
INSERT INTO sso_domains (organization_id, domain, default_role, notes)
VALUES ((SELECT id FROM organizations WHERE name = 'Acme Industrial'), 'auditfirm.com', 'auditor',
        'FY2026 limited assurance engagement');
```

There is no settings screen for this yet. That is a gap rather than a
principle — see the end of this document.

### The four rules the database enforces

You cannot configure your way around these, which is the point.

**Exact domain match. No wildcards.** `acme.com` does not admit
`contractor.acme.com`. A subdomain wildcard looks like a convenience and is a
tenancy hole — anyone who controls any subdomain of a mapped domain would be
able to self-provision.

**One organization per domain, deployment-wide.** If two organizations both
claimed `acme.com`, which one a user joined would depend on row order. A unique
index prevents it, and the provisioning logic refuses rather than guessing if it
somehow sees duplicates.

**`default_role` can never be `admin`.** An admin can change the consolidation
boundary and every emission factor — that is, every number the organization
reports. Automatic promotion to admin because someone controls an email address
is not a risk worth taking. Permitted values are `viewer`, `editor`, `auditor`.
Promotion stays a deliberate act by an existing admin.

**Consumer email domains are refused.** `gmail.com`, `outlook.com`, `proton.me`
and about thirty others. Mapping one would admit the entire internet.

## 4. What happens on first login

1. The person clicks "Continue with Microsoft" and authenticates with your IdP.
2. They return to `/auth/callback`, which exchanges the code for a session.
3. **Already have a profile?** Straight to the dashboard. Nothing is changed —
   this route never moves someone between organizations or alters a role, so
   editing a domain mapping later cannot silently re-tenant existing users.
4. **No profile?** The email domain is matched against `sso_domains`.
   - **Match** → a `users` row is created with the mapped role, and
     `auth_provider`, `provisioned_at` and `provisioned_via_domain` record how.
   - **No match** → the session is **signed out** and they return to the login
     page with an explanation. Signing out matters: leaving a valid session with
     no profile is exactly the broken-empty-dashboard state this prevents.

Every refusal is logged server-side with the email and the reason.

## 5. Access review

Provisioning is deliberately visible, because "how do people get access to this
system" is an early assurance question.

```sql
-- Who arrived how.
SELECT email, role, auth_provider, provisioned_via_domain, provisioned_at
FROM users
ORDER BY provisioned_at DESC NULLS LAST;

-- Accounts nobody explicitly created.
SELECT email, role, provisioned_via_domain, provisioned_at
FROM users
WHERE auth_provider IN ('sso', 'oidc', 'saml')
ORDER BY provisioned_at DESC;
```

Changes to `sso_domains` are captured in the audit log by trigger, so adding or
removing a domain is recorded with who did it and when.

**Deprovisioning is your IdP's job, not BROC's.** Disabling someone in Entra ID
stops them signing in. It does not delete their `users` row, and their audit
history is retained deliberately — removing the row would orphan the trail of
what they entered. To revoke access inside BROC as well, set their role to
`viewer` or delete the row once you no longer need the linkage.

## 6. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Returns to a blank page after the IdP | `/auth/callback` is not in Supabase's redirect allowlist |
| "Your email domain is not set up for single sign-on here" | No `sso_domains` row for that domain — the expected refusal |
| Signed in, then immediately signed out | A refusal. Check the server log for `[sso] refused` and the reason |
| Buttons do not appear | `NEXT_PUBLIC_SSO_PROVIDERS` unset, or set after the image was built |
| Signs in but sees an empty app | A `users` row exists with the wrong `organization_id`. Provisioning does not fix existing rows by design — correct it directly |

## Known gaps

- **No settings screen for domain mappings.** They are added by SQL. Defensible
  for now — configuring the IdP is already an out-of-app task — but an admin
  without database access cannot onboard a subsidiary, and that will annoy
  someone. Parked, not principled.
- **No SCIM provisioning.** Users appear on first login, not when added to a
  group in the IdP.
- **No group-to-role mapping.** Role comes from the domain, not from IdP group
  membership, so everyone from a domain gets the same starting role.
- **No enforced-SSO mode.** Password sign-in stays available alongside SSO. An
  organization wanting SSO only would currently disable password auth in
  Supabase.
