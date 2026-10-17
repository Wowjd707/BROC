-- ============================================================
-- BROC — Regulatory frameworks, workstreams and the crosswalk
-- Migration 033
-- ============================================================
-- Migration 024 gave every tracked rule one flat row. That was right while the
-- tracker held one row per instrument, and it stops being right as soon as an
-- instrument is being rewritten in several directions at once.
--
-- The GHG Protocol is the clearest case: the corporate suite, Scope 2, Scope 3,
-- the Land Sector Standard and the ISO merger are five separate workstreams
-- with different stages, different confidence and different milestone dates,
-- all under one publisher. Flattening them means either one row that averages
-- five truths, or five sibling rows that each repeat the parent context.
--
-- So this migration adds the level above:
--
--     regulatory_frameworks     the publisher / regime  (GHG Protocol, PFAS)
--       └── regulatory_items    the workstream          (Scope 2 revision)
--             └── regulatory_updates   the dated feed
--
-- and the level beside:
--
--     regulatory_relationships  how two regimes interact
--
-- That last table is the point of the whole exercise. Any single-regime
-- tracker can tell you that CSRD changed. What a sustainability team cannot
-- get anywhere is that California references a frozen GHG Protocol version
-- while GHG Protocol rewrites it — a divergence that exists *between* rules and
-- therefore has no home in a table of rules.
--
-- Nothing here breaks 024. `code` remains the natural key and remains stable,
-- because regulatory_source_snapshots, regulatory_change_proposals and
-- regulatory_capabilities all reference it.
--
-- RE-RUNNABLE.
-- ============================================================


-- ─── PART 0. Domains ─────────────────────────────────────────────────────────
-- 024's category was ('ghg_accounting', 'eu', 'us', 'other') — a topic and two
-- geographies in one column, next to a `jurisdiction` column already holding
-- the geography. The visible cost is that PFAS files under "eu", so a user
-- filtering for chemicals cannot find it, and a user filtering for the EU gets
-- chemicals, packaging and deforestation mixed into their disclosure reading.
--
-- category now means domain, and jurisdiction keeps doing geography.

DO $$
BEGIN
  ALTER TABLE regulatory_items DROP CONSTRAINT IF EXISTS regulatory_items_category_check;

  -- Remap before re-adding the constraint, or the existing 21 rows fail it.
  -- Written as an explicit per-code map rather than a rule over the old values:
  -- 'eu' held four different domains, so no rule could recover them.
  UPDATE regulatory_items SET category = CASE code
    WHEN 'GHGP-CORP'      THEN 'carbon_accounting'
    WHEN 'GHGP-S2'        THEN 'carbon_accounting'
    WHEN 'GHGP-S3'        THEN 'carbon_accounting'
    WHEN 'GHGP-LSR'       THEN 'carbon_accounting'
    WHEN 'ISO-14064'      THEN 'carbon_accounting'
    WHEN 'SBTI-CNZS2'     THEN 'targets'
    WHEN 'IFRS-S1S2'      THEN 'disclosure'
    WHEN 'CSRD-ESRS'      THEN 'disclosure'
    WHEN 'EU-TAXONOMY'    THEN 'disclosure'
    WHEN 'CA-SB253'       THEN 'disclosure'
    WHEN 'CA-SB261'       THEN 'disclosure'
    WHEN 'SEC-CLIMATE'    THEN 'disclosure'
    WHEN 'US-STATES'      THEN 'disclosure'
    WHEN 'EPA-GHGRP'      THEN 'disclosure'
    WHEN 'CBAM'           THEN 'carbon_border'
    WHEN 'EUDR'           THEN 'deforestation'
    WHEN 'CSDDD'          THEN 'due_diligence'
    WHEN 'PPWR'           THEN 'packaging'
    WHEN 'EU-PFAS'        THEN 'chemicals'
    WHEN 'EPA-PFAS-TSCA'  THEN 'chemicals'
    WHEN 'EPA-PFAS-NPDWR' THEN 'chemicals'
    ELSE category
  END
  WHERE category IN ('ghg_accounting', 'eu', 'us', 'other');

  ALTER TABLE regulatory_items ADD CONSTRAINT regulatory_items_category_check
    CHECK (category IN (
      'carbon_accounting',   -- how emissions are measured and reported
      'disclosure',          -- what must be published, and to whom
      'targets',             -- what must be committed to
      'carbon_border',       -- carbon priced at a frontier
      'chemicals',           -- substance restriction and notification
      'packaging',           -- packaging design, recyclate, waste
      'deforestation',       -- land-conversion due diligence
      'due_diligence',       -- human rights and environmental supply chain duty
      'product_stewardship', -- take-back, EPR, end-of-life
      'other'));
END $$;

COMMENT ON COLUMN regulatory_items.category IS
  'The domain the rule governs. Geography lives in jurisdiction — a rule is not "EU" in the way it is "chemicals", and conflating the two hid PFAS from anyone filtering for chemicals.';


-- ─── PART 1. Frameworks ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_frameworks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code              VARCHAR(40) NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  short_name        VARCHAR(40),

  -- Who publishes it. Not the same as jurisdiction: the GHG Protocol is
  -- published by WRI/WBCSD and binds nobody, yet half the world's disclosure
  -- law points at it.
  publisher         TEXT NOT NULL,

  domain            VARCHAR(30) NOT NULL,
  tagline           TEXT,
  description       TEXT,

  -- One sentence on where the whole framework stands, for the card header.
  -- Distinct from any single workstream's status.
  status_headline   TEXT,

  accent_color      VARCHAR(7),
  display_order     INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_frameworks_color_hex') THEN
    ALTER TABLE regulatory_frameworks ADD CONSTRAINT regulatory_frameworks_color_hex
      CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

COMMENT ON TABLE regulatory_frameworks IS
  'The publisher or regime a tracked workstream belongs to. Exists so a body rewriting itself in several directions at once (the GHG Protocol has five live workstreams) reads as one thing with five moving parts rather than five unrelated rows.';


-- ─── PART 2. Items become workstreams ────────────────────────────────────────

ALTER TABLE regulatory_items
  ADD COLUMN IF NOT EXISTS framework_code VARCHAR(40)
    REFERENCES regulatory_frameworks(code) ON DELETE SET NULL;

-- Nullable on purpose. An item that belongs to no framework is a standalone
-- instrument, which is a real category and not a data-quality problem.
COMMENT ON COLUMN regulatory_items.framework_code IS
  'The framework this workstream sits under. NULL means a standalone instrument with no parent body, which is legitimate.';

CREATE INDEX IF NOT EXISTS idx_regulatory_items_framework
  ON regulatory_items(framework_code, display_order) WHERE is_active;


-- ─── PART 3. The crosswalk ───────────────────────────────────────────────────
-- Relationships are directional (from → to) but rendered both ways. The
-- direction carries meaning for 'references' and 'depends_on' — California
-- references the GHG Protocol, not the reverse — and is merely conventional
-- for 'merging_with' and 'diverges_from'.

CREATE TABLE IF NOT EXISTS regulatory_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  from_code         VARCHAR(40) NOT NULL,
  to_code           VARCHAR(40) NOT NULL,

  -- Either end may name a framework or a single workstream, so this is not a
  -- foreign key. supabase/verify_install.sql checks that both ends resolve.
  relation          VARCHAR(20) NOT NULL CHECK (relation IN (
                      'merging_with',   -- two standards becoming one
                      'references',     -- one rule points at another's text
                      'depends_on',     -- one cannot be satisfied without the other
                      'aligns_with',    -- compatible, no formal link
                      'diverges_from',  -- same subject, incompatible answers
                      'watch')),        -- no relationship yet; one is plausible

  title             TEXT NOT NULL,
  note              TEXT NOT NULL,
  bullets           JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- A divergence is the subset worth acting on: somewhere a company must
  -- satisfy both rules and cannot do so with one answer. Flagged rather than
  -- given its own table, because it is the same relationship seen from the
  -- compliance side.
  is_watchlist      BOOLEAN NOT NULL DEFAULT FALSE,
  watchlist_detail  TEXT,

  confidence        VARCHAR(20) NOT NULL
                    CHECK (confidence IN ('confirmed', 'high', 'medium', 'low')),
  sources           JSONB NOT NULL,
  last_verified     DATE NOT NULL,

  display_order     INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (from_code, to_code, relation)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_relationships_sources_nonempty') THEN
    ALTER TABLE regulatory_relationships ADD CONSTRAINT regulatory_relationships_sources_nonempty
      CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_relationships_not_self') THEN
    ALTER TABLE regulatory_relationships ADD CONSTRAINT regulatory_relationships_not_self
      CHECK (from_code <> to_code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_relationships_watchlist_detail') THEN
    ALTER TABLE regulatory_relationships ADD CONSTRAINT regulatory_relationships_watchlist_detail
      CHECK (is_watchlist = FALSE OR (watchlist_detail IS NOT NULL AND length(btrim(watchlist_detail)) > 0));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_regulatory_relationships_from ON regulatory_relationships(from_code) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_regulatory_relationships_to   ON regulatory_relationships(to_code)   WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_regulatory_relationships_watch
  ON regulatory_relationships(display_order) WHERE is_active AND is_watchlist;

COMMENT ON TABLE regulatory_relationships IS
  'How two tracked regimes interact. Carries the same sourcing guarantee as regulatory_items: a claim that two rules conflict is exactly the kind of claim that needs a citation, because acting on it costs real money.';
COMMENT ON COLUMN regulatory_relationships.is_watchlist IS
  'TRUE where a company must satisfy both ends and cannot with one answer. Requires watchlist_detail — a divergence with no explanation of the bind is not actionable.';


-- ─── PART 4. Glossary ────────────────────────────────────────────────────────
-- The tracker is unreadable to a newcomer without this, and a sustainability
-- team is exactly where newcomers arrive: the acronym density is the first
-- barrier, before any of the content is hard.

CREATE TABLE IF NOT EXISTS regulatory_glossary (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term           VARCHAR(80) NOT NULL UNIQUE,
  expansion      TEXT,
  definition     TEXT NOT NULL,
  is_acronym     BOOLEAN NOT NULL DEFAULT FALSE,
  framework_code VARCHAR(40) REFERENCES regulatory_frameworks(code) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE regulatory_glossary IS
  'Terms and acronyms used across the tracker. Seeded as data so a deploying team can add its own vocabulary without a release.';


-- ─── PART 5. Updates gain "so what" ──────────────────────────────────────────
-- 024's feed says what happened and links the source. It does not say what to
-- do about it, which is the only part a busy team reads. Nullable: an update
-- with no action is honest, and inventing one would be worse.

ALTER TABLE regulatory_updates
  ADD COLUMN IF NOT EXISTS so_what      TEXT,
  ADD COLUMN IF NOT EXISTS significance VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_updates_significance_check') THEN
    ALTER TABLE regulatory_updates ADD CONSTRAINT regulatory_updates_significance_check
      CHECK (significance IS NULL OR significance IN ('high', 'medium', 'low'));
  END IF;
END $$;

COMMENT ON COLUMN regulatory_updates.so_what IS
  'What a reporting team should do about this, in one or two sentences. NULL where there is nothing to do — an invented action is worse than a blank.';

-- A natural key, so re-applying a content pack corrects the feed rather than
-- doubling it. 024 had no constraint here because it seeded the feed once;
-- a pack that can be regenerated needs somewhere to upsert onto. Existing
-- duplicates are collapsed first, oldest row wins, or the constraint cannot
-- be added at all.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_updates_natural_key') THEN
    DELETE FROM regulatory_updates a
      USING regulatory_updates b
      WHERE a.ctid > b.ctid
        AND a.item_code   = b.item_code
        AND a.update_date = b.update_date
        AND a.source_url  = b.source_url;

    ALTER TABLE regulatory_updates ADD CONSTRAINT regulatory_updates_natural_key
      UNIQUE (item_code, update_date, source_url);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_regulatory_updates_significance
  ON regulatory_updates(update_date DESC) WHERE significance = 'high';


-- ─── PART 6. RLS ─────────────────────────────────────────────────────────────
-- Same posture as 024: reference content, readable by any authenticated user,
-- writable only by the service role or a migration. It is not tenant data —
-- every organization sees the same regulatory facts.

ALTER TABLE regulatory_frameworks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_glossary      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regulatory_frameworks_read_authenticated" ON regulatory_frameworks;
CREATE POLICY "regulatory_frameworks_read_authenticated" ON regulatory_frameworks
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "regulatory_relationships_read_authenticated" ON regulatory_relationships;
CREATE POLICY "regulatory_relationships_read_authenticated" ON regulatory_relationships
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "regulatory_glossary_read_authenticated" ON regulatory_glossary;
CREATE POLICY "regulatory_glossary_read_authenticated" ON regulatory_glossary
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON regulatory_frameworks, regulatory_relationships, regulatory_glossary TO authenticated;
-- No write policies: service role or migration only.
