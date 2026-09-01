#!/usr/bin/env node
// ============================================================
// Static no-cache dev server (Node equivalent of serve.py) so the Playwright
// suite has one dependency-free way to serve the buildless app.
//   node scripts/dev-server.mjs [port]
// ============================================================
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = join(ROOT, normalize(rel).replace(/^[/\\]+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    // Mirrors the response headers recommended for production static hosting
    // (see docs/security-deployment.md). The meta CSP in index.html is the
    // fallback for hosts that cannot set headers, e.g. GitHub Pages.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  createReadStream(full).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DontDie dev server (no-cache) on http://127.0.0.1:${PORT}`);
});
