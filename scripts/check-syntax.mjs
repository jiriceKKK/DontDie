#!/usr/bin/env node
// ============================================================
// Syntax gate — runs `node --check` over every first-party JavaScript file.
// The app is buildless, so a parse error would otherwise only surface as a
// blank screen in the browser.
// Usage: node scripts/check-syntax.mjs
// ============================================================
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);
const ROOTS = ['js', 'scripts', 'tests'];

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      yield full;
    }
  }
}

const files = [];
for (const rootDir of ROOTS) {
  for await (const file of walk(join(ROOT, rootDir))) files.push(file);
}

const failures = [];
const CONCURRENCY = 8;
let cursor = 0;

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    const rel = relative(ROOT, file).split(sep).join('/');
    try {
      await run(process.execPath, ['--check', file]);
    } catch (err) {
      failures.push(`${rel}: ${String(err.stderr || err.message).split('\n').slice(0, 3).join(' ')}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (failures.length) {
  console.error(`check-syntax: ${failures.length} file(s) failed to parse`);
  for (const f of failures.sort()) console.error('  x ' + f);
  process.exit(1);
}
console.log(`check-syntax: ${files.length} file(s) parsed cleanly with node --check`);
