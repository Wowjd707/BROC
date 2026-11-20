-- ============================================================
-- BROC — HS and HTS codes alongside CN
-- Migration 044
-- ============================================================
-- Migration 043 gave each product one customs code, the EU's 8-digit CN code.
-- Most organizations hold several: the 6-digit HS code every customs system
-- shares, the CN code for EU imports, and the US 10-digit HTS code. Each is
-- kept here as the organization records it, rather than derived, because the
-- national digits beyond the sixth differ by system and only the classifier
-- knows which applies.
--
-- Scope rules now say which code system their prefix is in. A rule matches a
-- product when that product's code in the same system starts with the prefix.
-- The first six digits are harmonized across all three systems, so a rule of
-- six digits or fewer also matches whichever code the product has
-- (lib/compliance-core.ts, regulationsForProduct). An existing rule keeps
-- meaning what it meant: it is a CN rule.
--
-- `compliance_scope_rules.cn_prefix` keeps its name so code deployed before
-- this migration keeps working; it now holds the prefix in `code_system`.
--
-- RE-RUNNABLE.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS hs_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hts_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_hs_code_check') THEN
    -- HS stops at six digits; anything longer is a national code (CN or HTS).
    ALTER TABLE products ADD CONSTRAINT products_hs_code_check
      CHECK (hs_code IS NULL OR hs_code ~ '^[0-9]{2,6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_hts_code_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_hts_code_check
      CHECK (hts_code IS NULL OR hts_code ~ '^[0-9]{2,10}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_org_hs ON products(organization_id, hs_code);
CREATE INDEX IF NOT EXISTS idx_products_org_hts ON products(organization_id, hts_code);

COMMENT ON COLUMN products.hs_code IS 'Harmonized System code, up to 6 digits.';
COMMENT ON COLUMN products.cn_code IS 'EU Combined Nomenclature code, up to 8 digits (10 with TARIC).';
COMMENT ON COLUMN products.hts_code IS 'US Harmonized Tariff Schedule code, up to 10 digits.';

-- ─── Scope rules name their code system ──────────────────────────────────────
ALTER TABLE compliance_scope_rules ADD COLUMN IF NOT EXISTS code_system TEXT NOT NULL DEFAULT 'cn';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_scope_rules_code_system_check') THEN
    ALTER TABLE compliance_scope_rules ADD CONSTRAINT compliance_scope_rules_code_system_check
      CHECK (code_system IN ('hs', 'cn', 'hts'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_scope_rules_hs_length_check') THEN
    ALTER TABLE compliance_scope_rules ADD CONSTRAINT compliance_scope_rules_hs_length_check
      CHECK (code_system <> 'hs' OR length(cn_prefix) <= 6);
  END IF;
END $$;

-- The same prefix can now be listed once per code system.
ALTER TABLE compliance_scope_rules
  DROP CONSTRAINT IF EXISTS compliance_scope_rules_organization_id_regulation_cn_prefix_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_rules_org_reg_system_prefix
  ON compliance_scope_rules(organization_id, regulation, code_system, cn_prefix);

COMMENT ON COLUMN compliance_scope_rules.cn_prefix IS
  'Code prefix in code_system (named for CN, which was the only system before migration 044).';
