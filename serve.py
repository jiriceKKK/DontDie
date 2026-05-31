#!/usr/bin/env python3
"""
Local dev server for DontDie that DISABLES caching.

Why: the app uses native ES modules (js/*.js). Plain `python -m http.server`
lets the browser cache those module files, so after you edit a module the
browser keeps serving the old one — the new index.html then imports symbols the
stale module doesn't have, and the app boots to a blank screen. This server
sends no-cache headers so every refresh loads the current files.

Usage:
    python serve.py            # serves this folder on http://127.0.0.1:8000
    python serve.py 8080       # custom port
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


# Make sure .js / .mjs are served with a JS MIME so modules load.
NoCacheHandler.extensions_map.update({
    ".js": "text/javascript",
    ".mjs": "text/javascript",
})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"DontDie dev server (no-cache) on http://127.0.0.1:{port}   (Ctrl+C to stop)")
    HTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
