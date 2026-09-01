// Secret hygiene in shipped browser code.
//
// These are regression tests for the two P0 exposures Phase 1 closed: a client
// PIN hash shipped in js/config.js, and the risk of a webhook or admin
// credential leaking into a tracked file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../../js/config.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs|html|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const clientFiles = [
  ...walk(join(ROOT, 'js')),
  join(ROOT, 'index.html'),
  join(ROOT, 'sw.js'),
];

test('CONFIG exposes only public Supabase values', () => {
  assert.ok(CONFIG.SUPABASE_URL.startsWith('https://'));
  assert.ok(CONFIG.SUPABASE_ANON_KEY.length > 0);
  // secret-scan:allow — this line is the guard against the retired PIN material
  assert.equal(CONFIG.PIN_HASH, undefined, 'the client PIN hash must be gone');
  assert.equal(CONFIG.PIN, undefined);
  assert.equal(CONFIG.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(CONFIG.DISCORD_WEBHOOK_URL, undefined);
});

test('the anon key really is an anon key, not a service-role key', () => {
  const [, payload] = CONFIG.SUPABASE_ANON_KEY.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(claims.role, 'anon', 'a service_role key must never ship to the browser');
});

test('no PIN material survives anywhere in client code', () => {
  const forbidden = [
    // secret-scan:allow — this line is the guard against the retired PIN material
    /PIN_HASH/,
    // secret-scan:allow — this line is the guard against the retired PIN material
    /cad6a6cdd207df506aab2f1ad1dc92a50183459a1e323b1b7c5ffe6547d953d1/,
    /hash of\s*["'`]?3510/i,
    /\bPIN\s*["'`]?\s*3510\b/,
  ];
  for (const file of clientFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${relative(ROOT, file)} still contains ${pattern}`);
    }
  }
});

test('no webhook, service-role key or password appears in client code', () => {
  const forbidden = [
    /discord(?:app)?\.com\/api\/webhooks/i,
    /service_role/,
    /DONTDIE_DISCORD_WEBHOOK_URL/,
  ];
  for (const file of clientFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${relative(ROOT, file)} must not mention ${pattern}`);
    }
  }
});

test('the notifier is server-only: nothing under js/ or sw.js reaches it', () => {
  for (const file of clientFiles) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/notify-phase/.test(text), `${relative(ROOT, file)} must not reference the notifier`);
  }
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /scripts\|supabase/, 'sw.js must explicitly refuse to cache server tooling paths');
});

test('index.html carries no inline script and a restrictive CSP', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
  assert.equal(inlineScripts.length, 0, 'every script must be an external same-origin file');

  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(csp, 'a CSP meta tag must be present');
  const policy = csp[1];
  assert.match(policy, /default-src 'self'/);

  const scriptSrc = policy.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
  assert.equal(scriptSrc, "script-src 'self'", 'script-src must be exactly self');
  assert.ok(!/unsafe-(inline|eval)/.test(scriptSrc), 'no unsafe script sources');
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /connect-src [^;]*supabase\.co/);
});

test('the repository secret scan passes', () => {
  // Runs the same gate used before every commit, so `npm run validate` fails
  // if a credential is ever introduced.
  const output = execFileSync(process.execPath, [join(ROOT, 'scripts', 'secret-scan.mjs')], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.match(output, /secret-scan: clean/);
});

test('.gitignore keeps .env out and .env.example in', () => {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^!\.env\.example$/m);

  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  assert.match(example, /^DONTDIE_DISCORD_WEBHOOK_URL=\s*$/m, 'the example must carry the name only');
  assert.ok(!/discord\.com\/api\/webhooks/.test(example));
});
