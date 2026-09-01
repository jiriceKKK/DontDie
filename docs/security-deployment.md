# DontDie — security and deployment

This document describes the security boundary as it exists after Phase 1, what
is public by design, how to deploy the database migration safely, and what to do
when something leaks.

---

## 1. What is, and is not, a secret

| Value | Secret? | Where it may live |
| --- | --- | --- |
| Supabase **project URL** | No | `js/config.js`, published with the app |
| Supabase **anon key** | No | `js/config.js`, published with the app |
| Supabase **service-role key** | **Yes** | Nowhere in this repository. Server/CI secret store only |
| Owner **email / password** | **Yes** | The owner's password manager. Never in code, never in CI |
| Owner **auth UUID** | Sensitive | Supplied at migration time. Not committed |
| **Discord webhook URL** | **Yes** | `DONTDIE_DISCORD_WEBHOOK_URL` in the shell / secret manager only |
| Database **connection string** | **Yes** | Shell or secret manager. `.env` is git-ignored |

The anon key is a published identifier, not a credential: it identifies the
project and nothing more. **Authorization is Row Level Security**, keyed on
`auth.uid()`. Anyone can hold the anon key; without a valid owner session it
grants access to nothing.

### The device lock is not authentication

`js/deviceLock.js` implements an optional on-device passcode. It is a privacy
convenience — it stops a person holding the unlocked phone from reading the
journal. It:

- is set by the owner, per device, and can be skipped entirely;
- stores only a salted PBKDF2-SHA-256 verifier (210 000 iterations), never the
  secret;
- throttles failed attempts with an escalating cooldown;
- **never** gates a database request and never decides what the server returns.

The client PIN that shipped before Phase 1 (a SHA-256 hash plus the literal PIN
in a comment) has been removed. It was readable in downloaded source and could
be brute-forced offline in seconds, and it never protected Supabase at all.

---

## 2. The authorization boundary

```
browser (public URL + anon key)
  -> Supabase Auth session  (email + password, persisted, auto-refreshed)
     -> PostgREST assumes the `authenticated` role with auth.uid() = owner
        -> RLS policy: auth.uid() = user_id  (per table, per statement)
           -> only the owner's rows
```

Client-side, `js/db.js` additionally filters every read/update/delete on
`user_id` and stamps `user_id` on every insert. That is defence in depth and
makes the intent explicit; it is not the boundary. With no session, `js/db.js`
fails fast and **sends no request at all** — there is no anonymous fallback.

`anon` holds no table privileges after the migration. An unauthenticated caller
with the project URL and anon key reads nothing and writes nothing.

---

## 3. Deploying the migration

Files:

- `supabase/migrations/001_owner_auth_and_rls.sql` — the migration
- `supabase/verify/001_owner_auth_and_rls.sql` — the proof it worked
- `supabase/staging/*.sql` — **staging fixtures only**, never run in production

### 3.1 Prerequisites

1. **An owner account exists.** Supabase Dashboard → Authentication → Users →
   Add user (email + password). Copy its UUID.
2. **A second, disposable account exists** if you intend to run the behavioural
   half of the verification (sections B–F). Delete it afterwards.
3. **A database-level backup exists.** Dashboard → Database → Backups, or:

   ```sh
   pg_dump "$DATABASE_URL" --format=custom --file=dontdie-preflight-$(date +%F).dump
   ```

   Store it outside the repository. `.gitignore` excludes `supabase/backups/`,
   but the safest place is not the working tree at all. Record the timestamp and
   location in the phase completion record — never the credentials.

The app's own JSON backup is **not** sufficient: `buildBackup()` only exports the
84-day window loaded at startup (a known P0 defect, fixed in Phase 3).

### 3.2 Rehearse first

Never run an unrehearsed migration against personal data. With Docker:

```sh
docker run -d --name dontdie-staging-pg \
  -e POSTGRES_PASSWORD=stagingonly -e POSTGRES_DB=dontdie_staging \
  -p 55432:5432 postgres:17-alpine

# secret-scan:allow — a disposable local staging password, documented on purpose
DONTDIE_STAGING_DATABASE_URL=postgres://postgres:stagingonly@127.0.0.1:55432/dontdie_staging \
  npm run db:verify

docker rm -f dontdie-staging-pg
```

`npm run db:verify` recreates the pre-migration schema exactly as the old
`README.md` documented it (including the permissive `Allow all anon` policies),
runs the migration, and then runs the full verification. It refuses to run
against any URL that looks like a hosted project.

### 3.3 Apply to production

1. Confirm the backup from 3.1 exists and is restorable.
2. Open `supabase/migrations/001_owner_auth_and_rls.sql` and replace
   `OWNER_UUID_PLACEHOLDER` with the owner's UUID. Do not commit that edit.
3. Run the whole file in the Supabase SQL Editor, or:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/001_owner_auth_and_rls.sql
   ```

   It runs in a single transaction with post-condition checks, so a failure
   leaves the database exactly as it was.
4. Run `supabase/verify/001_owner_auth_and_rls.sql` with both placeholders
   filled in. Sections B–F roll themselves back and touch only rows they create
   (`habit_id` starting `verify_`, date `1999-01-01`). Any failure raises and
   means the deployment is not safe.
5. Sign in to the app as the owner and confirm data loads normally.
6. Delete the disposable second account.

### 3.4 Rolling back

There is no down-migration: reversing it would restore anonymous access to
personal data. If something is wrong, restore the backup from 3.1.

---

## 4. Browser hardening

### Content Security Policy

`index.html` ships a CSP meta tag because GitHub Pages cannot set response
headers. The policy is:

```
default-src 'self';
script-src 'self';
style-src 'self' https://fonts.googleapis.com 'unsafe-inline';
style-src-elem 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:;
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'
```

- `script-src 'self'` is achievable because the bootstrap moved to `js/boot.js`
  and the Supabase library is vendored (see `vendor/README.md`). There is no
  inline script in the page and no third-party script host.
- `style-src-attr 'unsafe-inline'` is required: the existing renderers build
  hundreds of inline `style="..."` attributes. Inline `<style>` elements and
  external stylesheets stay restricted. Removing this is design-system work
  (Phase 6), not a Phase 1 change.
- `connect-src` must list both `https:` and `wss:` for the project — Supabase
  Realtime uses a WebSocket. Verify with DevTools → Network after any change.

**Prefer real headers where the host supports them.** A meta tag cannot deliver
`frame-ancestors`, and `Referrer-Policy` is stronger as a header. On
Netlify/Cloudflare/nginx serve:

```
Content-Security-Policy: <the policy above>; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`scripts/dev-server.mjs` already sends the non-CSP headers locally.

### Output safety

`js/ui/dom.js` is the single place output encoding lives: `escapeHtml`,
`escapeAttr`, `safeColor`, `safeId`, `setText`. Any value that came from
Supabase, `localStorage`, or an imported payload must pass through one of them
before being interpolated into an HTML string. `safeColor` matters as much as
`escapeHtml`: a stored colour lands inside a `style` attribute.

There is deliberately no HTML sanitiser. The app renders no rich HTML from user
data; adding one would add weight without adding protection.

---

## 5. The phase notifier

`scripts/notify-phase.mjs` is Node-only tooling. It:

- reads `DONTDIE_DISCORD_WEBHOOK_URL` **only** from `process.env`;
- refuses non-HTTPS URLs, non-Discord hosts, and malformed webhook paths;
- refuses to send unless `--success true`;
- refuses a message body that itself contains a URL or a token;
- follows no redirects, times out in 10 s, and exits non-zero on any non-2xx;
- never prints the URL — not on success, not in an error, not in a stack trace.

Usage:

```sh
export DONTDIE_DISCORD_WEBHOOK_URL='…'      # shell / CI secret, never a commit
node scripts/notify-phase.mjs --phase 1 --name '…' --summary '…' \
  --checks '…' --success true --deviations None
```

Add `--dry-run` to print the exact message without contacting anything.

It must never be imported from `js/`, referenced in `index.html`, or cached by
`sw.js` (which explicitly refuses to cache `/scripts/`, `/supabase/`, `/tests/`
and `/docs/`). A unit test enforces all of this.

---

## 6. Rotation and incident response

### Rotate the Discord webhook

Delete the webhook in Discord (Server Settings → Integrations → Webhooks),
create a new one, and update the environment variable wherever it is set. No
repository change is needed, because the URL has never been in the repository.
Rotate it whenever it may have appeared in a chat log, a shell history, a CI
log, or a screenshot.

### Rotate the Supabase anon key

Dashboard → Settings → API → rotate, then update `CONFIG.SUPABASE_ANON_KEY` in
`js/config.js` and redeploy. This is housekeeping, not an emergency: the anon key
is public and RLS is the boundary.

### Suspected service-role key exposure

This is an emergency — the service-role key bypasses RLS.

1. Rotate it immediately in the dashboard.
2. Check Logs for requests you did not make.
3. Rotate the owner password.
4. If the key ever entered Git history, rewriting history is not enough; the key
   must be considered compromised and replaced.

### The pre-Phase-1 client PIN

The old PIN and its hash are removed from the working tree but remain in earlier
Git commits, which are already published. Treat that PIN as public. It never
protected cloud data — that was the exposure Phase 1 closed — but do not reuse
it as a device passcode. The policy in `js/deviceLock.js` rejects four-digit
secrets, so it cannot be reused by accident.

### Before every commit

```sh
npm run secretscan     # structural credential patterns in tracked files
npm run validate       # syntax, lint, unit (incl. the secret scan), E2E
```
