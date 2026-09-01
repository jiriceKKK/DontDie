-- ============================================================================
-- STAGING FIXTURE ONLY — never run this against the production Supabase project.
--
-- A Supabase project already provides the `anon` / `authenticated` roles, the
-- `auth` schema, `auth.users`, and `auth.uid()`. A plain disposable Postgres
-- does not. This file recreates just enough of that surface so
-- supabase/migrations/001_owner_auth_and_rls.sql and its verification script
-- can be rehearsed end to end before touching production.
--
-- auth.uid() mirrors Supabase's real implementation: it reads the `sub` claim
-- out of the request-scoped `request.jwt.claims` GUC, which PostgREST sets per
-- request and which the verification script sets with set_config().
-- ============================================================================

-- Roles PostgREST switches into.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Two accounts for the rehearsal: the owner and a hostile second user.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@staging.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'intruder@staging.invalid')
ON CONFLICT (id) DO NOTHING;
