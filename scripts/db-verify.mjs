#!/usr/bin/env node
// ============================================================
// Migration rehearsal against a DISPOSABLE Postgres.
//
// Applies, in order:
//   supabase/staging/000_supabase_compat.sql       (auth.uid(), roles — staging only)
//   supabase/staging/001_pre_migration_baseline.sql (the old README schema + fake rows)
//   supabase/migrations/001_owner_auth_and_rls.sql  (the real migration)
//   supabase/verify/001_owner_auth_and_rls.sql      (the real verification)
//
// It refuses to run against anything that looks like the production Supabase
// project, and it never reads or writes real personal data.
//
// Usage:
// secret-scan:allow — usage example for a disposable local database, not a secret
//   DONTDIE_STAGING_DATABASE_URL=postgres://user:pw@127.0.0.1:55432/dontdie_staging \
//     node scripts/db-verify.mjs
//
// Requires `psql` on PATH.
// ============================================================
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Staging identities defined by supabase/staging/000_supabase_compat.sql.
const OWNER_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const url = (process.env.DONTDIE_STAGING_DATABASE_URL || '').trim();
if (!url) {
  console.error('db-verify: DONTDIE_STAGING_DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
if (/supabase\.(co|com)/i.test(url) || /\bprod\b/i.test(url)) {
  console.error('db-verify: refusing to run — that connection string looks like a hosted/production project.');
  process.exit(1);
}

try {
  execFileSync('psql', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('db-verify: psql is not on PATH.');
  process.exit(1);
}

// A rehearsal must start from a known-empty database, otherwise the second run
// trips over objects the first one created. `--reset` (default on for a local
// URL) drops and recreates the target database through the maintenance DB.
const reset = !process.argv.includes('--no-reset');
if (reset) {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    console.error('db-verify: refusing to reset an unusual database name.');
    process.exit(1);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  try {
    // Separate -c invocations: psql wraps multiple statements in one -c into a
    // transaction, and DROP/CREATE DATABASE cannot run inside one.
    await run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-q', '-c',
      `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
    await run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-q', '-c',
      `CREATE DATABASE ${dbName}`]);
    console.log(`db-verify: reset database ${dbName}`);
  } catch (err) {
    console.error('db-verify: could not reset the staging database');
    console.error(String(err.stderr || err.message).trim());
    process.exit(1);
  }
}

const workdir = mkdtempSync(join(tmpdir(), 'dontdie-dbverify-'));

/** Copy a SQL file with the owner placeholders filled in for the rehearsal. */
function materialise(relPath, replacements = {}) {
  let sql = readFileSync(join(ROOT, relPath), 'utf8');
  for (const [from, to] of Object.entries(replacements)) sql = sql.split(from).join(to);
  const out = join(workdir, relPath.replace(/[/\\]/g, '_'));
  writeFileSync(out, sql, 'utf8');
  return out;
}

const steps = [
  ['staging compat  ', materialise('supabase/staging/000_supabase_compat.sql')],
  ['pre-migration   ', materialise('supabase/staging/001_pre_migration_baseline.sql')],
  ['migration 001   ', materialise('supabase/migrations/001_owner_auth_and_rls.sql', { OWNER_UUID_PLACEHOLDER: OWNER_UUID })],
  ['verification 001', materialise('supabase/verify/001_owner_auth_and_rls.sql', {
    OWNER_UUID_PLACEHOLDER: OWNER_UUID,
    OTHER_UUID_PLACEHOLDER: OTHER_UUID,
  })],
];

let failed = false;
for (const [label, file] of steps) {
  try {
    const { stdout, stderr } = await run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const notices = (stderr || '').split('\n').filter(l => /PASS|FAIL|NOTICE/.test(l));
    console.log(`db-verify: ${label} OK`);
    for (const line of notices) console.log('   ' + line.replace(/^NOTICE:\s*/, ''));
    if (stdout.trim()) console.log(stdout.trim());
  } catch (err) {
    failed = true;
    console.error(`db-verify: ${label} FAILED`);
    console.error(String(err.stderr || err.stdout || err.message).trim());
    break;
  }
}

process.exit(failed ? 1 : 0);
