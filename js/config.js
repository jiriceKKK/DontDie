// ============================================================
// CONFIGURATION — public Supabase project details.
//
// SECURITY NOTE
// The Supabase project URL and the anon key are *published* values: every
// browser that loads this app can read them, and that is by design. They are
// not credentials. Authorization is enforced server-side by Row Level
// Security policies keyed on `auth.uid()` (see supabase/migrations/), and the
// app authenticates with a real Supabase Auth session.
//
// Never put an owner password, a service-role key, a Discord webhook, or any
// other secret in this file or anywhere else under js/. Anything here is
// public. See docs/security-deployment.md.
// ============================================================

export const CONFIG = {
  // Supabase project URL (public).
  SUPABASE_URL: "https://xpcehodzmbalflkigcaj.supabase.co",

  // Supabase anon/public key (public; RLS is the actual boundary).
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwY2Vob2R6bWJhbGZsa2lnY2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NzAzMDEsImV4cCI6MjA5NTQ0NjMwMX0.-gBxuXHBp7Blb2l7peCInT_c3W0jEPECIGQ-pCzDfcY",

  // Optional on-device privacy lock shown when returning to an already
  // signed-in session. It is a UI convenience, NOT authorization: it never
  // gates a database request and its verifier is stored per device only.
  // The owner enables it from the sign-in screen; nothing is preconfigured.
  DEVICE_LOCK_ENABLED: true,
};
