-- ============================================================================
-- 002_revision_and_archive_support.sql — VERIFICATION
--
-- Proves that compare-and-set actually holds after the migration:
--   A. schema shape   — revision NOT NULL and the trigger exist on every
--                       installed document table;
--   B. insert          — a new row starts at revision 1 with a server timestamp;
--   C. update          — revision advances by exactly 1 and updated_at moves,
--                        even when the client sends its own values;
--   D. compare-and-set — an UPDATE guarded by a stale revision matches zero
--                        rows and changes nothing;
--   E. isolation       — one owner's revision is unaffected by another's writes.
--
-- HOW TO RUN
--   Replace both placeholders, then run the file in one go:
--     OWNER_UUID_PLACEHOLDER  — the real owner's auth.users.id
--     OTHER_UUID_PLACEHOLDER  — a second, disposable auth.users.id
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify/002_revision_and_archive_support.sql
--
-- SAFETY
--   Section A is read-only. Sections B–E run inside a transaction that is
--   ALWAYS rolled back and only ever touch rows they create themselves. The
--   owner's real document rows are read for their revision but never written.
-- ============================================================================

\set ON_ERROR_STOP on

-- ===========================================================================
-- A. Schema shape (read-only)
-- ===========================================================================
DO $$
DECLARE
  tbl     text;
  stores  text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
  hits    int;
  present int := 0;
BEGIN
  FOREACH tbl IN ARRAY stores LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'A: % is not installed — skipped', tbl;
      CONTINUE;
    END IF;
    present := present + 1;

    SELECT count(*) INTO hits FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl
      AND column_name = 'revision' AND is_nullable = 'NO' AND data_type = 'bigint';
    IF hits <> 1 THEN RAISE EXCEPTION 'A/FAIL % lacks a NOT NULL bigint revision', tbl; END IF;

    SELECT count(*) INTO hits FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'updated_at';
    IF hits <> 1 THEN RAISE EXCEPTION 'A/FAIL % lacks updated_at', tbl; END IF;

    SELECT count(*) INTO hits
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl
      AND NOT t.tgisinternal AND t.tgname = 'dontdie_touch_' || tbl;
    IF hits <> 1 THEN RAISE EXCEPTION 'A/FAIL % is missing its dontdie_touch trigger', tbl; END IF;
  END LOOP;

  IF present = 0 THEN RAISE EXCEPTION 'A/FAIL no document tables installed'; END IF;
  RAISE NOTICE 'A/PASS revision support verified on % installed table(s)', present;
END $$;

-- ===========================================================================
-- B–E. Behaviour. Everything below is rolled back.
-- ===========================================================================
BEGIN;

SELECT set_config('dontdie.owner', 'OWNER_UUID_PLACEHOLDER', true);
SELECT set_config('dontdie.other', 'OTHER_UUID_PLACEHOLDER', true);

-- The document tables are keyed (user_id, id) with CHECK (id = 1), so the
-- checks below use the second identity's own row and never the owner's.
DO $$
DECLARE
  other_id  uuid := current_setting('dontdie.other', true)::uuid;
  owner_id  uuid := current_setting('dontdie.owner', true)::uuid;
  rev1      bigint;
  rev2      bigint;
  stamp1    timestamptz;
  stamp2    timestamptz;
  touched   int;
  owner_rev bigint;
BEGIN
  -- ---- B. insert starts at revision 1 -------------------------------------
  DELETE FROM public.split_config WHERE user_id = other_id;
  INSERT INTO public.split_config (user_id, id, data, revision, updated_at)
  VALUES (other_id, 1, '{"probe":1}'::jsonb, 999, timestamptz '1999-01-01')
  RETURNING revision, updated_at INTO rev1, stamp1;

  IF rev1 <> 1 THEN
    RAISE EXCEPTION 'B/FAIL insert produced revision % (client value was not discarded)', rev1;
  END IF;
  IF stamp1 < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'B/FAIL insert kept the client timestamp %', stamp1;
  END IF;
  RAISE NOTICE 'B/PASS insert starts at revision 1 with a server timestamp';

  -- Remember the owner's real revision so E can prove it never moved.
  SELECT revision INTO owner_rev FROM public.split_config WHERE user_id = owner_id AND id = 1;

  -- ---- C. update advances the revision by exactly one ---------------------
  UPDATE public.split_config
     SET data = '{"probe":2}'::jsonb, revision = 12345, updated_at = timestamptz '1999-01-01'
   WHERE user_id = other_id AND id = 1
  RETURNING revision, updated_at INTO rev2, stamp2;

  IF rev2 <> rev1 + 1 THEN
    RAISE EXCEPTION 'C/FAIL update produced revision % (expected %)', rev2, rev1 + 1;
  END IF;
  IF stamp2 <= stamp1 - interval '1 second' THEN
    RAISE EXCEPTION 'C/FAIL updated_at did not advance';
  END IF;
  RAISE NOTICE 'C/PASS update advances revision by one and refreshes updated_at';

  -- ---- D. a stale expected revision matches nothing -----------------------
  UPDATE public.split_config
     SET data = '{"probe":"stale"}'::jsonb
   WHERE user_id = other_id AND id = 1 AND revision = rev1;   -- rev1 is now old
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN
    RAISE EXCEPTION 'D/FAIL a stale compare-and-set updated % row(s)', touched;
  END IF;
  IF (SELECT data FROM public.split_config WHERE user_id = other_id AND id = 1) <> '{"probe":2}'::jsonb THEN
    RAISE EXCEPTION 'D/FAIL a stale compare-and-set changed the stored document';
  END IF;

  -- and the current revision still applies cleanly
  UPDATE public.split_config
     SET data = '{"probe":3}'::jsonb
   WHERE user_id = other_id AND id = 1 AND revision = rev2;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 1 THEN
    RAISE EXCEPTION 'D/FAIL a current compare-and-set matched % row(s)', touched;
  END IF;
  RAISE NOTICE 'D/PASS stale compare-and-set matches nothing; current one applies';

  -- ---- E. owners are isolated --------------------------------------------
  IF owner_rev IS DISTINCT FROM (SELECT revision FROM public.split_config WHERE user_id = owner_id AND id = 1) THEN
    RAISE EXCEPTION 'E/FAIL another owner''s writes moved the owner revision';
  END IF;
  RAISE NOTICE 'E/PASS one owner''s writes do not touch another owner''s revision';

  RAISE NOTICE 'VERIFICATION COMPLETE — all checks passed.';
END $$;

ROLLBACK;
