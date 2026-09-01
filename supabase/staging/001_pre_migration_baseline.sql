-- ============================================================================
-- STAGING FIXTURE ONLY — never run this against the production project.
--
-- Recreates the PRE-MIGRATION schema exactly as README.md documented it,
-- including the unconditional `Allow all anon` policies, plus a few rows of
-- fake data. The rehearsal then runs 001_owner_auth_and_rls.sql against this
-- and proves both that existing rows survive the backfill and that the
-- permissive policies are actually gone afterwards.
--
-- The data below is invented. Never copy production personal data into a
-- staging database.
-- ============================================================================

CREATE TABLE habit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  habit_id TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, habit_id)
);

CREATE TABLE custom_habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER[] NOT NULL,
  color TEXT DEFAULT '#6ee7b7',
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE split_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT split_config_singleton CHECK (id = 1)
);

CREATE TABLE mh_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mh_store_singleton CHECK (id = 1)
);

CREATE TABLE stimulation_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT stimulation_store_singleton CHECK (id = 1)
);

CREATE TABLE school_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT school_store_singleton CHECK (id = 1)
);

CREATE TABLE habit_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT habit_config_singleton CHECK (id = 1)
);

CREATE TABLE mind_texts_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mind_texts_store_singleton CHECK (id = 1)
);

ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mh_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE stimulation_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mind_texts_store ENABLE ROW LEVEL SECURITY;

-- The exposure this migration exists to remove.
CREATE POLICY "Allow all anon" ON habit_logs        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON custom_habits     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON split_config      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON mh_store          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON stimulation_store FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON school_store      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON habit_config      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON mind_texts_store  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ---- fake pre-existing data (must survive the backfill) --------------------
INSERT INTO habit_logs (date, habit_id, completed) VALUES
  (DATE '2025-01-02', 'gym_push_a', true),
  (DATE '2025-01-02', 'sleep_8h',   false),
  (DATE '2025-01-03', 'gym_push_a', true);

INSERT INTO custom_habits (name, days, color, sort_order) VALUES
  ('Staging habit', ARRAY[1,3,5], '#6ee7b7', 0);

INSERT INTO split_config      (id, data) VALUES (1, '{"staging":"split"}');
INSERT INTO mh_store          (id, data) VALUES (1, '{"staging":"mind"}');
INSERT INTO stimulation_store (id, data) VALUES (1, '{"staging":"stim"}');
INSERT INTO school_store      (id, data) VALUES (1, '{"staging":"school"}');
INSERT INTO habit_config      (id, data) VALUES (1, '{"staging":"habitcfg"}');
INSERT INTO mind_texts_store  (id, data) VALUES (1, '{"staging":"texts"}');
