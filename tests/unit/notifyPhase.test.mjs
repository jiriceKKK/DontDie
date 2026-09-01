// The phase notifier. It handles the only secret this repository touches, so
// the important assertions are about what it REFUSES to do and about the URL
// never appearing in its output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'notify-phase.mjs');

const GOOD_ARGS = [
  '--phase', '1',
  '--name', 'Security, Recovery Guardrails, and Executable Quality Baseline',
  '--summary', 'Owner-scoped RLS, real auth, validation tooling.',
  '--checks', 'syntax, lint, unit, e2e, secret scan',
  '--success', 'true',
  '--deviations', 'None',
];

// A plausible-looking but entirely fake endpoint. Nothing here is a real
// webhook: the id/token are literal placeholders.
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

test('refuses to run with no webhook in the environment', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: '' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /is not set/);
});

test('refuses a non-HTTPS endpoint', async () => {
  // secret-scan:allow — a deliberately fake endpoint used to prove the notifier refuses it
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: 'http://discord.com/api/webhooks/1/abcdefghij' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must use https/);
});

test('refuses a non-Discord host', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: 'https://evil.example/api/webhooks/1/abcdefghij' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not an allowed Discord host/);
});

test('refuses a malformed webhook path', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: 'https://discord.com/not/a/webhook' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not look like a Discord webhook path/);
});

test('refuses to announce a phase that did not succeed', async () => {
  const args = GOOD_ARGS.map(a => (a === 'true' ? 'false' : a));
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: FAKE_WEBHOOK }, args);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be exactly "true"/);
});

test('requires the descriptive fields', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: FAKE_WEBHOOK },
    ['--phase', '1', '--success', 'true']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required --name/);
});

test('refuses a message body that carries a URL or token', async () => {
  const args = [...GOOD_ARGS];
  args[args.indexOf('--summary') + 1] = 'see https://discord.com/api/webhooks/1/leak';
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: FAKE_WEBHOOK }, args);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /looks like it contains a URL/);
});

test('never prints the endpoint, on success or failure', async () => {
  const secret = FAKE_WEBHOOK;
  const token = secret.split('/').pop();

  const failure = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: secret },
    ['--phase', '1', '--success', 'true']);
  const output = failure.stdout + failure.stderr;
  assert.ok(!output.includes(secret), 'the URL must never be printed');
  assert.ok(!output.includes(token), 'the token must never be printed');
});

test('a non-allowed host is rejected before any request is made', async (t) => {
  // A local stand-in for Discord. It must never receive anything: the host
  // allow-list has to reject the endpoint before the fetch happens.
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { received.push(body); res.writeHead(204).end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const result = await runNotifier({
    DONTDIE_DISCORD_WEBHOOK_URL: `https://127.0.0.1:${port}/api/webhooks/1/abcdefghij`,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not an allowed Discord host/);
  assert.equal(received.length, 0, 'nothing may be sent to a non-allowed host');
});

test('the dry run builds a complete message and contacts nothing', async () => {
  const result = await runNotifier({ DONTDIE_DISCORD_WEBHOOK_URL: FAKE_WEBHOOK },
    [...GOOD_ARGS, '--dry-run']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /nothing was sent/);
  assert.match(result.stdout, /DontDie — Phase 1 complete/);
  assert.match(result.stdout, /Security, Recovery Guardrails, and Executable Quality Baseline/);
  assert.match(result.stdout, /\*\*Success:\*\* true/);
  assert.match(result.stdout, /\*\*Blockers \/ deviations:\*\* None/);

  // The endpoint must not appear even in the dry-run output.
  assert.ok(!result.stdout.includes(FAKE_WEBHOOK));
  assert.ok(!result.stdout.includes(FAKE_WEBHOOK.split('/').pop()));
});
