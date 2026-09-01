-- ============================================================================
-- 001_owner_auth_and_rls.sql — VERIFICATION
--
-- Proves the authorization boundary actually holds after the migration. Every
-- check raises an exception on failure, so a non-zero psql exit (or a red
-- error in the SQL Editor) means the deployment is NOT safe.
--
-- It asserts:
--   A. schema shape       — user_id present/NOT NULL, RLS on, no anon grants,
--                           no unconditional policy, per-owner document keys;
--   B. anonymous access   — anon reads nothing and cannot insert;
--   C. owner access       — the owner reads and writes their own rows;
--   D. cross-user access  — a second user sees nothing of the owner's and
--                           cannot update or delete it;
--   E. spoofing           — nobody can insert a row owned by another user;
--   F. per-owner singleton— two owners can each hold `id = 1` in every JSON
--                           store (the old global singleton is gone).
--
-- HOW TO RUN
--   Replace both placeholders, then run the file in one go:
--     OWNER_UUID_PLACEHOLDER  — the real owner's auth.users.id
--     OTHER_UUID_PLACEHOLDER  — a second, disposable auth.users.id
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify/001_owner_auth_and_rls.sql
--
-- SAFETY
--   Sections B–F run inside a transaction that is ALWAYS rolled back, and they
--   only ever touch rows they create themselves (habit_id 'verify_*',
--   date 1999-01-01). Nothing you own is modified. Even so, prefer running the
--   full file against a staging/disposable project first.
-- ============================================================================

\set ON_ERROR_STOP on

-- ===========================================================================
-- A. Schema shape (read-only)
-- ===========================================================================
DO $$
DECLARE
  tbl       text;
  offenders int;
  tables    text[] := ARRAY[
    'habit_logs', 'custom_habits',
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
  stores    text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
  present   int := 0;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'A: % is not installed — skipped', tbl;
      CONTINUE;
    END IF;
    present := present + 1;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl
        AND column_name = 'user_id' AND is_nullable = 'NO' AND data_type = 'uuid'
    ) THEN
      RAISE EXCEPTION 'A/FAIL %: user_id is missing, nullable, or not uuid', tbl;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || tbl)::regclass) THEN
      RAISE EXCEPTION 'A/FAIL %: row level security is disabled', tbl;
    END IF;

    SELECT count(*) INTO offenders
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = tbl AND grantee IN ('anon', 'PUBLIC');
    IF offenders > 0 THEN
      RAISE EXCEPTION 'A/FAIL %: anon/PUBLIC still holds % grant(s)', tbl, offenders;
    END IF;

    SELECT count(*) INTO offenders
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles)
           OR coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true');
    IF offenders > 0 THEN
      RAISE EXCEPTION 'A/FAIL %: % unconditional or anon policy(ies) remain', tbl, offenders;
    END IF;

    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl) = 0 THEN
      RAISE EXCEPTION 'A/FAIL %: RLS is on but no owner policy exists', tbl;
    END IF;
  END LOOP;

  -- habit_logs uniqueness must be per owner.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.habit_logs'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(user_id, date, habit_id)%'
  ) THEN
    RAISE EXCEPTION 'A/FAIL habit_logs: uniqueness is not (user_id, date, habit_id)';
  END IF;

  -- Document stores must be keyed per owner, not by id alone.
  FOREACH tbl IN ARRAY stores LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'p'
        AND pg_get_constraintdef(oid) ILIKE '%(user_id, id)%'
    ) THEN
      RAISE EXCEPTION 'A/FAIL %: primary key is not (user_id, id)', tbl;
    END IF;
  END LOOP;

  RAISE NOTICE 'A/PASS schema shape verified on % installed table(s)', present;
END $$;

-- ===========================================================================
-- B–F. Behavioural checks. Everything below is rolled back.
-- ===========================================================================
BEGIN;

SELECT set_config('dontdie.owner_uuid', 'OWNER_UUID_PLACEHOLDER', true);
SELECT set_config('dontdie.other_uuid', 'OTHER_UUID_PLACEHOLDER', true);

DO $$
DECLARE
  owner_id uuid;
  other_id uuid;
BEGIN
  -- Matched by pattern so replacing the tokens above cannot rewrite the guard.
  IF current_setting('dontdie.owner_uuid', true) LIKE '%PLACEHOLDER%'
     OR current_setting('dontdie.other_uuid', true) LIKE '%PLACEHOLDER%'
     OR coalesce(current_setting('dontdie.owner_uuid', true), '') = ''
     OR coalesce(current_setting('dontdie.other_uuid', true), '') = '' THEN
    RAISE EXCEPTION 'Replace both owner placeholders at the top of this section before running the behavioural checks.';
  END IF;
  owner_id := current_setting('dontdie.owner_uuid', true)::uuid;
  other_id := current_setting('dontdie.other_uuid', true)::uuid;
  IF owner_id = other_id THEN
    RAISE EXCEPTION 'The owner and the second test user must be different accounts.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = owner_id) THEN
    RAISE EXCEPTION 'owner uuid % is not in auth.users', owner_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = other_id) THEN
    RAISE EXCEPTION 'second-user uuid % is not in auth.users', other_id;
  END IF;
END $$;

-- Seed one owner-owned probe row while still privileged.
INSERT INTO public.habit_logs (user_id, date, habit_id, completed)
VALUES (current_setting('dontdie.owner_uuid', true)::uuid, DATE '1999-01-01', 'verify_owner_probe', true);

-- ---------------------------------------------------------------------------
-- B. Anonymous access is denied.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  visible int;
  blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;

  BEGIN
    SELECT count(*) INTO visible FROM public.habit_logs;
    IF visible <> 0 THEN
      RAISE EXCEPTION 'B/FAIL anon can read % habit_logs row(s)', visible;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      visible := 0; -- privilege revoked outright: also a pass
  END;

  BEGIN
    INSERT INTO public.habit_logs (user_id, date, habit_id, completed)
    VALUES (current_setting('dontdie.owner_uuid', true)::uuid, DATE '1999-01-01', 'verify_anon_insert', true);
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'B/FAIL anon was able to insert into habit_logs';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'B/PASS anonymous access denied (no rows readable, insert blocked)';
END $$;

-- ---------------------------------------------------------------------------
-- C. The owner can read and write their own rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owner_id uuid := current_setting('dontdie.owner_uuid', true)::uuid;
  visible  int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible FROM public.habit_logs WHERE habit_id = 'verify_owner_probe';
  IF visible <> 1 THEN
    RAISE EXCEPTION 'C/FAIL owner sees % probe row(s), expected 1', visible;
  END IF;

  INSERT INTO public.habit_logs (user_id, date, habit_id, completed)
  VALUES (owner_id, DATE '1999-01-01', 'verify_owner_insert', true);

  UPDATE public.habit_logs SET completed = false WHERE habit_id = 'verify_owner_insert';
  GET DIAGNOSTICS visible = ROW_COUNT;
  IF visible <> 1 THEN
    RAISE EXCEPTION 'C/FAIL owner update affected % row(s), expected 1', visible;
  END IF;

  DELETE FROM public.habit_logs WHERE habit_id = 'verify_owner_insert';
  GET DIAGNOSTICS visible = ROW_COUNT;
  IF visible <> 1 THEN
    RAISE EXCEPTION 'C/FAIL owner delete affected % row(s), expected 1', visible;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'C/PASS owner can select/insert/update/delete their own rows';
END $$;

-- ---------------------------------------------------------------------------
-- D. A second user cannot see or mutate the owner's rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  other_id uuid := current_setting('dontdie.other_uuid', true)::uuid;
  affected int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO affected FROM public.habit_logs WHERE habit_id = 'verify_owner_probe';
  IF affected <> 0 THEN
    RAISE EXCEPTION 'D/FAIL second user can read % of the owner''s row(s)', affected;
  END IF;

  UPDATE public.habit_logs SET completed = false WHERE habit_id = 'verify_owner_probe';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'D/FAIL second user updated % of the owner''s row(s)', affected;
  END IF;

  DELETE FROM public.habit_logs WHERE habit_id = 'verify_owner_probe';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'D/FAIL second user deleted % of the owner''s row(s)', affected;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'D/PASS cross-user read/update/delete all denied';
END $$;

-- ---------------------------------------------------------------------------
-- E. Inserts cannot spoof another user_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owner_id uuid := current_setting('dontdie.owner_uuid', true)::uuid;
  other_id uuid := current_setting('dontdie.other_uuid', true)::uuid;
  blocked  boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.habit_logs (user_id, date, habit_id, completed)
    VALUES (owner_id, DATE '1999-01-01', 'verify_spoof', true);
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'E/FAIL a user inserted a row owned by somebody else';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'E/PASS insert cannot spoof another user_id';
END $$;

-- ---------------------------------------------------------------------------
-- F. JSON document stores are singletons PER OWNER, not globally.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owner_id uuid := current_setting('dontdie.owner_uuid', true)::uuid;
  other_id uuid := current_setting('dontdie.other_uuid', true)::uuid;
  tbl      text;
  rows_ok  int;
  blocked  boolean;
  stores   text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
BEGIN
  FOREACH tbl IN ARRAY stores LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;

    -- Both owners may hold id = 1 simultaneously.
    EXECUTE format(
      'INSERT INTO public.%I (user_id, id, data) VALUES (%L, 1, ''{"verify":true}''::jsonb)
         ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data', tbl, owner_id);
    EXECUTE format(
      'INSERT INTO public.%I (user_id, id, data) VALUES (%L, 1, ''{"verify":true}''::jsonb)
         ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data', tbl, other_id);

    EXECUTE format('SELECT count(*) FROM public.%I WHERE id = 1 AND user_id IN (%L, %L)', tbl, owner_id, other_id)
      INTO rows_ok;
    IF rows_ok <> 2 THEN
      RAISE EXCEPTION 'F/FAIL %: expected one id=1 row per owner, found %', tbl, rows_ok;
    END IF;

    -- A second row for the same owner must still be impossible.
    blocked := false;
    BEGIN
      EXECUTE format('INSERT INTO public.%I (user_id, id, data) VALUES (%L, 2, ''{}''::jsonb)', tbl, owner_id);
    EXCEPTION
      WHEN check_violation THEN blocked := true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'F/FAIL %: the per-owner singleton CHECK (id = 1) is missing', tbl;
    END IF;

    -- And the second user must not see the owner's document.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = %L', tbl, owner_id) INTO rows_ok;
    IF rows_ok <> 0 THEN
      RAISE EXCEPTION 'F/FAIL %: second user can read the owner''s document', tbl;
    END IF;
    RESET ROLE;
  END LOOP;

  RAISE NOTICE 'F/PASS document stores are per-owner singletons and stay isolated';
END $$;

-- Nothing above is kept: this rolls back the probe rows and every test write.
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'VERIFICATION COMPLETE — all checks passed.'; END $$;
