-- ============================================================
-- BROC — Single sign-on and just-in-time provisioning
-- Migration 031
-- ============================================================
-- Supabase Auth can already federate to Entra ID, Google Workspace, Okta and
-- any SAML 2.0 IdP. That part needs no schema. What it does NOT do is decide
-- which organization a federated user belongs to, or what role they get.
--
-- Without that decision the failure is quiet and bad: the user authenticates
-- successfully, lands on the dashboard, has no `users` row, therefore no
-- organization_id, therefore every RLS policy returns zero rows. The app looks
-- broken rather than unauthorized, and the first thing IT concludes is that
-- the software does not work.
--
--   sso_domains — an email domain, the organization it belongs to, and the
--                 role a newly federated user from it receives.
--
-- Four deliberate choices:
--
-- 1. Domain match is EXACT. No subdomain wildcards. `acme.com` does not admit
--    `contractor.acme.com`. A wildcard here is a tenancy hole that looks like
--    a convenience feature.
--
-- 2. A domain maps to exactly ONE organization. The unique constraint is on
--    the domain alone, not (organization_id, domain) — otherwise two orgs in
--    the same deployment could both claim `acme.com` and provisioning would
--    depend on row order.
--
-- 3. default_role CANNOT be 'admin'. Anyone who controls an email at a mapped
--    domain would otherwise self-provision full administrative access, which
--    includes changing the consolidation boundary and every emission factor.
--    Promotion to admin stays a deliberate act by an existing admin.
--
-- 4. Free and consumer email domains are refused outright. Mapping gmail.com
--    would admit the entire internet to an organization. The list below is not
--    exhaustive and is not meant to be — it catches the realistic mistake.
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS sso_domains (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain           TEXT NOT NULL,
  default_role     TEXT NOT NULL DEFAULT 'viewer',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Normalised, lowercase, no leading '@' or whitespace, at least one dot.
ALTER TABLE sso_domains DROP CONSTRAINT IF EXISTS sso_domains_domain_shape;
ALTER TABLE sso_domains ADD CONSTRAINT sso_domains_domain_shape
  CHECK (domain = lower(btrim(domain)) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

-- One organization per domain, deployment-wide. See note 2.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_domains_domain ON sso_domains(lower(domain));

-- See note 3. 'auditor' is permitted: read-only by construction (migration 030),
-- which makes it a reasonable default for an external assurance provider's IdP.
ALTER TABLE sso_domains DROP CONSTRAINT IF EXISTS sso_domains_default_role;
ALTER TABLE sso_domains ADD CONSTRAINT sso_domains_default_role
  CHECK (default_role IN ('viewer', 'editor', 'auditor'));

-- See note 4.
ALTER TABLE sso_domains DROP CONSTRAINT IF EXISTS sso_domains_not_consumer;
ALTER TABLE sso_domains ADD CONSTRAINT sso_domains_not_consumer
  CHECK (domain NOT IN (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com',
    'yahoo.com','yahoo.co.uk','ymail.com','aol.com','icloud.com','me.com','mac.com',
    'proton.me','protonmail.com','pm.me','gmx.com','gmx.de','mail.com','zoho.com',
    'yandex.com','yandex.ru','qq.com','163.com','126.com','naver.com','web.de',
    'fastmail.com','hey.com','tutanota.com','tuta.io','duck.com','mail.ru'
  ));

CREATE INDEX IF NOT EXISTS idx_sso_domains_org ON sso_domains(organization_id);

ALTER TABLE sso_domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON sso_domains TO authenticated;

-- SELECT gates on the organization only, never on role — see CLAUDE.md.
DROP POLICY IF EXISTS "sso_domains_select" ON sso_domains;
CREATE POLICY "sso_domains_select" ON sso_domains
  FOR SELECT TO authenticated
  USING (organization_id = auth_org_id());

-- Writes are admin-only. This table decides who gets into the organization,
-- so it is a narrower allowlist than the usual ('admin','editor').
DROP POLICY IF EXISTS "sso_domains_insert" ON sso_domains;
CREATE POLICY "sso_domains_insert" ON sso_domains
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_org_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "sso_domains_update" ON sso_domains;
CREATE POLICY "sso_domains_update" ON sso_domains
  FOR UPDATE TO authenticated
  USING (
    organization_id = auth_org_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "sso_domains_delete" ON sso_domains;
CREATE POLICY "sso_domains_delete" ON sso_domains
  FOR DELETE TO authenticated
  USING (
    organization_id = auth_org_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- ============================================================
-- Provenance on the user row
-- ============================================================
-- Who arrived how. An assurance provider asking "how do people get access to
-- this system" deserves a better answer than "there is a login page", and an
-- admin reviewing access needs to see which accounts nobody explicitly
-- created.

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_known;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_known
  CHECK (auth_provider IN ('password', 'invite', 'sso', 'oidc', 'saml'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provisioned_via_domain TEXT;

COMMENT ON COLUMN users.auth_provider IS
  'How this account came to exist. ''sso''/''oidc''/''saml'' means it was created by just-in-time provisioning at first federated login, not by an invitation.';
COMMENT ON COLUMN users.provisioned_via_domain IS
  'The sso_domains.domain that admitted this user. Null for accounts created by password signup or invitation.';

COMMENT ON TABLE sso_domains IS
  'Email domain to organization mapping for just-in-time provisioning of federated users. Exact match only; default_role can never be admin; consumer email domains are refused by CHECK.';

-- ============================================================
-- Audit
-- ============================================================
-- sso_domains carries organization_id, so the standard trigger works here
-- (unlike the regulatory watch tables — see migration 025).

DROP TRIGGER IF EXISTS audit_sso_domains ON sso_domains;
CREATE TRIGGER audit_sso_domains
  AFTER INSERT OR UPDATE OR DELETE ON sso_domains
  FOR EACH ROW EXECUTE FUNCTION record_audit();
