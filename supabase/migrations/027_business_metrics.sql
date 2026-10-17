-- ============================================================
-- Business Metrics and Intensity Denominators
-- Migration 027
-- ============================================================
-- Until now `sites.floor_area_sqft` was the only denominator in the entire
-- schema, so the only intensity this platform could report was tCO2e per
-- square foot. That is the right measure for roughly one kind of company.
--
-- A bank normalises by FTE. A manufacturer by tonnes produced. A retailer by
-- store or by square metre. An airline by revenue passenger kilometre. A
-- hotel group by room-night. And nearly every board, in every sector, asks for
-- emissions per unit of revenue. None of those could be expressed here.
--
--   business_metrics        - what an organization measures its business by
--   business_metric_values  - the numbers, by year and optionally by site
--   organizations.intensity_metric_key - which one intensity is reported against
--
-- ─── Global starters, org-owned definitions ─────────────────────────────────
--
-- `organization_id IS NULL` rows are starter definitions every organization can
-- use. A row with an organization_id belongs to that organization alone. Same
-- shape as custom_emission_factors: shared reference data, overridden or
-- extended locally, without forking anything.
--
-- This is deliberately not an admin screen. The expectation is that the ESG
-- team owns this deployment and adds the metrics their business actually runs
-- on - by SQL, by CSV, or by editing the seed below. See docs/CUSTOMISING.md.
--
-- ─── Aggregation matters here for the same reason it did in 023 ─────────────
--
-- Revenue for a year is the sum of the sites' revenue. Headcount is NOT the sum
-- of twelve monthly readings - it is the latest reading from each site, added
-- together. Getting that wrong turns an intensity denominator into nonsense in
-- the direction that flatters the number, so `aggregation` is recorded per
-- metric rather than assumed.
--
-- ─── Nothing changes for an existing deployment ─────────────────────────────
--
-- `intensity_metric_key` defaults to NULL, which means "carry on using floor
-- area". No existing figure moves until somebody chooses a denominator.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. What an organization measures itself by ──────────────────────────────

CREATE TABLE IF NOT EXISTS business_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = a starter definition available to every organization.
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,

  metric_key       VARCHAR(60) NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,

  -- Free text on purpose. "USD", "EUR", "FTE", "tonnes", "room-nights",
  -- "vehicle-km", "MWh of product". Constraining this list would recreate the
  -- exact rigidity this migration exists to remove.
  unit             VARCHAR(40) NOT NULL,

  category         VARCHAR(30) NOT NULL DEFAULT 'operational'
                   CHECK (category IN ('financial', 'operational', 'workforce', 'other')),

  -- sum           - a flow. A year's revenue is its sites' revenue added up.
  -- point_in_time - a stock. Headcount is each site's latest reading, summed;
  --                 never twelve monthly readings added together.
  -- average       - a period mean.
  aggregation      VARCHAR(20) NOT NULL DEFAULT 'sum'
                   CHECK (aggregation IN ('sum', 'point_in_time', 'average')),

  -- Whether this metric is offered as an intensity denominator. A metric can be
  -- worth tracking without being a sensible divisor.
  is_denominator   BOOLEAN NOT NULL DEFAULT TRUE,

  display_order    INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One definition per key per owner. Two partial indexes rather than one
-- constraint, because NULL organization_id would otherwise never collide with
-- itself and the starters could be seeded twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_metrics_global_key
  ON business_metrics(metric_key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_metrics_org_key
  ON business_metrics(organization_id, metric_key) WHERE organization_id IS NOT NULL;

COMMENT ON TABLE business_metrics IS
  'What an organization measures its business by, for use as intensity denominators and normalisation factors. organization_id NULL means a starter definition shared by every tenant; a set organization_id means the tenant defined it themselves.';
COMMENT ON COLUMN business_metrics.aggregation IS
  'sum = flow (revenue). point_in_time = stock (headcount): latest reading per site, then summed - never twelve monthly readings added together.';

-- ─── 2. The numbers ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_metric_values (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),

  metric_key       VARCHAR(60) NOT NULL,
  reporting_year   INTEGER NOT NULL,

  -- Both NULL = an organization-wide figure. A site makes it site-level, which
  -- is what allows per-site intensity and lets the scope filter apply.
  site_id          UUID REFERENCES sites(id) ON DELETE CASCADE,

  -- The date the reading refers to. Required for point_in_time metrics, where
  -- "latest per site" is meaningless without it; optional for flows.
  as_of_date       DATE,

  value            NUMERIC(20, 4) NOT NULL,
  notes            TEXT,

  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_business_metric_values_lookup
  ON business_metric_values(organization_id, metric_key, reporting_year)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_metric_values_site
  ON business_metric_values(site_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN business_metric_values.site_id IS
  'NULL for an organization-wide figure. Set for a site-level one, which is what lets the reporting scope filter apply to the denominator as well as the numerator.';

-- ─── 3. Which denominator intensity is reported against ──────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS intensity_metric_key VARCHAR(60);

COMMENT ON COLUMN organizations.intensity_metric_key IS
  'Business metric used as the denominator for reported GHG intensity. NULL keeps the previous behaviour of dividing by total floor area, so no existing figure moves until this is set.';

-- ─── 4. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE business_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_metric_values ENABLE ROW LEVEL SECURITY;

-- Definitions: read the starters and your own; write only your own.
DROP POLICY IF EXISTS "business_metrics_select" ON business_metrics;
CREATE POLICY "business_metrics_select" ON business_metrics
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = auth_org_id());

DROP POLICY IF EXISTS "business_metrics_insert_editor" ON business_metrics;
CREATE POLICY "business_metrics_insert_editor" ON business_metrics
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "business_metrics_update_editor" ON business_metrics;
CREATE POLICY "business_metrics_update_editor" ON business_metrics
  FOR UPDATE TO authenticated
  USING (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- Values: ordinary tenant data.
DROP POLICY IF EXISTS "business_metric_values_select_own_org" ON business_metric_values;
CREATE POLICY "business_metric_values_select_own_org" ON business_metric_values
  FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "business_metric_values_insert_editor" ON business_metric_values;
CREATE POLICY "business_metric_values_insert_editor" ON business_metric_values
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "business_metric_values_update_editor" ON business_metric_values;
CREATE POLICY "business_metric_values_update_editor" ON business_metric_values
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor')
    AND deleted_at IS NULL);

GRANT SELECT ON business_metrics, business_metric_values TO authenticated;

-- ─── 5. Audit the values ─────────────────────────────────────────────────────
-- Tenant data with an organization_id, so the generic trigger from 008 applies
-- unchanged. An intensity denominator moves a reported figure just as surely as
-- the numerator does, and deserves the same change history.

DROP TRIGGER IF EXISTS trg_audit_business_metric_values ON business_metric_values;
CREATE TRIGGER trg_audit_business_metric_values
  AFTER INSERT OR UPDATE OR DELETE ON business_metric_values
  FOR EACH ROW EXECUTE FUNCTION record_audit();

-- ─── 6. Starter definitions ──────────────────────────────────────────────────
-- Deliberately short. These are the denominators that recur across sectors;
-- anything industry-specific belongs to the organization that needs it.

INSERT INTO business_metrics
  (organization_id, metric_key, label, description, unit, category, aggregation, is_denominator, display_order)
VALUES
  (NULL, 'revenue', 'Revenue', 'Net revenue for the reporting year. The denominator most boards ask for.', 'currency', 'financial', 'sum', TRUE, 10),
  (NULL, 'headcount_fte', 'Headcount (FTE)', 'Full-time equivalent employees. A stock: the latest reading from each site, added together.', 'FTE', 'workforce', 'point_in_time', TRUE, 20),
  (NULL, 'production_volume', 'Production volume', 'Physical output. Rename the unit to whatever your product is actually counted in.', 'tonnes', 'operational', 'sum', TRUE, 30),
  (NULL, 'units_shipped', 'Units shipped', 'Discrete units despatched in the reporting year.', 'units', 'operational', 'sum', TRUE, 40),
  (NULL, 'floor_area', 'Floor area', 'Gross internal floor area. Equivalent to sites.floor_area_sqft, offered here so an organization reporting in square metres is not forced into square feet.', 'sq ft', 'operational', 'point_in_time', TRUE, 50),
  (NULL, 'operating_hours', 'Operating hours', 'Hours of operation across the reporting year. Useful for normalising a plant that ran a different number of shifts.', 'hours', 'operational', 'sum', FALSE, 60)
ON CONFLICT (metric_key) WHERE organization_id IS NULL DO UPDATE SET
  label          = EXCLUDED.label,
  description    = EXCLUDED.description,
  unit           = EXCLUDED.unit,
  category       = EXCLUDED.category,
  aggregation    = EXCLUDED.aggregation,
  is_denominator = EXCLUDED.is_denominator,
  display_order  = EXCLUDED.display_order;
