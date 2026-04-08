-- Attendance records table.
-- One row per Sunday service submission.
-- Run this once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS attendance (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  total_occupied     INTEGER     NOT NULL DEFAULT 0,
  total_reserved     INTEGER     NOT NULL DEFAULT 0,
  total_vacant       INTEGER     NOT NULL DEFAULT 0,
  total_seats        INTEGER     NOT NULL DEFAULT 0,
  efficiency_score   INTEGER     NOT NULL DEFAULT 0,   -- 0–100
  section_breakdown  JSONB       NOT NULL DEFAULT '[]',
  efficiency_notes   JSONB       NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read attendance history (public dashboard)
DROP POLICY IF EXISTS "Public read attendance"  ON attendance;
CREATE POLICY "Public read attendance"  ON attendance FOR SELECT USING (true);

-- Allow admin to insert (no server-side auth, relies on admin password in the UI)
DROP POLICY IF EXISTS "Public insert attendance" ON attendance;
CREATE POLICY "Public insert attendance" ON attendance FOR INSERT WITH CHECK (true);
