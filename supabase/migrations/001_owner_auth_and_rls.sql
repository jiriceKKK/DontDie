-- ============================================================================
-- 001_owner_auth_and_rls.sql
--
-- Closes the P0 authorization exposure: every personal table gains a non-null
-- `user_id` owner, the unconditional `Allow all anon` policies are dropped, and
-- access is granted only when `auth.uid() = user_id`.
--
-- WHAT IT DOES
--   1. verifies the supplied owner UUID exists in auth.users;
--   2. adds `user_id uuid` (nullable), backfills every existing row to that
--      owner, then makes it NOT NULL with a FK to auth.users;
--   3. re-keys habit_logs uniqueness to (user_id, date, habit_id);
--   4. replaces each JSON table's global `id = 1` primary key with the
--      composite key (user_id, id), keeping `CHECK (id = 1)` per owner;
--   5. enables RLS, drops every anon policy, adds owner-scoped policies for
--      the `authenticated` role, and revokes all privileges from `anon`.
--
-- The optional `mind_texts_store` table is handled explicitly: if it is not
-- installed the migration skips it instead of failing halfway.
--
-- HOW TO RUN
--   Replace OWNER_UUID_PLACEHOLDER below with the owner's auth.users.id, then:
--     - Supabase SQL Editor: paste the whole file and run; or
--     - psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 001_owner_auth_and_rls.sql
--
--   The whole file runs in ONE transaction. Any failure rolls the entire
--   migration back — there is no partially migrated state.
--
--   Take a database-level backup (dashboard backup or pg_dump) BEFORE running
--   this against production. See docs/security-deployment.md.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Owner parameter. Transaction-local, so it works in the SQL Editor too.
-- ---------------------------------------------------------------------------
SELECT set_config('dontdie.owner_uuid', 'OWNER_UUID_PLACEHOLDER', true);

DO $$
DECLARE
  raw_owner text := current_setting('dontdie.owner_uuid', true);
  owner_id  uuid;
BEGIN
  -- Matched by pattern, not by literal, so a search-and-replace of the token
  -- above cannot accidentally rewrite this guard as well.
  IF raw_owner IS NULL OR raw_owner = '' OR raw_owner LIKE '%PLACEHOLDER%' THEN
    RAISE EXCEPTION
      'Owner UUID not set. Replace the placeholder token at the top of this file with the owner''s auth.users.id before running the migration.';
  END IF;

  BEGIN
    owner_id := raw_owner::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Owner UUID % is not a valid uuid', raw_owner;
  END;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = owner_id) THEN
    RAISE EXCEPTION
      'Owner UUID % does not exist in auth.users. Create the owner account first (Supabase Auth -> Users).', owner_id;
  END IF;

  RAISE NOTICE 'Migrating all existing rows to owner %', owner_id;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Owner column: add, backfill, enforce.
--    Runs for every table in the list, skipping any that is not installed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owner_id uuid := current_setting('dontdie.owner_uuid', true)::uuid;
  tbl      text;
  moved    bigint;
  tables   text[] := ARRAY[
    'habit_logs', 'custom_habits',
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'skipping %: table is not installed', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS user_id uuid', tbl);
    EXECUTE format('UPDATE public.%I SET user_id = %L WHERE user_id IS NULL', tbl, owner_id);
    GET DIAGNOSTICS moved = ROW_COUNT;
    RAISE NOTICE 'backfilled % row(s) in %', moved, tbl;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET NOT NULL', tbl);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET DEFAULT auth.uid()', tbl);

    -- Foreign key to the auth user, so deleting the account removes the data.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_user_id_fkey' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        tbl, tbl || '_user_id_fkey');
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (user_id)', 'idx_' || tbl || '_user_id', tbl);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. habit_logs: uniqueness is per owner, not global.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.habit_logs') IS NULL THEN
    RAISE EXCEPTION 'public.habit_logs is missing — refusing to continue';
  END IF;

  -- Old constraint name from the README schema: UNIQUE(date, habit_id).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.habit_logs'::regclass AND conname = 'habit_logs_date_habit_id_key'
  ) THEN
    ALTER TABLE public.habit_logs DROP CONSTRAINT habit_logs_date_habit_id_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.habit_logs'::regclass AND conname = 'habit_logs_user_date_habit_key'
  ) THEN
    ALTER TABLE public.habit_logs
      ADD CONSTRAINT habit_logs_user_date_habit_key UNIQUE (user_id, date, habit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON public.habit_logs (user_id, date);

-- ---------------------------------------------------------------------------
-- 3. JSON document tables: one row per owner instead of one row globally.
--    The primary key becomes (user_id, id); `CHECK (id = 1)` is kept so each
--    owner still has exactly one document row per store.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl     text;
  pk_name text;
  stores  text[] := ARRAY[
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
BEGIN
  FOREACH tbl IN ARRAY stores LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'skipping %: table is not installed', tbl;
      CONTINUE;
    END IF;

    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'p';

    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, pk_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (user_id, id)',
      tbl, tbl || '_pkey');

    -- Keep the per-owner singleton shape (id = 1) if the original CHECK is gone.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'c' AND conname = tbl || '_singleton'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (id = 1)', tbl, tbl || '_singleton');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security: drop every existing policy, deny anon, allow only the
--    authenticated owner.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl    text;
  pol    record;
  tables text[] := ARRAY[
    'habit_logs', 'custom_habits',
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    -- ENABLE (not FORCE) is deliberate. PostgREST connects as `anon` /
    -- `authenticated`, which are never the table owner, so RLS always applies
    -- to every request the browser can make. FORCE would additionally subject
    -- Supabase's own `postgres` role to the policies, which would break the
    -- dashboard table editor and dump-based recovery for no added protection
    -- against the client. `service_role` keeps BYPASSRLS for backups.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    -- Remove the permissive "Allow all anon" policies (and anything else that
    -- accumulated) so nothing unconditional survives this migration.
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    -- Owner-scoped policies. USING controls what is visible/modifiable;
    -- WITH CHECK stops a client writing a row owned by somebody else.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
      'owner_select_' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
      'owner_insert_' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      'owner_update_' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)',
      'owner_delete_' || tbl, tbl);

    -- Table privileges: anonymous visitors lose every grant; authenticated
    -- users keep CRUD, still filtered by the policies above.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
  END LOOP;
END $$;

-- Sequences (custom_habits uses gen_random_uuid(), but be explicit for anon).
DO $$
DECLARE seq record;
BEGIN
  FOR seq IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', seq.sequencename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Post-conditions. If any of these fail the whole migration rolls back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl        text;
  offenders  int;
  tables     text[] := ARRAY[
    'habit_logs', 'custom_habits',
    'split_config', 'mh_store', 'stimulation_store',
    'school_store', 'habit_config', 'mind_texts_store'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;

    -- RLS must be on.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || tbl)::regclass) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', tbl;
    END IF;

    -- No policy may target anon or be unconditional.
    SELECT count(*) INTO offenders
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles)
           OR coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true');
    IF offenders > 0 THEN
      RAISE EXCEPTION '% still has % permissive/anon policy(ies)', tbl, offenders;
    END IF;

    -- anon must hold no privilege at all.
    SELECT count(*) INTO offenders
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = tbl AND grantee = 'anon';
    IF offenders > 0 THEN
      RAISE EXCEPTION 'anon still holds % grant(s) on %', offenders, tbl;
    END IF;

    -- Ownership must be complete.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id IS NULL', tbl) INTO offenders;
    IF offenders > 0 THEN
      RAISE EXCEPTION '% still has % row(s) without an owner', tbl, offenders;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration post-conditions passed.';
END $$;

COMMIT;
