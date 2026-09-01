#!/usr/bin/env node
// ============================================================
// Phase completion notifier — SERVER-SIDE ONLY.
//
// Reads the Discord webhook exclusively from process.env. The URL is never
// printed, logged, echoed into an error message, written to a file, or
// exposed to anything under js/. This script must never be imported by
// browser code or cached by sw.js.
//
// Usage:
//   DONTDIE_DISCORD_WEBHOOK_URL=... node scripts/notify-phase.mjs \
//     --phase 1 \
//     --name "Security, Recovery Guardrails, and Executable Quality Baseline" \
//     --summary "..." \
//     --checks "npm run validate; ..." \
//     --success true \
//     --deviations "None"
//
//   Add --dry-run to print the message without sending it.
//
// Exit codes: 0 delivered · 1 usage/config error · 2 delivery failure.
// ============================================================

const ENV_VAR = 'DONTDIE_DISCORD_WEBHOOK_URL';
const TIMEOUT_MS = 10_000;
const ALLOWED_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

function fail(message, code = 1) {
  // `message` is always a literal built here — never interpolate the URL.
  console.error(`notify-phase: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) out[token.slice(2, eq)] = token.slice(eq + 1);
    else out[token.slice(2)] = argv[++i] ?? '';
  }
  return out;
}

function requireFlag(args, name) {
  const value = (args[name] ?? '').toString().trim();
  if (!value) fail(`missing required --${name}`);
  return value;
}

// ---- webhook endpoint (environment only) ----------------------------------
const raw = (process.env[ENV_VAR] ?? '').trim();
if (!raw) fail(`${ENV_VAR} is not set. Export it in your shell or CI secret store; never put it in a tracked file.`);

let endpoint;
try {
  endpoint = new URL(raw);
} catch {
  fail(`${ENV_VAR} is not a valid URL`);
}
if (endpoint.protocol !== 'https:') fail(`${ENV_VAR} must use https`);
if (!ALLOWED_HOSTS.has(endpoint.hostname)) fail(`${ENV_VAR} host is not an allowed Discord host`);
if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(endpoint.pathname)) {
  fail(`${ENV_VAR} does not look like a Discord webhook path`);
}

// ---- arguments -------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));

const success = String(args.success ?? '').toLowerCase();
if (success !== 'true') {
  fail('refusing to notify: --success must be exactly "true". A blocked or failed phase must not send a completion notification.');
}

const phase = requireFlag(args, 'phase');
if (!/^\d{1,2}$/.test(phase)) fail('--phase must be a small integer');

const payloadFields = {
  project: 'DontDie',
  phase: Number(phase),
  name: requireFlag(args, 'name'),
  summary: requireFlag(args, 'summary'),
  checks: requireFlag(args, 'checks'),
  success: true,
  deviations: (args.deviations ?? '').toString().trim() || 'None',
};

// Guard against accidentally piping a secret into the message body.
const bodyText = Object.values(payloadFields).join('\n');
if (/https?:\/\/(?:\S*discord\S*|\S*supabase\S*)/i.test(bodyText) || /eyJ[A-Za-z0-9_-]{10,}\./.test(bodyText)) {
  fail('refusing to notify: message content looks like it contains a URL/endpoint or token');
}

const lines = [
  `**${payloadFields.project} — Phase ${payloadFields.phase} complete**`,
  `**Phase:** ${payloadFields.name}`,
  `**Summary:** ${payloadFields.summary}`,
  `**Checks:** ${payloadFields.checks}`,
  `**Success:** true`,
  `**Blockers / deviations:** ${payloadFields.deviations}`,
];
const content = lines.join('\n').slice(0, 1900);

// `--dry-run` builds and shows the exact message without contacting anything.
// Useful for checking that the body carries no URL or personal data before a
// real phase-completion send. It still prints nothing about the endpoint.
if (process.argv.includes('--dry-run')) {
  console.log('notify-phase: dry run — nothing was sent. Message body:');
  console.log(content);
  process.exit(0);
}

// ---- deliver ---------------------------------------------------------------
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    redirect: 'error', // a redirected webhook is treated as untrusted
    signal: controller.signal,
  });
} catch (err) {
  clearTimeout(timer);
  const reason = err?.name === 'AbortError' ? 'request timed out' : 'network or redirect failure';
  fail(`delivery failed (${reason})`, 2);
} finally {
  clearTimeout(timer);
}

if (!response.ok) {
  fail(`delivery failed with HTTP ${response.status}`, 2);
}

console.log(`notify-phase: phase ${payloadFields.phase} notification delivered (HTTP ${response.status})`);
