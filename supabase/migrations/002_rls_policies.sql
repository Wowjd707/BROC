-- ============================================================
-- EHS Carbon Accounting Platform — Row Level Security Policies
-- Migration 002
-- ============================================================
-- All tables use organization_id-scoped RLS.
-- Users can only see rows belonging to their own organization.
-- The auth.uid() must match a users.id row with matching org.
-- ============================================================

-- Helper function: get current user's organization_id from users table
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT organization_id FROM users WHERE id = auth.uid()
$$;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$;

-- ============================================================
-- ENABLE RLS
-- ============================================================
ALTER TABLE organizations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE emission_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ehs_entries                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_surveys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_survey_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_survey_responses    ENABLE ROW LEVEL SECURITY;

-- Reference tables — no RLS needed, they are read-only global data
-- scope1_emission_factors, scope2_emission_factors, refrigerant_factors
-- are accessible to all authenticated users

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE POLICY "org_select_own" ON organizations
  FOR SELECT USING (id = auth_org_id());

CREATE POLICY "org_update_admin" ON organizations
  FOR UPDATE USING (id = auth_org_id() AND auth_user_role() = 'admin');

-- ============================================================
-- USERS
-- ============================================================
CREATE POLICY "users_select_own_org" ON users
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "users_update_self" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "users_update_admin" ON users
  FOR UPDATE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');

CREATE POLICY "users_insert_admin" ON users
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ============================================================
-- SITES
-- ============================================================
CREATE POLICY "sites_select_own_org" ON sites
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "sites_insert_admin_editor" ON sites
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "sites_update_admin_editor" ON sites
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "sites_delete_admin" ON sites
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ============================================================
-- EMISSION ENTRIES
-- ============================================================
CREATE POLICY "emission_entries_select_own_org" ON emission_entries
  FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);

CREATE POLICY "emission_entries_insert_editor" ON emission_entries
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "emission_entries_update_editor" ON emission_entries
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND deleted_at IS NULL
  );

-- Soft-delete only — no hard DELETE policy

-- ============================================================
-- EHS ENTRIES
-- ============================================================
CREATE POLICY "ehs_entries_select_own_org" ON ehs_entries
  FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);

CREATE POLICY "ehs_entries_insert_editor" ON ehs_entries
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "ehs_entries_update_editor" ON ehs_entries
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND deleted_at IS NULL
  );

-- ============================================================
-- GOALS
-- ============================================================
CREATE POLICY "goals_select_own_org" ON goals
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "goals_insert_editor" ON goals
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "goals_update_editor" ON goals
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "goals_delete_admin" ON goals
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE POLICY "projects_select_own_org" ON projects
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "projects_insert_editor" ON projects
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "projects_update_editor" ON projects
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "projects_delete_admin" ON projects
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE POLICY "suppliers_select_own_org" ON suppliers
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "suppliers_insert_editor" ON suppliers
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "suppliers_update_editor" ON suppliers
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

-- ============================================================
-- SUPPLIER SURVEYS
-- ============================================================
CREATE POLICY "surveys_select_own_org" ON supplier_surveys
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "surveys_insert_editor" ON supplier_surveys
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "surveys_update_editor" ON supplier_surveys
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

-- ============================================================
-- SUPPLIER SURVEY INVITATIONS
-- ============================================================
-- Internal users see invitations for their org's surveys
CREATE POLICY "invitations_select_own_org" ON supplier_survey_invitations
  FOR SELECT USING (
    survey_id IN (
      SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id()
    )
  );

CREATE POLICY "invitations_insert_editor" ON supplier_survey_invitations
  FOR INSERT WITH CHECK (
    survey_id IN (
      SELECT id FROM supplier_surveys
      WHERE organization_id = auth_org_id()
      AND auth_user_role() IN ('admin', 'editor')
    )
  );

CREATE POLICY "invitations_update_editor" ON supplier_survey_invitations
  FOR UPDATE USING (
    survey_id IN (
      SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id()
    )
    AND auth_user_role() IN ('admin', 'editor')
  );

-- Public token-based access for suppliers (unauthenticated)
-- This allows the public survey page to look up invitation by token
CREATE POLICY "invitations_public_token_select" ON supplier_survey_invitations
  FOR SELECT USING (true);  -- filtered in the Edge Function / service role

-- ============================================================
-- SUPPLIER SURVEY RESPONSES
-- ============================================================
CREATE POLICY "responses_select_own_org" ON supplier_survey_responses
  FOR SELECT USING (
    survey_id IN (
      SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id()
    )
  );

-- Responses are inserted publicly via token (service role in Edge Function)
-- Internal update is blocked — responses are immutable after submission
CREATE POLICY "responses_insert_service" ON supplier_survey_responses
  FOR INSERT WITH CHECK (true);  -- enforced at Edge Function level with service role

-- ============================================================
-- GRANT SELECT on reference tables to authenticated users
-- ============================================================
GRANT SELECT ON scope1_emission_factors  TO authenticated;
GRANT SELECT ON scope2_emission_factors  TO authenticated;
GRANT SELECT ON refrigerant_factors      TO authenticated;
