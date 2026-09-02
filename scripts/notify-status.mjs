#!/usr/bin/env node
// ============================================================
// WORK-STATUS NOTIFIER — SERVER-SIDE ONLY.
//
// The counterpart to scripts/notify-phase.mjs. That script may only ever say
// "Phase N complete", and only with --success true. THIS one is for the
// truthful non-completion states: working, paused, blocked.
//
// It shares the same safety rules: the webhook comes from the environment and
// nowhere else, it is never printed, only HTTPS Discord hosts are accepted,
// redirects are refused, requests time out, and a message body that looks like
// it carries a URL or a token is rejected before anything is sent.
//
// It must never be imported from js/, referenced by index.html, or cached by
// sw.js. tests/unit/notifyStatus.test.mjs and scripts/secret-scan.mjs both
// enforce that.
//
// Usage:
//   DONTDIE_DISCORD_WEBHOOK_URL=... node scripts/notify-status.mjs \
//     --state blocked \
//     --task "Phase 2 — local-first persistence" \
//     --work "..." \
//     --checks "..." \
//     --next "..."
//
//   Add --dry-run to print the message without sending it.
//
// Exit codes: 0 delivered · 1 usage/config error · 2 delivery failure.
// ============================================================

const ENV_VAR = 'DONTDIE_DISCORD_WEBHOOK_URL';
const TIMEOUT_MS = 10_000;
const ALLOWED_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

/** The only states this script may report. None of them means "complete". */
export const STATES = {
  working: { label: 'Work in progress', emoji: '⏳' },
  paused: { label: 'Paused — waiting on the owner', emoji: '⏸' },
  blocked: { label: 'Blocked', emoji: '⛔' },
};

/** Wording that would misrepresent an unfinished phase as a finished one. */
const COMPLETION_WORDING = /\b(phase\s*\d*\s*complete|phase\s*complete|completed\s+successfully|all\s+done|success:\s*true)\b/i;

function fail(message, code = 1) {
  // `message` is always a literal built here — never interpolate the URL.
  console.error(`notify-status: ${message}`);
  process.exit(code);
}

export function parseArgs(argv) {
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

/**
 * Reject anything that looks like an endpoint or a credential in the body.
 * Exported so the unit tests exercise exactly the shipped rule.
 */
export function looksLikeSecret(text) {
  if (/https?:\/\//i.test(text)) return true;                 // any URL at all
  if (/\bwss?:\/\//i.test(text)) return true;
  if (/eyJ[A-Za-z0-9_-]{10,}\./.test(text)) return true;      // a JWT
  if (/\b(sb|sbp|service_role)_[A-Za-z0-9_-]{16,}/.test(text)) return true;
  if (/postgres(ql)?:\/\//i.test(text)) return true;
  if (/discord(app)?\.com/i.test(text)) return true;
  return false;
}

/** Build the exact message body. Pure, so tests can assert on it directly. */
export function buildMessage(fields) {
  const state = STATES[fields.state];
  return [
    `${state.emoji} **DontDie — ${state.label}**`,
    `**Task:** ${fields.task}`,
    `**Work performed:** ${fields.work}`,
    `**Checks:** ${fields.checks}`,
    `**Current state:** ${fields.current || state.label}`,
    `**Next required action:** ${fields.next}`,
  ].join('\n').slice(0, 1900);
}

/**
 * Validate arguments into a message, or return an error string.
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
export function prepare(args) {
  const state = String(args.state || '').toLowerCase().trim();
  if (!Object.prototype.hasOwnProperty.call(STATES, state)) {
    return { ok: false, error: 'missing or unknown --state (expected working, paused or blocked)' };
  }

  const required = ['task', 'work', 'checks', 'next'];
  const fields = { state };
  for (const name of required) {
    const value = String(args[name] ?? '').trim();
    if (!value) return { ok: false, error: `missing required --${name}` };
    fields[name] = value;
  }
  fields.current = String(args.current ?? '').trim();

  const body = required.map(name => fields[name]).concat(fields.current).join('\n');
  if (looksLikeSecret(body)) {
    return { ok: false, error: 'refusing to notify: message content looks like it contains a URL, endpoint or token' };
  }
  if (COMPLETION_WORDING.test(body)) {
    return { ok: false, error: 'refusing to notify: a status message must not use phase-completion wording' };
  }

  return { ok: true, content: buildMessage(fields) };
}

/** Validate the endpoint without ever revealing it. */
export function resolveEndpoint(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: `${ENV_VAR} is not set. Export it in your shell or CI secret store; never put it in a tracked file.` };
  let endpoint;
  try { endpoint = new URL(value); } catch { return { ok: false, error: `${ENV_VAR} is not a valid URL` }; }
  if (endpoint.protocol !== 'https:') return { ok: false, error: `${ENV_VAR} must use https` };
  if (!ALLOWED_HOSTS.has(endpoint.hostname)) return { ok: false, error: `${ENV_VAR} host is not an allowed Discord host` };
  if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(endpoint.pathname)) {
    return { ok: false, error: `${ENV_VAR} does not look like a Discord webhook path` };
  }
  return { ok: true, endpoint };
}

// Importing this file for tests must not send anything.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('notify-status.mjs');
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));

  const prepared = prepare(args);
  if (!prepared.ok) fail(prepared.error);

  if (process.argv.includes('--dry-run')) {
    console.log('notify-status: dry run — nothing was sent. Message body:');
    console.log(prepared.content);
    process.exit(0);
  }

  const resolved = resolveEndpoint(process.env[ENV_VAR]);
  if (!resolved.ok) fail(resolved.error);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(resolved.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: prepared.content, allowed_mentions: { parse: [] } }),
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

  if (!response.ok) fail(`delivery failed with HTTP ${response.status}`, 2);

  console.log(`notify-status: ${args.state} status delivered (HTTP ${response.status})`);
}
