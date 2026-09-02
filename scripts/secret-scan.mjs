#!/usr/bin/env node
// ============================================================
// Secret scan — fails if a forbidden credential pattern appears in any file
// Git actually tracks (or would track). Run before every commit:
//   node scripts/secret-scan.mjs
// Patterns are deliberately structural: the scanner itself contains no secret.
// ============================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES = [
  { id: 'discord-webhook',   re: /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{10,}/, why: 'Discord webhook URL' },
  { id: 'supabase-service',  re: /"role"\s*:\s*"service_role"|\bservice_role\b\s*[:=]\s*['"]ey/, why: 'Supabase service-role key' },
  { id: 'jwt-secret-key',    re: /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*\S+/, why: 'service-role key assignment' },
  { id: 'legacy-pin-hash',   re: /\bPIN_HASH\b|\bcad6a6cdd207df506aab2f1ad1dc92a50183459a1e323b1b7c5ffe6547d953d1\b/, why: 'legacy client PIN hash' },
  { id: 'legacy-pin-clue',   re: /PIN\s*["'`]?\s*3510|hash of\s*["'`]?3510/i, why: 'legacy PIN literal / clue' },
  { id: 'pg-conn-password',  re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/, why: 'Postgres URL with inline password' },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, why: 'private key block' },
  { id: 'owner-password',    re: /\b(?:OWNER|SUPABASE)_PASSWORD\s*[:=]\s*\S+/i, why: 'owner password assignment' },
];

// Allow-list: files whose job is to *describe* the forbidden patterns.
const SELF = new Set(['scripts/secret-scan.mjs']);

// A line may opt out with an inline marker when it must literally contain a
// forbidden shape — a test fixture, or documentation of the pattern itself.
// The marker is accepted on the offending line or the line above it.
// Allowances are counted and printed, so they can never accumulate unnoticed.
const ALLOW_MARKER = 'secret-scan' + ':allow';

function tracked() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|zip|mp4|webm)$/i;
const findings = [];
const allowances = [];
let scanned = 0;

for (const file of tracked()) {
  if (SELF.has(file) || BINARY.test(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  scanned++;
  const lines = text.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (!rule.re.test(lines[i])) continue;
      const allowed = lines[i].includes(ALLOW_MARKER)
        || (i > 0 && lines[i - 1].includes(ALLOW_MARKER));
      if (allowed) { allowances.push(`${file}:${i + 1}  [${rule.id}]`); continue; }
      findings.push(`${file}:${i + 1}  [${rule.id}] ${rule.why}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Structural rule: the webhook notifiers are Node-only. Nothing that ships to
// a browser — anything under js/, index.html, the service worker, or an E2E
// artifact — may name them or the environment variable they read, because
// anything reachable from the page is reachable by anyone who opens the page.
// ---------------------------------------------------------------------------
const FRONTEND = /^(js\/|tests\/e2e\/|index\.html$|sw\.js$|vendor\/)/;
const FORBIDDEN_IN_FRONTEND = [
  { id: 'notifier-in-frontend', re: /notify-(?:phase|status)\.mjs|DONTDIE_DISCORD_WEBHOOK_URL/, why: 'server-only notifier reachable from browser code' },
];

for (const file of tracked()) {
  if (SELF.has(file) || BINARY.test(file) || !FRONTEND.test(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (const rule of FORBIDDEN_IN_FRONTEND) {
    for (let i = 0; i < lines.length; i++) {
      if (!rule.re.test(lines[i])) continue;
      findings.push(`${file}:${i + 1}  [${rule.id}] ${rule.why}`);
    }
  }
}

if (findings.length) {
  console.error(`secret-scan: ${findings.length} finding(s) across ${scanned} file(s)`);
  for (const f of findings) console.error('  x ' + f);
  process.exit(1);
}
console.log(`secret-scan: clean (${scanned} tracked/untracked-but-not-ignored files scanned, ${RULES.length} rules)`);
if (allowances.length) {
  console.log(`secret-scan: ${allowances.length} explicitly allowed line(s):`);
  for (const a of allowances) console.log('  - ' + a);
}
