-- ============================================================
-- Run this in the Supabase SQL Editor (once, after the main schema).
-- Adds support for dynamic layouts and saved favorites.
-- ============================================================

-- 1. Remove the hard-coded section name restriction so any label is allowed
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_section_check;

-- 2. Allow inserting and deleting seats (needed when regenerating layout)
-- Drop first so re-running this script is safe
DROP POLICY IF EXISTS "Public insert" ON seats;
CREATE POLICY "Public insert" ON seats
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public delete" ON seats;
CREATE POLICY "Public delete" ON seats
  FOR DELETE USING (true);

-- 3. Layouts table — stores named layout configs as JSON
CREATE TABLE IF NOT EXISTS layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  -- config is an array of section objects: [{label, rows, cols}, ...]
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read layouts"   ON layouts;
DROP POLICY IF EXISTS "Public insert layouts" ON layouts;
DROP POLICY IF EXISTS "Public delete layouts" ON layouts;

CREATE POLICY "Public read layouts"   ON layouts FOR SELECT USING (true);
CREATE POLICY "Public insert layouts" ON layouts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete layouts" ON layouts FOR DELETE USING (true);
