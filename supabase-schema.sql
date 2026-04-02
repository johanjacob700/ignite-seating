-- ============================================================
-- Ignite Church Seating Chart — Supabase Schema
-- Run this entire script in the Supabase SQL Editor once.
-- ============================================================

-- Seats table: one row per physical seat in the church
CREATE TABLE IF NOT EXISTS seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section     TEXT NOT NULL CHECK (section IN ('A', 'B', 'C')),
  row_number  INTEGER NOT NULL,
  col_number  INTEGER NOT NULL,
  label       TEXT NOT NULL UNIQUE,   -- e.g. "A-3-2"
  status      TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'reserved')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section, row_number, col_number)
);

-- Auto-update the updated_at timestamp on every change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seats_updated_at
  BEFORE UPDATE ON seats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security (required for publishable key usage)
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read seats (public view)
CREATE POLICY "Public read" ON seats
  FOR SELECT USING (true);

-- Allow anyone to update seat status (admin auth handled in the app via password)
-- In production you would tighten this with proper auth roles
CREATE POLICY "Public update" ON seats
  FOR UPDATE USING (true);

-- Enable Supabase Realtime for the seats table
ALTER PUBLICATION supabase_realtime ADD TABLE seats;

-- ============================================================
-- Seed all seats
-- Section A: 3 columns × 10 rows = 30 seats
-- Section B: 5 columns × 10 rows = 50 seats
-- Section C: 5 columns × 10 rows = 50 seats
-- Total: 130 seats
-- ============================================================

INSERT INTO seats (section, row_number, col_number, label)
SELECT 'A', r, c, 'A-' || r || '-' || c
FROM generate_series(1, 10) r, generate_series(1, 3) c
ON CONFLICT DO NOTHING;

INSERT INTO seats (section, row_number, col_number, label)
SELECT 'B', r, c, 'B-' || r || '-' || c
FROM generate_series(1, 10) r, generate_series(1, 5) c
ON CONFLICT DO NOTHING;

INSERT INTO seats (section, row_number, col_number, label)
SELECT 'C', r, c, 'C-' || r || '-' || c
FROM generate_series(1, 10) r, generate_series(1, 5) c
ON CONFLICT DO NOTHING;
