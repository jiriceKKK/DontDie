// ============================================================
// CONFIGURATION — fill in your Supabase project details below
// ============================================================

const CONFIG = {
  // Your Supabase project URL
  SUPABASE_URL: "https://xpcehodzmbalflkigcaj.supabase.co",

  // Your Supabase anon/public key
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwY2Vob2R6bWJhbGZsa2lnY2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NzAzMDEsImV4cCI6MjA5NTQ0NjMwMX0.-gBxuXHBp7Blb2l7peCInT_c3W0jEPECIGQ-pCzDfcY",

  // SHA-256 hash of PIN "3510"
  // Computed via: crypto.subtle.digest('SHA-256', new TextEncoder().encode('3510'))
  // To change the PIN: use the snippet in README.md to compute the new hash
  PIN_HASH: "cad6a6cdd207df506aab2f1ad1dc92a50183459a1e323b1b7c5ffe6547d953d1",
};
