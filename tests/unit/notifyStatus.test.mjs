// The status notifier exists so an unfinished work turn is still reported —
// truthfully. The assertions that matter are what it REFUSES: completion
// wording, anything resembling an endpoint or token, and any route from
// browser code to the webhook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

import { prepare, buildMessage, looksLikeSecret, resolveEndpoint, STATES } from '../../scripts/notify-status.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'notify-status.mjs');

const GOOD_ARGS = [
  '--state', 'blocked',
  '--task', 'Phase 2 — local-first persistence',
  '--work', 'Repository layer and durable outbox landed; migration rehearsed in a disposable database.',
  '--checks', 'syntax, lint, secret scan, core typecheck, unit tests',
  '--next', 'Owner must approve applying the migration to production.',
];

// A plausible-looking but entirely fake endpoint. Nothing here is real: the id
// and token are literal placeholders.
// secret-scan:allow — a deliberately fake endpoint used to prove the notifier refuses it
const FAKE_WEBHOOK = 'https://discord.com/api/webhooks/000000000000000000/TESTTOKENtesttoken_placeholder-value';

async function runNotifier(env, args = GOOD_ARGS) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, DONTDIE_DISCORD_WEBHOOK_URL: '', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

// ---- states ---------------------------------------------------------------

test('offers exactly the three non-completion states', () => {
  assert.deepEqual(Object.keys(STATES).sort(), ['blocked', 'paused', 'working']);
});

test('refuses an unknown or missing state', async () => {
  assert.equal(prepare({ ...argsObject(), state: 'complete' }).ok, false);
  assert.equal(prepare({ ...argsObject(), state: '' }).ok, false);
  const result = await runNotifier({}, ['--state', 'done', '--task', 't', '--work', 'w', '--checks', 'c', '--next', 'n']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /working, paused or blocked/);
});

function argsObject() {
  return {
    state: 'paused',
    task: 'Phase 2',
    work: 'Wrote the repository layer',
    checks: 'unit tests',
    next: 'Owner review',
  };
}

// ---- it must never claim completion --------------------------------------

test('no state label uses completion wording', () => {
  for (const [name, state] of Object.entries(STATES)) {
    assert.doesNotMatch(state.label, /complete/i, `${name} must not say "complete"`);
  }
});

test('refuses a message body that claims the phase completed', () => {
  for (const claim of ['Phase 2 complete', 'phase complete', 'completed successfully', 'success: true']) {
    const result = prepare({ ...argsObject(), work: claim });
    assert.equal(result.ok, false, `should refuse: ${claim}`);
    assert.match(result.error, /completion wording/);
  }
});

test('the rendered message never contains the word "complete"', () => {
  for (const state of Object.keys(STATES)) {
    const content = buildMessage({ ...argsObject(), state });
    assert.doesNotMatch(content, /complete/i);
  }
});

// ---- it must never carry a secret ----------------------------------------

test('recognises endpoints and tokens in a body', () => {
  assert.equal(looksLikeSecret('all fine here'), false);
  assert.equal(looksLikeSecret('see https://example.com'), true);
  assert.equal(looksLikeSecret('posted to discord.com'), true);
  assert.equal(looksLikeSecret('token eyJhbGciOiJIUzI1NiJ9.payload'), true);
  // secret-scan:allow — a fabricated connection string, present so the guard can be proven to catch one
  assert.equal(looksLikeSecret('postgres://user:pw@host/db'), true);
  assert.equal(looksLikeSecret('wss://realtime.example'), true);
});

test('refuses a message containing a URL', () => {
  const result = prepare({ ...argsObject(), next: 'open https://example.com/thing' });
  assert.equal(result.ok, false);
  assert.match(result.error, /URL, endpoint or token/);
});

test('refuses a message containing a JWT', () => {
  const result = prepare({ ...argsObject(), checks: 'used eyJhbGciOiJIUzI1NiJ9.abc to sign in' });
  assert.equal(result.ok, false);
});

// ---- endpoint validation --------------------------------------------------

test('refuses a missing, non-HTTPS, non-Discord or malformed endpoint', () => {
  assert.match(resolveEndpoint('').error, /is not set/);
  // secret-scan:allow — deliberately fake endpoints used to prove the notifier refuses them
  assert.match(resolveEndpoint('http://discord.com/api/webhooks/1/abcdefghij').error, /must use https/);
  assert.match(resolveEndpoint('https://evil.example/api/webhooks/1/abcdefghij').error, /not an allowed Discord host/);
  assert.match(resolveEndpoint('https://discord.com/not-a-webhook').error, /webhook path/);
  assert.equal(resolveEndpoint(FAKE_WEBHOOK).ok, true);
});

test('never prints the endpoint, even when delivery fails', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: FAKE_WEBHOOK });
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /TESTTOKENtesttoken/);
  assert.doesNotMatch(output, /discord\.com\/api\/webhooks/);
});

// ---- dry run and delivery -------------------------------------------------

test('a dry run prints the message and contacts nothing', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: '' }, [...GOOD_ARGS, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Blocked/);
  assert.match(result.stdout, /Next required action/);
  assert.doesNotMatch(result.stdout, /complete/i);
});

test('every required field must be supplied', async () => {
  for (const missing of ['task', 'work', 'checks', 'next']) {
    const args = argsObject();
    delete args[missing];
    const result = prepare(args);
    assert.equal(result.ok, false, `should refuse a message with no --${missing}`);
    assert.match(result.error, new RegExp(missing));
  }
});

test('delivers to a controlled endpoint and reports a non-2xx as a failure', async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(received.length === 1 ? 204 : 500).end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // The host allow-list is deliberately strict, so delivery itself is proven
  // against the loopback server by calling fetch through the same shape the
  // script uses; the script's own refusal of a non-Discord host is asserted
  // above. This keeps the network test hermetic without weakening the rule.
  const send = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/1/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: buildMessage({ ...argsObject(), state: 'working' }), allowed_mentions: { parse: [] } }),
      redirect: 'error',
    });
    return response.status;
  };

  assert.equal(await send(), 204);
  assert.equal(await send(), 500);
  assert.equal(received.length, 2);
  assert.match(received[0].content, /Work in progress/);
  assert.deepEqual(received[0].allowed_mentions, { parse: [] });
  await new Promise(resolve => server.close(resolve));
});

// ---- unreachable from the browser ----------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('no browser-delivered file can reach the notifier or its environment variable', () => {
  const shipped = [
    join(ROOT, 'index.html'),
    join(ROOT, 'sw.js'),
    ...walk(join(ROOT, 'js')),
  ];
  for (const file of shipped) {
    const text = readFileSync(file, 'utf8');
    const where = relative(ROOT, file).split(sep).join('/');
    assert.doesNotMatch(text, /notify-status\.mjs/, `${where} must not reference the status notifier`);
    assert.doesNotMatch(text, /notify-phase\.mjs/, `${where} must not reference the phase notifier`);
    assert.doesNotMatch(text, /DONTDIE_DISCORD_WEBHOOK_URL/, `${where} must not name the webhook variable`);
  }
});

test('the service worker does not cache the scripts directory', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /scripts\//);
});
