-- ============================================================================
-- 002_revision_and_archive_support.sql
--
-- Gives every JSON document table the optimistic-concurrency metadata the
-- Phase 2 local-first repository needs, so a whole-document write is a
-- compare-and-set instead of a last-write-wins overwrite.
--
-- WHAT IT DOES
--   1. adds `revision bigint NOT NULL DEFAULT 1` to each installed document
--      table (split_config, mh_store, stimulation_store, school_store, and the
--      optional mind_texts_store / habit_config);
--   2. installs a BEFORE INSERT/UPDATE trigger that maintains `revision` and
--      `updated_at` SERVER-SIDE. The client cannot set, skip or rewind either:
--      an UPDATE always lands on OLD.revision + 1 and now().
--
-- HOW THE CLIENT USES IT
--   UPDATE ... SET data = $new
--    WHERE user_id = auth.uid() AND id = 1 AND revision = $expected
--   RETURNING revision;
--   Zero rows returned means the cloud moved on. js/data/reconcile.js then
--   fetches the remote copy and stores BOTH versions as a recoverable
--   conflict — it never overwrites either side.
--
-- BACKWARD COMPATIBILITY
--   Both columns are additive and server-maintained, so the deployed Phase 1
--   client keeps working unchanged: its plain `upsert` still succeeds, and the
--   trigger simply overrides the `updated_at` it sends. No existing row, field
--   or unknown JSON key is touched.
--
--   Archive/tombstone semantics for activities, tests and custom habits are
--   deliberately NOT in this migration. Phase 2 keeps tombstones on the device
--   (js/data/habitRepository.js) and Phase 3 is where the archive model and its
--   read-path rules are specified; adding a half-defined `deleted_at` here
--   would change what the deployed client sees before anything filters on it.
--
-- HOW TO RUN
--   Supabase SQL Editor: paste and run. Or:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 002_revision_and_archive_support.sql
--
--   The whole file runs in ONE transaction; any failure rolls it all back.
--   Take a database-level backup BEFORE running it against production.
--   This migration needs no owner UUID: it adds no rows and re-keys nothing.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The shared trigger function.
--    SECURITY INVOKER and a pinned search_path: it must not be a privilege
--    escalation route, and it must not resolve `now()` through a caller's path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dontdie_touch_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision := 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: the client's values for these two columns are always discarded.
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.dontdie_touch_document() IS
  'Maintains revision/updated_at on DontDie JSON document tables. Client-supplied values are ignored so compare-and-set cannot be defeated from the browser.';

-- ---------------------------------------------------------------------------
-- 2. Apply to every installed document table.
--    Skip-if-absent, exactly like migration 001: production has no
--    `habit_config`, and `mind_texts_store` is documented as optional.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl      text;
  stores   text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
  present  int := 0;
BEGIN
  FOREACH tbl IN ARRAY stores LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE '002: % is not installed — skipped', tbl;
      CONTINUE;
    END IF;
    present := present + 1;

    -- 2a. revision column (idempotent).
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1', tbl);

    -- 2b. updated_at must exist and be non-null before a trigger relies on it.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz', tbl);
    EXECUTE format(
      'UPDATE public.%I SET updated_at = now() WHERE updated_at IS NULL', tbl);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN updated_at SET DEFAULT now()', tbl);

    -- 2c. the trigger itself (re-created so a rerun converges).
    EXECUTE format('DROP TRIGGER IF EXISTS dontdie_touch_%s ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER dontdie_touch_%s BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.dontdie_touch_document()', tbl, tbl);
  END LOOP;

  IF present = 0 THEN
    RAISE EXCEPTION '002: no document tables found — refusing to claim success';
  END IF;
  RAISE NOTICE '002: revision support installed on % table(s)', present;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Post-conditions. A failure here rolls the whole migration back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl      text;
  stores   text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
  missing  int;
BEGIN
  FOREACH tbl IN ARRAY stores LOOP
    CONTINUE WHEN to_regclass('public.' || tbl) IS NULL;

    SELECT count(*) INTO missing
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl
      AND column_name = 'revision' AND is_nullable = 'NO';
    IF missing <> 1 THEN
      RAISE EXCEPTION '% has no NOT NULL revision column', tbl;
    END IF;

    SELECT count(*) INTO missing
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl
      AND NOT t.tgisinternal AND t.tgname = 'dontdie_touch_' || tbl;
    IF missing <> 1 THEN
      RAISE EXCEPTION '% is missing its dontdie_touch trigger', tbl;
    END IF;

    -- Row counts must be untouched: this migration adds columns, never rows.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE revision IS NULL', tbl) INTO missing;
    IF missing > 0 THEN
      RAISE EXCEPTION '% has % row(s) with a null revision', tbl, missing;
    END IF;
  END LOOP;

  RAISE NOTICE '002: post-conditions passed.';
END $$;

COMMIT;
