-- ============================================================
-- Run this in the Supabase SQL Editor (once).
-- Adds the layout_meta table which stores the currently active
-- layout config (section order + orientations) so both the admin
-- and public seating views render sections correctly.
-- ============================================================

CREATE TABLE IF NOT EXISTS layout_meta (
  id      INT PRIMARY KEY DEFAULT 1,
  config  JSONB,
  -- Enforce a single row — this table is always an upsert of id=1
  CONSTRAINT layout_meta_single_row CHECK (id = 1)
);

ALTER TABLE layout_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read layout_meta"   ON layout_meta;
DROP POLICY IF EXISTS "Public write layout_meta"  ON layout_meta;

CREATE POLICY "Public read layout_meta"  ON layout_meta FOR SELECT USING (true);
-- Allows insert + update (upsert) from the browser client
CREATE POLICY "Public write layout_meta" ON layout_meta FOR ALL USING (true) WITH CHECK (true);

-- Seed a default config matching the original 3-section church layout
INSERT INTO layout_meta (id, config) VALUES (
  1,
  '[
    {"label":"A","rows":10,"cols":3,"orientation":"vertical"},
    {"label":"B","rows":10,"cols":5,"orientation":"vertical"},
    {"label":"C","rows":10,"cols":5,"orientation":"vertical"}
  ]'::jsonb
) ON CONFLICT (id) DO NOTHING;
