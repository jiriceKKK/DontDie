# DontDie Improvement Plan

This plan is based on a source-level audit of the complete repository and a browser smoke audit at 390 × 844 and 1280 × 900. It is an execution specification, not a redesign brief. Preserve DontDie's identity as a dark, personal operating system and execute the phases in order.

Priority labels used throughout:

- **P0** — security exposure, data-loss risk, broken backup, or severe functional defect.
- **P1** — important functionality, architecture, information architecture, or accessibility issue.
- **P2** — consistency, performance, perceived-quality, and maintainability improvement.
- **P3** — optional enhancement that must not delay higher-priority work.

## 0. Current-State Audit

### Audit scope and confidence

The audit covered all 70 JavaScript files, `index.html`, the 3,962-line `style.css`, `sw.js`, `serve.py`, `README.md`, and the documented Supabase schema/policies. Every mode and representative secondary tabs were rendered with a deterministic stubbed Supabase client in mobile and desktop Chromium. All JavaScript files passed `node --check`. The browser smoke test exercised the real navigation/rendering code but deliberately did not read or mutate the live Supabase project. The repository has no Git metadata in this workspace, no package manifest, no automated test suite, no linter, no typecheck, and no production build step, so the live database policies and real-data edge cases could not be verified from this audit alone.

No `TODO`, `FIXME`, `HACK`, or `XXX` markers exist. Absence of markers does not mean features are complete; several behaviors below are dormant or only partially implemented.

### Stack and runtime

- Buildless static web application designed for GitHub Pages or a similar static host.
- HTML entry point: `index.html`.
- Styling: one global `style.css` file, approximately 149 KB, with CSS custom properties and mode-specific themes.
- Runtime: native browser ES modules under `js/`; approximately 603 KB of JavaScript source.
- Backend/persistence: Supabase browser client loaded from jsDelivr and direct table access from `js/db.js`.
- Local persistence: `localStorage` for most JSON document stores, `sessionStorage` for the current PIN gate, and an in-memory retry queue for habit writes.
- Offline behavior: a small service worker in `sw.js` uses network-first caching for same-origin GET requests. It has no explicit app-shell precache, migration/version tooling, or robust offline update flow.
- Fonts: Inter and DM Mono are loaded from Google Fonts. They failed in the restricted browser audit, leaving the fallback stack.
- Charts: hand-built SVG/HTML in module renderers; there is no charting library.
- AI integration: prompt generation, clipboard workflows, structured paste/import, and Markdown export. There is no direct AI API call.

There is currently no bundler, framework, component compiler, or package manager contract. Do not introduce a framework rewrite. Add development tooling only where it directly protects behavior.

### Application architecture and boot flow

`js/main.js` validates `js/config.js`, shows the local PIN gate from `js/auth.js`, then awaits nine Supabase/local-store loads before constructing navigation. Shared application data lives in the mutable singleton exported by `js/state.js`; renderers read it and action handlers mutate it directly. `js/sync.js` retries failed habit writes from memory every 30 seconds.

`js/modes/registry.js` eagerly imports all modes and tab renderers. `js/modes/controller.js` creates and renders every panel in the selected mode. `js/navigation.js` implements a mobile `100vw` sliding track and a desktop active-panel switch. Mode changes destroy and recreate panels; the last selected tab survives only in memory. There are no URL routes, hash routes, browser-history semantics, deep links, page-title updates, or explicit scroll restoration.

The startup architecture has three consequences:

1. A slow or unavailable cloud read delays meaningful rendering even when usable local documents exist.
2. Every feature module is parsed up front and every tab in a mode is rendered even when the user only opens one tab.
3. UI components and business operations are tightly coupled, making important logic difficult to test without a browser.

### Current feature map

| User-facing area | Actual files | Current behavior and notable relationships |
| --- | --- | --- |
| Home | `js/home/today.js`, `quicklog.js`, `review.js`, `modules.js`, `data.js` | Today command center, stimulation quick log, weekly review, and module launcher. It aggregates habits, Mind tasks/check-ins, stimulation, and School sessions. The quick Log reuses stimulation behavior. Review contains some period-filtering errors described below. |
| Physical / Habits | `js/tabs/today.js`, `week.js`, `stats.js`, `settings.js`, `js/habits.js`, `js/habitConfig.js` | Daily scheduled habits, current-week grid, streaks/heatmap/SVG stats, custom habit management, habit metadata, exports, and data clearing. Habit completion can create/remove a linked stimulation entry through `js/habitStimLink.js`. Global export/data controls are incorrectly buried here. |
| Physical / Training split | `js/tabs/split.js`, `js/split/store.js`, `defaultSplit.js` | Editable training program with Full Week, Gym Only, and Mobility views. Stored as a whole JSON document locally and in Supabase. |
| Mind / Check-in | `js/mental/tabs/checkin.js`, `js/mental/store.js` | Multi-factor self-check-in with optional details. The mobile form is long and control-dense but logically grouped. |
| Mind / Tasks | `js/mental/tabs/tasks.js`, `js/mental/store.js` | Today/tomorrow task creation and completion. Uses the shared Mind document store. |
| Mind / Texts and reading | `js/mental/tabs/texts.js`, `js/mental/texts/*` | Creates an AI prompt, imports a `DONTDIE_TEXTS_IMPORT_V1` payload, locks/randomizes a reading queue, offers a full-screen reader, word/sentence highlights, reflection, completion, and feedback export. Content is generated outside the app and pasted back. |
| Mind / Books | `js/mental/texts/books.js`, `booksUI.js` | Physical-book tracking, page/word estimates, progress events, corrections, goals/milestones, and archive behavior. It shares the Texts store and tab but is a distinct workflow. |
| Mind / Journal and Stats | `js/mental/tabs/journal.js`, `stats.js`, `journalTemplates.js` | Template-based journal entries and derived Mind summaries. Entries can be added/viewed/deleted but not edited. |
| Stimulation | `js/stimulation/store.js`, `tabs/dashboard.js`, `log.js`, `activities.js`, `stats.js`, `settings.js` | Configurable activity catalog; productive/cheap stimulation curves, targets, baselines, context, block-based day logging, history, and stats. Habit completion can write into this module. |
| Screen Time import | `js/stimulation/screenTime.js`, `tabs/importScreen.js` | Parses simple or advanced screen-time snapshots, maintains app mappings/classifications, reconciles imported totals with manual entries, and writes stimulation activities/entries. Current commits trigger many full-document saves. |
| School | `js/school/store.js`, `planner.js`, `prompts.js`, `sessionTypes.js`, `util.js`, `tabs/*` | Subjects, tests, generated study sessions, Today/Plan views, completion/results, settings, Claude prompt copy, and structured result paste. The planner is rule-based; several stored settings do not currently affect it. |
| Export and AI reflection | `js/export/collect.js`, `backup.js`, `aiReflection.js`, `download.js` | Full Markdown AI context, compact Markdown, and JSON backup. Full export intentionally includes sensitive content after a warning. “All-time” habit data is not actually all-time because it is built from the 84-day startup window. No restore workflow exists. |

The modules should retain these distinctions. Coherence should come from shell/navigation, shared primitives, common data contracts, contextual links, and truthful aggregate views—not from merging unrelated personal data into one model.

### Navigation and information architecture

- Primary mode switcher: Home, Physical, Mind (internally still named `mental`), Stimulation, and School.
- Each mode has its own bottom/desktop tab navigation. Home has Today, Log, Review, Modules. Physical has Today, Week, Stats, Split, Settings. Mind has Check-in, Tasks, Texts, Journal, Stats. Stimulation has Dashboard, Log, Activities, Stats, Settings. School has Today, Plan, Tests, Results, Settings.
- Home is the appropriate cross-module command center. The specialist modes should remain separate.
- On mobile, a floating bottom-left mode button duplicates the header mode switcher and overlaps content in several screens. The floating bottom tab bar also requires reliable safe-area/content padding.
- “Mental” appears in some user-facing copy while the main label is “Mind.”
- Export, backup, clear-data, and global data controls are presented as Physical settings even though they cover the whole product.
- Useful flows are buried or ambiguous: no deep links, no browser Back behavior between modes/tabs, no global Data & Privacy destination, and no persistent sync/conflict status.
- Do not reorder or remove Home/primary navigation based on intuition. Instrument usage first. Later personalization should add approved shortcuts without moving core navigation.

### Persistence, database, authentication, and security

`js/config.js` currently contains a Supabase URL/anon key plus a client-visible PIN hash and a comment that reveals the PIN. A Supabase anon key is expected to be public in a browser app; a client PIN is not an authorization boundary. `js/auth.js` performs an offline SHA-256 comparison and stores an unlocked flag in `sessionStorage`, so the four-digit PIN can be brute-forced from downloaded source.

More seriously, the schema instructions in `README.md` enable RLS and then define `Allow all anon` policies with unconditional `USING (true)` and `WITH CHECK (true)` for every table. If the deployed project matches this documentation, anyone with the public project URL and anon key can read or mutate all personal data, including Mind content. The live policy state must be verified immediately; the repository alone cannot prove what is deployed. This is the highest-priority P0 issue.

Persistence is split across two patterns:

- Habit logs and custom habits use row-level Supabase operations. Only 84 days of habit logs are loaded. Failed writes enter a memory-only queue that is lost on reload.
- Training, Mind, Texts/Books, Stimulation, School, and habit configuration are whole-document JSON stores mirrored to `localStorage` and singleton Supabase rows. A newest-`updatedAt` comparison chooses a copy, but writes are not serialized, multi-device conflicts are not surfaced, quota errors are mostly swallowed, and out-of-order responses can overwrite newer state.

The documented relational tables are `habit_logs` (unique on date + habit ID) and `custom_habits`. The documented JSON tables are `split_config`, `mh_store`, `stimulation_store`, `school_store`, `habit_config`, and optional `mind_texts_store`; each JSON table currently has integer primary key `1`, a `CHECK (id = 1)` singleton constraint, `data jsonb`, and `updated_at`. That global singleton shape must be changed deliberately when ownership is added—it cannot support one row per authenticated owner while `id` alone remains the primary key. *(Verified against the live project during Phase 1 closure: seven DontDie tables are installed — `habit_logs`, `custom_habits`, `split_config`, `mh_store`, `stimulation_store`, `school_store`, and the optional `mind_texts_store`, which **is** present. `habit_config` is **not** installed in production; migration 001 skipped it correctly. Later phases must treat `habit_config` as absent rather than assumed.)*

Cross-module habit/stimulation updates are not durable as a single user action. On network failure the visual habit state may revert while a later retry only updates the habit table, leaving stimulation linkage inconsistent. Reset and delete operations can also be undone by a later cloud hydrate if their remote write failed.

There are no versioned database migration files; the current schema exists only in `README.md`.

### Styling and visual system

The existing visual direction is already strong and should be refined, not replaced: dark obsidian surfaces, controlled mode accents, rounded panels, subtle shadows, a translucent persistent header/bottom dock, and elevated overlays. Cards are mostly opaque, which is correct for dense data. CSS custom properties already cover primary colors, several surfaces, radii, shadows, and motion durations.

Problems are consistency and maintainability rather than lack of identity:

- `style.css` is a large global file with module rules, primitives, utilities, and responsive overrides interleaved.
- Inline styles, hard-coded chart greens, local color values, inconsistent compact control sizes, and repeated component shapes bypass tokens.
- Small muted text uses a low-contrast gray in several places.
- Global hidden scrollbars and `user-select: none` reduce discoverability and text usability.
- Glass is generally selective today. The upgrade must keep it limited to navigation chrome, high-level hero/summary surfaces, sheets/modals, and overlays. Dense forms, logs, tables, and charts should remain opaque dark surfaces.
- Remote fonts are a single network dependency and currently have no self-hosted fallback asset.

### Motion and animation

The app is not motion-free. Existing CSS/JS covers mobile tab sliding, mode fade, modal/sheet entrance and exit, toasts, checkbox springs, confetti, collapses, highlight feedback, and reader crossfades. It also defines fast/normal/slow duration tokens and a blanket reduced-motion rule.

The issues are that durations are duplicated in JavaScript/CSS, state transitions are inconsistent, some celebratory work still needs to be suppressed under reduced motion, and async/save/loading state has little continuity. The goal is to formalize and reuse the good patterns, not animate every card.

### Telemetry and export status

There is no product-usage telemetry. No route opens, feature actions, active duration, sessions, or navigation transitions are recorded. Therefore no current evidence supports adaptive navigation or removing underused features.

Exports collect rich personal data but have correctness and privacy limitations:

- `buildBackup()` is labeled all-time but consumes only `state.logsByDate`, which is limited to the 84-day startup query.
- Some School session/result summaries and Home missed-session review use all-time state while presenting a selected period.
- Mind Texts summaries are all-time even in period-bounded AI exports.
- Full AI export can include journal/check-in content. That is sometimes useful, but usage analytics must never copy that content, and privacy-safe exports should be the default.
- Exports are synchronous and have no explicit busy/failure state.
- Backup has no validated restore/import workflow.

### Testing and delivery status

- No `package.json`, dependency lock file, automated tests, linter, typecheck, or CI workflow exists.
- There is no build command; the application is served as authored.
- `serve.py` provides a local static server with cross-origin isolation headers.
- Current baseline: all JavaScript passes syntax checking; representative pages render without horizontal overflow after transitions settle; the only browser-console failure in the controlled smoke run was blocked Google Fonts networking.
- Browser validation currently requires ad hoc scripts and a stub Supabase object. This is not repeatable enough for a risky persistence/security refactor.

### Functional, data-quality, accessibility, and performance findings

| Priority | Finding | Evidence / consequence |
| --- | --- | --- |
| P0 | Cloud authorization may be open to anonymous users. | `README.md` documents unconditional anon policies; client PIN does not protect Supabase. Live policy must be checked and replaced with authenticated owner-scoped policies. |
| P0 | Client PIN is exposed and is not authentication. | Hash and literal clue are shipped in `js/config.js`; browser code can be read and brute-forced. |
| P0 | “All-time” backup can silently omit older habit history. | Startup loads 84 days, while `js/export/backup.js` exports the in-memory subset. This creates false recovery confidence. |
| P1 | Offline habit writes and linked stimulation updates can diverge or disappear. | Retry queue is memory-only; linked update is not part of the same durable operation. |
| P1 | Whole-document saves can arrive out of order and overwrite newer local state. | Store modules issue uncoordinated async writes and use last-write-wins without visible conflict recovery. |
| P1 | Stimulation day grid silently truncates valid settings. | `dayBlocks()` caps at 24 blocks although settings permit 30-minute blocks across a 24-hour day (48 blocks). |
| P1 | Historical stimulation entries change meaning when schedule settings change. | Entries store a block index, not the time/duration snapshot used when logged. Deleted activities also erase historical scoring context. |
| P1 | School result inference can select the wrong same-subject test. | `inferTestId` contains a title comparison that is always true. |
| P1 | School settings imply behavior they do not provide. | Default session duration, daily maximum, test importance, subject default difficulty, and parsed recommendations are unused or only stored. |
| P1 | Weekly/period summaries mix scoped and all-time data. | Home missed sessions, School counts, and Texts metrics can contradict the selected report period. |
| P1 | Modal/overlay accessibility is incomplete. | `js/ui/modal.js` lacks dialog semantics, focus trap, Escape behavior, focus restoration, and background inertness; toasts lack live-region behavior. |
| P1 | Several interactive surfaces are pointer-only. | Habit cards, journal/activity rows, reader highlights, and chart affordances use clickable non-semantic elements or lack equivalent labels. |
| P1 | Browser zoom is disabled. | `index.html` uses `maximum-scale=1,user-scalable=no`. |
| P1 | Imported AI reading payloads can exceed practical storage. | Parser/import path lacks hard count/size limits; storage exceptions can be swallowed after UI claims success. |
| P1 | Delete semantics can orphan or destroy related data. | Custom habit deletion can leave metadata/log remnants; test deletion leaves result references; activity deletion changes historical meaning. Confirmation/undo behavior is inconsistent. |
| P1 | Training Split day accordions do not animate on the first tap. | User-confirmed on the deployed mobile UI: a day often appears to require a double tap before the open animation is visible. `js/tabs/split.js` currently toggles `.open` before `animateCollapse()` measures the starting height, so the opening path can measure the already-open layout as both start and end. Reproduce and trace before changing it; one tap must always open with visible feedback. |
| P1 | Horizontal tab swiping is visibly laggy on mobile. | The current gesture path installs a document-wide non-passive `touchmove`, updates transforms for every event, synchronously renders at gesture completion, and keeps all mode panels populated. Capture a mobile performance trace and remove gesture-frame layout/render work rather than merely shortening the transition. |
| P2 | Startup and navigation do unnecessary work. | Nine reads block initial construction; registry eagerly imports all modes; every tab in a selected mode is rendered. |
| P2 | Reader progress causes frequent whole-library local writes. | Scroll/progress persistence rewrites the complete Texts library on a short timer. |
| P2 | Screen Time import causes repeated full-document cloud writes. | App mapping, activity creation, and each entry mutation save independently before a final save. |
| P2 | Navigation is not addressable or recoverable. | No routes, history, deep links, titles, or consistent scroll restoration. |
| P2 | Mobile mode controls are redundant and can overlap content. | The header mode-switcher pill duplicates the translucent lower `#mode-fab`. The owner explicitly prefers the lower control: remove the header switcher, retain and make the lower control accessible, and guarantee it does not overlap content or the bottom tab dock. |
| P2 | Visual primitives and tokens are inconsistently applied. | Large monolithic CSS, magic colors, inline style values, and small controls increase drift. |
| P2 | Status states are incomplete. | No common skeleton/local-hydrate pattern, durable sync state, conflict state, or duplicate-submit prevention. |
| P2 | Several files combine too many responsibilities. | `style.css`, `js/stimulation/store.js`, `js/tabs/split.js`, `js/school/store.js`, `js/stimulation/screenTime.js`, `js/mental/texts/booksUI.js`, and `js/export/aiReflection.js` are the main testability/maintenance hotspots. Split them only along behavior boundaries introduced below. |
| P3 | Adaptive navigation may eventually be useful. | It has no evidence base today. Defer it; later offer pinned/recent/suggested shortcuts with user approval and stable core navigation. |

Potential dead or dormant symbols (`TAB_ORDER`, `state.mentalStatsSection`, `dbExportAll`, `deleteCustomMeta`, an imported but unused goal editor, and several legacy stimulation helpers) must be confirmed by lint/static reference analysis before removal. Do not delete them based only on this audit.

### Target architecture (incremental, not a rewrite)

The completed system should retain native ES modules and static hosting while establishing these boundaries:

```text
UI routes/renderers
  -> module actions/services
     -> local-first repositories (IndexedDB)
        -> durable outbox/conflict recovery
           -> authenticated Supabase adapters

Navigation + module actions
  -> privacy-filtered local telemetry (IndexedDB)
     -> aggregate usage summaries
        -> privacy-controlled backup / AI export
```

The UI must render the last valid local state immediately, show sync state without blocking interaction, and reconcile with Supabase in the background. Telemetry is a separate local-only store and never receives user-authored content.

## Implementation sequence

All phases are sequential. Later phases rely on the safety, repository, test, telemetry, and navigation contracts established earlier. Do not begin broad visual extraction while persistence is unstable, and do not implement adaptive navigation in this plan.

### Phase 1 — Security, Recovery Guardrails, and Executable Quality Baseline

#### Objective

Close the known authorization exposure, replace the client PIN as the cloud-security boundary, preserve recoverability before schema changes, and create repeatable validation/notification tooling.

#### Why this phase exists

This is P0 work. Visual or architectural changes would compound risk while the documented database policies permit anonymous access and the backup cannot yet be trusted. A repeatable test harness is also required before changing storage and routing.

#### Files / systems involved

- Existing: `js/config.js`, `js/auth.js`, `js/db.js`, `js/main.js`, `index.html`, `README.md`, `serve.py`, `sw.js`.
- Proposed: `package.json`, `package-lock.json`, `eslint.config.js`, `jsconfig.json`, `scripts/check-syntax.mjs`, `scripts/notify-phase.mjs`, `tests/unit/`, `tests/e2e/`, `tests/e2e/fixtures/fakeSupabase.js`, `.gitignore`, `.env.example`.
- Proposed: `supabase/migrations/001_owner_auth_and_rls.sql`, `supabase/verify/001_owner_auth_and_rls.sql`, `docs/security-deployment.md`.
- External system: the deployed Supabase project and its Auth configuration.

#### Required changes

1. **[P0] Create a verified recovery snapshot before database mutation.** Use a Supabase dashboard/CLI database backup or SQL export, not the app's current JSON backup. Record the backup timestamp and restore location in the phase completion record without putting credentials or personal data in the repository.
2. **[P0] Inspect the live RLS/policy state.** Compare it with the `Allow all anon` SQL in `README.md`. If Claude cannot access the Supabase administration surface, it must prepare the exact migration and verification SQL, stop before claiming this phase complete, and ask the owner to apply/verify it. Do not infer that documentation equals live state.
3. **[P0] Establish real Supabase Auth.** Use a single owner account with Supabase email/password authentication. Keep Supabase's persisted session so the app does not require a full login on every page load. Do not embed owner credentials, a service-role key, or a password in any browser file.
4. **[P0] Write `001_owner_auth_and_rls.sql`.** Add a non-null `user_id uuid` owner column to `habit_logs`, `custom_habits`, `split_config`, `mh_store`, `stimulation_store`, `school_store`, `habit_config`, and—when installed—`mind_texts_store`; backfill existing rows to an explicitly supplied owner UUID; add appropriate foreign-key/index support; change habit-log uniqueness to `(user_id, date, habit_id)`; and replace each JSON table's global `id = 1` primary-key/singleton constraint with a per-owner key such as `(user_id, id)` while retaining `id = 1` within each owner. Enable RLS; drop unconditional anon policies; grant `SELECT/INSERT/UPDATE/DELETE` only when `auth.uid() = user_id`; and revoke anonymous write/read access. Handle the optional Texts table explicitly rather than failing halfway if it is absent. Wrap migration steps transactionally where Supabase permits. Use an obvious required placeholder or `psql` variable for the owner UUID—never guess it.
5. **[P0] Add verification SQL.** Verify: unauthenticated access is denied; the owner can read/write owned rows; a second test user cannot read or mutate owner rows; inserts cannot spoof another `user_id`; singleton document rows are scoped per owner rather than globally fixed by `id = 1` alone.
6. **[P0] Replace the current PIN flow.** `js/auth.js` must first establish/restore a Supabase Auth session. Remove the PIN hash and any PIN clue from `js/config.js`. If the quick local privacy lock is retained, label it as a device UI lock, require setup by the owner, store only a salted PBKDF2-derived verifier locally, allow a passphrase or at least six digits, throttle attempts, and never use it to authorize database requests. “Sign out” must clear the Supabase session and sensitive in-memory state.
7. **[P0] Scope all database operations.** Update `js/db.js` so inserts carry `user_id = session.user.id` and reads/updates/deletes rely on both explicit owner filtering and RLS. Centralize auth-required errors. Never fall back to anonymous writes.
8. **[P1] Remove unsafe inline boot code.** Move the inline bootstrap and service-worker registration from `index.html` to external same-origin modules. Pin the Supabase browser library to an exact version with integrity metadata or vendor the exact browser artifact if its license and update path are documented. Add a restrictive CSP suitable for static hosting (`default-src 'self'`, narrow script/style/font/image/connect sources), Referrer Policy, and a documented note that HTTP response headers are preferable where hosting supports them.
9. **[P1] Introduce central output safety.** Add a small `js/ui/dom.js` module with `escapeHtml`, allowed-color normalization, and safe identifier helpers. Replace immediately vulnerable interpolation in `js/tabs/today.js` and any other storage-backed HTML found by an `innerHTML` audit. Continue to use `textContent` for imported/journal/AI text. Do not add a large sanitizer unless real rich HTML is a requirement (it is not currently).
10. **[P1] Add a development quality contract.** Keep the application buildless. Add ESLint, the Node built-in test runner, and Playwright as development dependencies. Add scripts for syntax checking all source files, lint, unit tests, E2E tests, and an aggregate `npm run validate`. Create deterministic fake-Supabase E2E fixtures that never contact production. Add baseline tests for authentication gating, mode/tab rendering, and output escaping.
11. **[P1] Add the server-only webhook notifier.** `scripts/notify-phase.mjs` must read `DONTDIE_DISCORD_WEBHOOK_URL` exclusively from `process.env`, accept phase/name/summary/checks/success/deviations arguments, require `success=true`, post JSON with native Node `fetch`, use a short timeout, reject non-HTTPS or non-Discord hosts, return non-zero on non-2xx, and never print the URL. `.env.example` contains only an empty variable name; `.gitignore` excludes `.env`, `.env.*` except the example. Prefer a shell/CI secret variable over a file. Never import this script from `js/`, cache it in `sw.js`, or make it reachable from frontend code.
12. **[P2] Correct documentation.** Replace the permissive schema guidance in `README.md` with links to versioned migrations and an explicit statement that the local lock is not cloud authorization. Document key rotation and incident steps. If task/chat logs containing the previously supplied webhook URL are not tightly controlled, rotate that Discord webhook before using the notifier.

#### UX behavior

The owner sees a real sign-in only when no valid Supabase session exists. A retained local device lock may appear on return, but it is described as privacy convenience rather than account security. Authentication, session expiry, offline-with-cached-data, and signed-out states are distinct and understandable. A failure to authenticate never silently opens cloud data.

#### Visual behavior

Preserve the current dark gate. Add clear inline error, pending, offline, and session-expired states using existing surfaces; do not redesign the app shell in this phase. Focus visibility and error contrast must meet the later token direction even before the full design-system pass.

#### Data/schema changes

- Add authenticated ownership to every Supabase table.
- Replace global singleton assumptions with one row per `user_id` (a composite unique key is acceptable).
- Drop unconditional anon policies and add owner-scoped authenticated policies.
- Do not place service-role credentials, owner UUIDs, passwords, the Discord webhook, or sensitive exports in committed files.
- This phase does not migrate application stores to IndexedDB; that happens in Phase 2.

#### Edge cases

- Existing rows have no owner and need a deliberate owner UUID.
- The owner signs in on a second device.
- Supabase session expires while the app is open.
- The app starts offline with an existing cached session and local data versus no prior session/data.
- The RLS migration partially fails; transaction must roll back.
- A second user attempts cross-owner queries or spoofed inserts.
- CSP blocks the CDN or Supabase websocket/REST endpoint; test exact directives before deployment.
- Webhook environment variable is absent, malformed, redirected, rate-limited, or returns non-2xx.

#### Backward compatibility

Preserve every existing user row through the owner backfill. Keep public Supabase URL/anon configuration usable—those values are not treated as secrets—but remove client credentials/PIN material. Existing local documents remain readable. Do not clear storage as part of authentication migration. Preserve static hosting and current routes until Phase 5.

#### Validation

- Run `npm ci` from the committed lock file, then `npm run validate`.
- Verify every source file with `node --check` through the scripted command.
- Run ESLint with zero new errors; document any tightly scoped temporary legacy warnings.
- Run unit tests for escaping/config/auth-state helpers.
- Run Playwright at 390 × 844 and 1280 × 900 with fake Supabase for signed-out, signed-in, expired-session, and offline-cached states.
- In a disposable/staging Supabase project, run migration and verification SQL, including anonymous, owner, and second-user tests. Then apply to production only after the backup exists.
- Inspect browser console and network: no secret-bearing response/log, no anonymous personal-data request, no CSP violation during normal flows.
- Verify `rg` cannot find the webhook token, service-role keys, passwords, old PIN literal, or old PIN hash in tracked/client files.
- Run the notifier once with a disposable test webhook or controlled real endpoint after all phase checks; inspect that the message contains no URL or user data.

#### Definition of Done

- Live personal tables are owner-scoped by verified RLS and anonymous access fails.
- The client PIN is no longer the cloud security boundary and no PIN clue remains in source.
- A database-level recovery snapshot exists.
- Static/browser behavior remains functional under the new authenticated session.
- `npm run validate` is repeatable on a clean checkout.
- The webhook is environment-only and the notifier fails safely.

#### Discord completion notification

Only after every validation item succeeds, run the server-side notifier with project `DontDie`, phase `1`, name `Security, Recovery Guardrails, and Executable Quality Baseline`, a concise change summary, exact checks performed, `success: true`, and resolved blockers/deviations (or `None`). If database verification or any check fails, fix it or record the blocker and do **not** send a completion notification.

> Completion record
> - Status: Complete
> - Completed at: 2026-09-02T18:08:18+02:00 (production migration, verification, and owner confirmation complete)
> - Files materially changed: `js/config.js`, `js/auth.js`, `js/session.js`, `js/supabaseClient.js`, `js/deviceLock.js`, `js/db.js`, `js/main.js`, `js/boot.js`, `js/ui/dom.js`, `js/ui/modal.js`, `js/tabs/today.js`, `js/tabs/stats.js`, `js/tabs/settings.js`, `js/home/today.js`, `js/school/tabs/_shared.js`, `js/school/tabs/tests.js`, `js/school/tabs/settings.js`, `index.html`, `style.css`, `sw.js`, `README.md`, `docs/security-deployment.md`, `supabase/migrations/001_owner_auth_and_rls.sql`, `supabase/verify/001_owner_auth_and_rls.sql`, `supabase/staging/000_supabase_compat.sql`, `supabase/staging/001_pre_migration_baseline.sql`, `vendor/supabase-js-2.112.4.umd.js`, `vendor/README.md`, `package.json`, `package-lock.json`, `eslint.config.js`, `jsconfig.json`, `playwright.config.js`, `.gitignore`, `.env.example`, `scripts/check-syntax.mjs`, `scripts/secret-scan.mjs`, `scripts/dev-server.mjs`, `scripts/db-verify.mjs`, `scripts/notify-phase.mjs`, `tests/unit/*` (5 files), `tests/e2e/*` (4 specs + 2 fixtures).
> - Validation: `npm ci` from the committed lock file — OK. `npm run validate` — pass: `check-syntax` 92/92 files via `node --check`; `eslint .` 0 errors, 21 budgeted legacy warnings (`--max-warnings 21`); `secret-scan` clean over 113 files with 7 audited inline allowances; `node --test` 56/56 unit tests; Playwright 46/46 across 390x844 and 1280x900 (auth states signed-out / signed-in / expired / expiring-live / offline-with-and-without-session, all five modes and every tab, output escaping, device lock, CSP). `git diff --check` clean. Migration rehearsal `npm run db:verify` against a disposable Postgres 17 container with Supabase-compatible `auth.uid()`: migration applied (10 rows backfilled, post-conditions passed) and verification sections A–F all PASS; the same verification against the pre-migration schema fails at A/FAIL as a negative control. CSP verified live in the browser — the vendored library loads under `script-src 'self'`, an injected inline script and a jsDelivr script are both refused, and the only third-party requests are the Google Fonts hosts.
> - Production execution: a database-level recovery snapshot was taken and verified before any mutation (stored outside the repository; no credentials or personal data committed). `001_owner_auth_and_rls.sql` was then applied to the live project over SSL with `ON_ERROR_STOP=1`. Post-apply state re-verified read-only from this workspace: 7 installed DontDie tables (`habit_logs`, `custom_habits`, `split_config`, `mh_store`, `stimulation_store`, `school_store`, `mind_texts_store`) all carry `user_id` with `rowsecurity = true`; `habit_config` is **not** installed in production and the migration's skip-if-absent branch handled it correctly rather than failing; 28 owner policies exist (SELECT/INSERT/UPDATE/DELETE × 7 tables) and every one is granted to `authenticated` only; `anon` and `public` hold **no** table privileges; no unconditional `Allow all anon` policy remains. Verification sections A–F were re-run against production and all PASS (A schema shape on 7 installed tables, B anonymous denied, C owner read/write, D cross-user denied, E `user_id` spoofing denied, F per-owner document singletons); sections B–F execute inside a transaction that is always rolled back and touch only rows they create. Row counts preserved with zero unowned rows: `habit_logs` 152, `custom_habits` 7, and one owned row in each of the five JSON document stores (164 rows total). Temporary placeholder-substituted SQL was written only to a session temp directory and deleted; it was never staged or tracked. The deployed GitHub Pages asset hash matches the committed source at `c34754d` (`git hash-object js/main.js` equals the hash of the served file). Owner sign-in with the real account succeeded, existing application data loaded correctly, real work performed in the application appeared correctly on a second physical device, so authenticated cross-device cloud persistence is confirmed.
> - Deviations: (1) Added `supabase/staging/*.sql` and `scripts/db-verify.mjs`, not named in the plan, so the migration could be rehearsed end to end without a hosted staging project. (2) Vendored the Supabase library at an exact version instead of pinning the CDN URL with integrity metadata — the plan permits either; vendoring is what allows `script-src 'self'`. (3) `style-src-attr 'unsafe-inline'` is retained because the existing renderers emit inline `style` attributes; script sources carry no unsafe keyword. (4) Used `ENABLE` rather than `FORCE ROW LEVEL SECURITY`: PostgREST never connects as the table owner, so FORCE adds no protection against the client while breaking dashboard access and dump-based recovery. (5) `no-unused-vars` / `prefer-const` / `no-useless-escape` are warnings rather than errors for pre-existing `js/**` modules, capped at the exact current count of 21 so no new occurrence can be added; documented in `eslint.config.js`. (6) The Playwright suite blocks service workers, whose requests bypass `page.route` and would otherwise let the real library load on a reload; offline app-shell behaviour is Phase 8 work. (7) The audit and the migration header both list `habit_config` as an expected table; it is not installed in the live project, so the migrated set is seven tables rather than eight. This is a correction to the audit, not a migration failure.
> - Unresolved issues: P2 — the pre-Phase-1 PIN and its hash remain in published Git history; they are removed from the working tree, the PIN is to be treated as public, and `js/deviceLock.js` rejects four-digit secrets so it cannot be reused. P2 — the Discord webhook was supplied over a chat channel; rotate it if that transcript is not tightly controlled (`docs/security-deployment.md` §6). P2 — `habit_config` does not exist in production; the client's habit-configuration store must therefore keep working against local storage plus its existing fallback, and Phase 2 must not assume the table is present.
> - Discord notification: Sent at 2026-09-02T18:08:18+02:00 via `scripts/notify-phase.mjs` (HTTP 204, endpoint read from `DONTDIE_DISCORD_WEBHOOK_URL` only).

### Phase 2 — Local-First Repository, Durable Sync, and Conflict Recovery

#### Objective

Replace split, fragile persistence behavior with an immediate local-first read path, a durable outbox, ordered cloud writes, observable sync state, and recoverable conflict handling.

#### Why this phase exists

Reliable persistence is prerequisite architecture for telemetry, navigation, and large UX changes. It addresses P1 data divergence without rewriting domain models or introducing a state-management framework.

#### Files / systems involved

- Existing: `js/state.js`, `js/db.js`, `js/sync.js`, `js/habits.js`, `js/habitConfig.js`, `js/habitStimLink.js`, `js/split/store.js`, `js/mental/store.js`, `js/mental/texts/store.js`, `js/stimulation/store.js`, `js/school/store.js`, `js/main.js`, `js/ui/toast.js`, `js/tabs/split.js`, `js/navigation.js`, `js/modes/controller.js`, `index.html`, `style.css`.
- Proposed: `js/data/indexedDb.js`, `js/data/repository.js`, `js/data/documentRepository.js`, `js/data/habitRepository.js`, `js/data/outbox.js`, `js/data/reconcile.js`, `js/data/conflicts.js`, `js/data/migrations.js`, `js/data/types.js`, `js/ui/syncStatus.js`.
- Proposed tooling: `scripts/notify-status.mjs` as a server-side status notifier distinct from the successful phase-completion notifier.
- Proposed tests: `tests/unit/data/`, `tests/e2e/offline-sync.spec.js`, `tests/e2e/conflict-recovery.spec.js`, `tests/e2e/split-motion.spec.js`, `tests/e2e/swipe-performance.spec.js`.
- Proposed database migration: `supabase/migrations/002_revision_and_archive_support.sql`.

#### Required changes

1. **[P1] Define the repository contract before changing stores.** Use JSDoc typedefs in `js/data/types.js` for local documents, habit logs, custom habits, outbox operations, remote revision metadata, conflicts, and repository results. UI code receives domain values plus explicit `{status, error, conflict}` rather than interpreting Supabase responses. Existing module store files may retain their public action names, but renderers must stop directly persisting or mutating shared state; module actions delegate to repositories, and `js/state.js` becomes a replaceable in-memory read cache rather than the persistence source of truth.
2. **[P1] Create one native IndexedDB database, `dontdie_local_v2`.** Use versioned object stores: `documents`, `habitLogs`, `customHabits`, `outbox`, `conflicts`, and `meta`. Telemetry receives a separate database in Phase 4 so clearing analytics never endangers personal records.
3. **[P1] Migrate legacy local data non-destructively.** On first launch, read each current `localStorage` key, normalize it with the owning module's existing normalization logic, write it transactionally to IndexedDB, and set a migration marker only after verification. Keep legacy keys untouched for one release/recovery cycle. Never treat an unparsable key as empty; record a local recovery conflict and offer export of the raw value.
4. **[P1] Render local state before cloud reconciliation.** `js/main.js` should authenticate, hydrate valid IndexedDB state, construct the shell, then reconcile remote data in the background. If there is no local data, show scoped skeleton/empty states rather than a blank application. Cloud latency must not block tab construction after the local repository is ready.
5. **[P1] Make all user mutations local transactions first.** A successful UI action means the mutation is durably written locally and a corresponding outbox operation exists. Use client-generated UUIDs/idempotency keys. Do not optimistically claim success for a mutation that could not be stored locally.
6. **[P1] Replace the memory retry queue.** `js/data/outbox.js` persists operations, flushes at authenticated startup, on `online`, after a successful foreground write, and with bounded exponential backoff/jitter. Collapse superseded writes only by documented identity: habit log `(userId,date,habitId)`, custom habit ID, or document store ID. Never collapse a delete/restore boundary incorrectly.
7. **[P1] Serialize whole-document writes per store.** Capture immutable snapshots, permit only one remote write in flight per document, and enqueue the newest revision after completion. A late response must not set an older snapshot as current. Screen Time batching is completed in Phase 3, but this serializer prevents its current writes from racing.
8. **[P1] Add optimistic concurrency metadata.** Migration 002 adds `revision` and server-maintained `updated_at` to singleton documents. Updates must include the expected remote revision. A mismatch fetches the remote value and stores both snapshots as a conflict; it does not silently overwrite either copy.
9. **[P1] Provide conflict recovery.** `js/data/conflicts.js` retains local and remote snapshots plus timestamps/store names. A small global sync-status entry opens a dark recovery sheet offering “Keep this device,” “Use cloud,” and “Download both before deciding.” Domain-specific automatic merge is allowed only for independently keyed habit rows; do not auto-merge journals, imported texts, school plans, or stimulation documents without tests proving semantics.
10. **[P1] Make habit-to-stimulation changes one local intent.** Write the habit completion, linked stimulation reconciliation marker, and both outbox operations in one IndexedDB transaction. On startup/flush, `reconcileHabitStimLinks` derives whether the linked entry should exist from the durable habit state. Cloud writes can be separate but must be idempotent and converge.
11. **[P1] Make deletes/resets durable tombstones.** A local delete cannot be resurrected by a stale remote hydrate. Retain tombstone/version metadata until the remote delete/archival operation succeeds and reconciliation observes the same or newer revision.
12. **[P1] Surface sync accurately.** Distinguish `saved locally`, `syncing`, `offline—saved on this device`, `synced`, `conflict`, and `sync failed—retrying`. `setOnline(true)` must trigger a flush and connection health must update from real results. Do not use a toast for every successful background sync.
13. **[P2] Add a core-only typecheck.** Add `tsconfig.core.json` with `allowJs`, `checkJs`, DOM libs, and an include list for the new data layer and pure helpers. Add `npm run typecheck:core`; keep it green as later core files are added. Do not suppress errors with broad `any` or `@ts-ignore`.
14. **[P1] Fix the user-reported Split first-tap animation defect now, not in the later polish phase.** First record the deployed/current failure with Playwright video or screenshots and a trace. Verify the precise cause rather than relying only on the audit hypothesis. The opening implementation must lock the genuinely collapsed starting height before applying the open state, measure the natural end height once, start the transition on a later animation frame, and cleanly return control to the CSS resting state. One tap/click/keyboard activation must always produce one state change and visible feedback; a double click must not be required. Rapid open→close→open must reverse from the current visual height without a stale timer or `transitionend` handler clobbering the final state. Use a semantic button with `aria-expanded`/`aria-controls`, provide an immediate reduced-motion path, and avoid repeated layout reads inside animation frames.
15. **[P1] Fix user-reported swipe lag with measured gesture-frame work.** Capture a before trace on a mobile viewport using at least ten consecutive swipes across populated Home, Physical, Mind, Stimulation, and School tabs. Replace the document-wide gesture hot path where practical with slider-scoped Pointer Events, pointer capture, and a compatible `touch-action` policy that keeps vertical scrolling native while claiming horizontal gestures. Coalesce transform writes to at most one per `requestAnimationFrame`; cache panel width and bounds at gesture start; perform no renderer, database, DOM reconstruction, or layout read in `pointermove`; use compositor-only `translate3d`; and clear temporary `will-change` after settling. Do not synchronously rebuild every tab when a swipe finishes. The destination panel must already be usable or render outside the gesture frame, with focus/scroll preserved. Retain edge resistance, velocity/distance thresholds, vertical-scroll cancellation, orientation changes, RTL-independent direction logic, reduced motion, and mouse/keyboard tab navigation.
16. **[P2] Remove the redundant header mode-switcher pill and retain the lower translucent mode control.** Remove `#mode-switcher` and its label/chevron from the header at the markup/controller boundary; do not leave an error log or dead listener when it is intentionally absent. Keep `#mode-fab` as the single mode picker/home shortcut, preserve its tap/hold/keyboard semantics and accessible name, and keep the desktop tab navigation if still needed. Measure its position against the bottom dock, safe-area inset, browser chrome, virtual keyboard, and scrollable content so it never covers the last actionable item. The screenshot/user wording calls this the “top-right” button even though the current DOM places the header pill at the top-left; remove the header pill identified by `#mode-switcher`, not the translucent lower `#mode-fab`.
17. **[P1] Add non-completion Discord work-status notifications.** Keep `scripts/notify-phase.mjs` strict: it may label a phase complete only with `success=true`. Add a separate Node-only `scripts/notify-status.mjs` for `working`, `paused`, or `blocked` updates. It must use the same environment-only URL validation, redirect refusal, timeout, content/URL/token guard, and frontend/service-worker exclusion. Before Claude sends a final chat response after any turn in which it performed repository, database, Git, deployment, or test work, it sends exactly one notification: the phase-completion message if the phase completed, otherwise a clearly non-completion status containing task, work performed, checks, current state, and next required action. A pause for user input is not “silence”; it receives a `paused` status message without claiming success.

#### UX behavior

Returning users see their last valid state immediately. Offline actions remain visibly applied because they are durably stored; the shell shows a quiet sync indicator. Conflicts are rare but explicit and recoverable. A user never has to guess whether “saved” means local or cloud. Training Split day details open on the first activation with smooth, reversible feedback. Horizontal swiping tracks the finger without visible hitching. The lower translucent mode control remains the single compact mode switcher; the redundant header pill is gone.

#### Visual behavior

Add one compact status affordance in the persistent shell and an accessible recovery sheet using existing dark surfaces. Use restrained status color and text; no persistent animated spinner when idle. Skeletons should match final geometry and disappear without layout jumps. Preserve the existing Split card appearance while making the first transition visible. Removing the header pill must reclaim its space cleanly; the lower translucent mode control and bottom dock keep the current premium-dark treatment.

#### Data/schema changes

- New IndexedDB database/version and stores listed above.
- Existing localStorage documents migrate but are retained temporarily.
- Supabase singleton documents gain revision/updated timestamps or equivalent compare-and-set support.
- Outbox operations contain structural metadata and document payloads required to sync personal data; they remain on device and are deleted after acknowledged remote success.
- No usage telemetry is stored in this database.

#### Edge cases

- IndexedDB unavailable, blocked, corrupted, or quota-limited.
- Legacy local document is newer than cloud; cloud is newer; clocks disagree.
- App closes during local migration, outbox write, or cloud response.
- Online/offline events flap rapidly.
- Auth session changes while operations remain queued; operations must be owner-bound and never sent under another account.
- Same document changes on two devices before either sees the other.
- Habit is toggled repeatedly offline; only final intended state and linked stimulation state should converge.
- A delete/reset occurs while an older save is in flight.
- Split content changes height while opening, a user reverses direction mid-animation, the card is initially open for today/edit/desktop, or reduced motion is enabled.
- A swipe begins on an interactive child, becomes vertical, reverses direction, reaches the first/last tab, is cancelled by the OS, or crosses an orientation/viewport change.
- The lower mode control is used with keyboard/screen reader, the virtual keyboard is open, or the device has a bottom safe-area inset.
- A work session finishes blocked/paused rather than complete; the Discord message must say so and must never use completion wording.

#### Backward compatibility

Use existing normalizers and preserve every legacy storage key until a verified migration/recovery release. Keep current Supabase tables and JSON document shapes readable; add revision metadata without discarding unknown fields. Existing UI actions and data remain available while their implementation moves behind repositories.

#### Validation

- Run `npm run validate` and `npm run typecheck:core`.
- Unit-test IndexedDB migrations, outbox collapse rules, serialized saves, revision conflicts, tombstones, and habit/stimulation convergence using a deterministic fake database.
- E2E: load with local data and a delayed server; confirm content appears before remote response.
- E2E: perform actions offline, reload while offline, confirm state persists, reconnect, and confirm exactly-once/idempotent remote outcome.
- E2E: simulate stale remote revision and verify both snapshots remain downloadable until the user resolves the conflict.
- E2E: toggle a stimulation-linked habit repeatedly offline and verify habit/log linkage after reconnect and reload.
- Test migration interruption and rerun; no duplicate rows and no legacy-key deletion.
- Inspect network request count and ordering for one mutation per logical operation.
- Test at quota failure and confirm the UI does not falsely claim a durable save.
- Split regression: in a 390 × 844 touch viewport, activate every collapsed day exactly once and assert `aria-expanded`, visible body height, and transition progression; record video/screenshots before and after. Test rapid reversal, content-height changes, keyboard activation, today/edit/desktop defaults, and reduced motion. A double click must cause no extra state toggle.
- Swipe regression: record before/after Playwright traces for ten consecutive swipes over realistically populated panels. Assert no database calls or full panel rebuilds during pointer movement, no duplicate gesture listeners after mode changes, no common-gesture long task over 50 ms, transform writes no more than once per animation frame, correct final tab, and preserved vertical scrolling. Inspect trace screenshots/video instead of asking the owner to judge routine smoothness.
- Navigation-control regression: assert `#mode-switcher` is absent, `#mode-fab` opens the mode menu and supports Home shortcut/keyboard behavior, desktop tab navigation remains reachable, and the lower control does not overlap the final focusable/content item at 320 × 700, 390 × 844, landscape, and safe-area emulation.
- Status-notifier tests: dry-run and mocked delivery for working/paused/blocked; verify it never says “Phase complete,” never accepts a message containing a URL/token, never prints the endpoint, and remains unreachable from `index.html`, `js/`, or `sw.js`.

#### Definition of Done

- Every module reads and writes through the repository layer.
- Local state renders before remote reconciliation.
- No in-memory-only write queue remains.
- Out-of-order writes cannot silently roll back a newer state.
- Offline reload preserves pending actions.
- Conflicts retain both versions and are resolvable.
- Linked habit/stimulation state converges after failures.
- Every Split day opens on the first activation and its animation/reversal tests pass.
- Mobile swipe traces demonstrate a responsive compositor-only gesture path without render/layout work in movement frames.
- The header mode pill is removed, the lower translucent mode control remains accessible and non-overlapping, and no navigation capability is lost.
- A safe Discord status notification is sent before every work-turn final response when the phase is not yet complete.

#### Discord completion notification

After validation succeeds, notify project `DontDie`, phase `2`, name `Local-First Repository, Durable Sync, and Conflict Recovery`; summarize repository migration, offline/outbox behavior, conflict recovery, exact test scenarios, and any documented migration deviation. Send only `success: true` completion messages through the environment-only script.

### Phase 3 — Data Correctness, Historical Stability, Backup, and Restore

#### Objective

Fix identified cross-period and domain-model defects, make historical records stable under settings changes, and deliver a genuinely complete, validated recovery path before broader product changes.

#### Why this phase exists

Telemetry and polished exports are not trustworthy if base records, time ranges, and backups are wrong. This phase completes P0/P1 correctness work on top of the durable repository.

#### Files / systems involved

- Existing: `js/export/collect.js`, `backup.js`, `aiReflection.js`, `download.js`, `js/db.js`, `js/habits.js`, `js/home/data.js`, `js/home/review.js`, `js/stimulation/store.js`, `screenTime.js`, `tabs/importScreen.js`, `tabs/settings.js`, `js/school/store.js`, `planner.js`, `tabs/results.js`, `js/mental/texts/store.js`.
- Proposed: `js/export/schema.js`, `js/export/restore.js`, `js/export/ranges.js`, `js/stimulation/entryMigration.js`, `js/stimulation/reconcileImport.js`, `js/school/scheduler.js`, `tests/fixtures/backups/`.
- Proposed database migration: `supabase/migrations/003_stable_history_and_constraints.sql` if row constraints/archival columns are required.

#### Required changes

1. **[P0] Make backup collection asynchronous and complete.** Add a repository query that streams/pages every habit log and custom habit for the authenticated owner, overlays pending outbox state, and verifies coverage. Do not use the 84-day render cache for backup. Mark a backup complete only when every repository reports success; otherwise offer an explicitly labeled partial diagnostic export, never an “all-time backup.”
2. **[P0] Version the backup envelope.** Include `schemaVersion`, `exportedAt`, app version/cache version, per-store counts, date coverage, and checksums for store payloads. Distinguish app data from optional local telemetry. Do not include credentials, auth tokens, or sync conflict internals unless explicitly needed for recovery.
3. **[P0] Implement restore with preview.** Parse and validate without mutation; show version, date, counts, invalid/unknown fields, and merge-versus-replace choices. Before applying, generate a rescue backup of current state. Apply locally in one IndexedDB transaction, enqueue controlled cloud synchronization, and show completion/conflict status. Reject malformed or future unsupported schemas without partial writes.
4. **[P1] Load sufficient habit history for claims.** Fetch/cache at least the required 366-day window for one-year charts/streaks, and use explicit paged full history only for all-time values/exports. If complete coverage cannot be established, label streak/history as partial instead of computing a false longest value.
5. **[P1] Centralize date-range semantics in `js/export/ranges.js`.** Define inclusive local-date boundaries and pass the range to every module collector. Fix School session counts/missed sessions, Home weekly review, Mind Texts metrics, and all other mixed-scope summaries. Add fixtures straddling midnight, DST changes, week boundaries, future sessions, and no-data ranges.
6. **[P1] Stabilize stimulation history.** Introduce entry schema v2 with an explicit local date, start minute or ISO local timestamp, block duration, timezone identifier/offset snapshot, activity ID, and activity scoring/name snapshot needed for historical interpretation. Migrate v1 block-index entries using the settings valid at migration and retain an original-version marker. Future changes to day start or block length must not reinterpret existing records.
7. **[P1] Remove the 24-block cap.** Generate the exact count implied by start/end/block duration, with a documented maximum such as 96 15-minute blocks. Validate that end exceeds start in the intended day model and that duration evenly maps or renders a final partial block intentionally.
8. **[P1] Archive referenced stimulation activities.** Default deletion to archive; historical entries continue to display and score from their snapshot. Only allow permanent deletion of an unused activity after confirmation. Existing missing activities remain visibly labeled as legacy/missing rather than silently excluded.
9. **[P1] Make Screen Time import atomic at the domain level.** Parse and preview first, then apply mappings, missing activities, reconciliation, and entries to one cloned stimulation document and perform one local save/outbox enqueue. Preserve source snapshot IDs so re-importing the same snapshot is idempotent. Fix generic-category reconciliation so one generic manual entry cannot incorrectly cover several unrelated app totals; show allocation assumptions in preview.
10. **[P1] Fix School result linking.** Replace the always-true title comparison in `inferTestId` with deterministic matching: explicit imported test ID first; then normalized exact title plus subject; then nearest active test date within a documented window; otherwise require user selection. Never silently select the first same-subject test when ambiguous.
11. **[P1] Preserve relational integrity for delete/archive.** Custom habit removal must clean or preserve configuration intentionally and retain historical log labels. School test archive must keep results/sessions visible in history; an advanced permanent delete must show linked counts and cascade or detach them according to one tested rule. Journal deletion needs confirmation/undo in Phase 7 but its repository tombstone must work now.
12. **[P1] Audit computed claims.** Confirm that Physical “day streak” currently means a day with at least one scheduled habit completed, not a perfect day; keep the calculation but rename the label to be truthful unless product requirements explicitly change it. Review stimulation/mental terms so behavioral proxies are not presented as biological measurements.

#### UX behavior

Exports display progress and a precise completeness state. Restore always shows what will change and creates a recovery point. Historical stimulation views remain unchanged when settings change. Ambiguous School imports ask for a test rather than guessing. Archive is the default for entities referenced by history.

#### Visual behavior

Add compact export/restore progress, validation summaries, archive badges, ambiguity selection, and partial-data warnings. Reuse existing dark cards and modal surfaces; detailed raw errors remain progressively disclosed.

#### Data/schema changes

- Backup schema becomes a versioned envelope, with migration functions for older exports.
- Stimulation entry schema v2 stores stable time/activity snapshots.
- Activities/tests/custom habits gain archive/tombstone semantics where needed.
- Screen Time imports gain deterministic source/import IDs.
- No existing field is discarded during migration; legacy/dormant fields remain round-trippable.

#### Edge cases

- More than the Supabase page-size limit of habit logs.
- Pending offline operations at backup time.
- Partial cloud outage during collection or post-restore sync.
- Restore of the current, older, malformed, duplicate, or future schema.
- DST transition, timezone travel, overnight stimulation window, and non-hour blocks.
- Archived activity/test referenced in old reports.
- Duplicate Screen Time snapshot or renamed app.
- Two tests with same subject/title/date; unparseable imported result.
- Empty date range and future-only data.

#### Backward compatibility

Read backup v1/current unversioned shapes through an explicit adapter. Read stimulation v1 entries indefinitely and migrate idempotently. Preserve old activity/test/result labels in snapshots. Existing downloadable formats remain available but are labeled legacy until their correctness is verified.

#### Validation

- Run aggregate validation and core typecheck.
- Unit-test complete pagination/outbox overlay, checksums, backup validation, and restore rollback.
- Golden-test each export range against fixture data with out-of-range records.
- Round-trip current data: backup → isolated empty repository → restore → normalized deep equality and matching counts.
- Simulate one failed store during export and prove no file is labeled complete.
- Test all permitted stimulation schedules, including 00:00–24:00 at 30-minute blocks, and ensure history is invariant after settings changes.
- Test archived/missing activities and historical score retention.
- Test duplicate Screen Time import and assert one repository save/one logical outbox operation.
- Test ambiguous School matching and deletion/archive relationships.
- Manually inspect full and compact Markdown for factual/estimated labeling and sensitive-content warnings.

#### Definition of Done

- A complete backup includes all owner habit history and every current document store or fails explicitly.
- Restore is validated, previewed, recoverable, and round-trip tested.
- Period summaries contain only the selected period.
- Stimulation history no longer changes when settings/catalog entries change.
- Screen Time import is idempotent and batched.
- School result inference never makes an ambiguous silent match.

#### Discord completion notification

After all migration, round-trip, range, and module correctness checks pass, notify project `DontDie`, phase `3`, name `Data Correctness, Historical Stability, Backup, and Restore`. Include backup/restore evidence and any legacy records that required a documented adapter. Do not notify completion on a partial export or unverified migration.

### Phase 4 — Privacy-Preserving Feature Usage Telemetry (Phase A)

#### Objective

Collect reliable, local-only behavioral metadata about how DontDie is used, with semantic feature IDs, honest active-time estimates, privacy controls, and negligible interaction cost.

#### Why this phase exists

Information-architecture decisions should eventually be based on evidence. Instrumentation must precede adaptive shortcuts and usage summaries, while remaining completely separate from sensitive content and core persistence.

#### Files / systems involved

- Existing integration points: `js/main.js`, `js/navigation.js`, `js/modes/controller.js`, `js/modes/go.js`, module store/action files, `js/export/*`.
- Proposed: `js/telemetry/featureCatalog.js`, `events.js`, `store.js`, `session.js`, `track.js`, `privacy.js`, `retention.js`, `types.js`.
- Proposed UI: `js/settings/usagePrivacy.js` (temporarily linked from Modules until Phase 5 creates Global Settings).
- Proposed tests: `tests/unit/telemetry/`, `tests/e2e/telemetry.spec.js`.

#### Required changes

1. **[P1] Define a fixed, versioned feature catalog from the actual application.** At minimum include:
   - `home.today`, `home.quick_log`, `home.review`, `home.modules`;
   - `physical.habits_today`, `physical.week`, `physical.stats`, `physical.training_split`, `physical.habit_settings`;
   - `mind.checkin`, `mind.tasks`, `mind.texts`, `mind.text_reader`, `mind.books`, `mind.journal`, `mind.stats`;
   - `stimulation.dashboard`, `stimulation.log`, `stimulation.activities`, `stimulation.stats`, `stimulation.settings`, `stimulation.screen_time_import`;
   - `school.today`, `school.plan`, `school.tests`, `school.results`, `school.settings`;
   - `global.data_privacy`, `global.backup`, `global.ai_export`, `global.usage` when those destinations exist.
   Catalog entries have stable IDs, display labels, module, introduced/retired schema versions, and whether the feature is currently available. Renames change labels, not historical IDs.
2. **[P1] Use a separate IndexedDB database, `dontdie_usage_v1`.** Store raw events, session summaries, daily aggregates, and metadata/consent. Clearing telemetry must not touch personal records or the sync outbox. Do not sync telemetry to Supabase in this plan.
3. **[P1] Define a minimal event envelope:** `schemaVersion`, random event ID, random session ID, `occurredAt`, `featureId`, allow-listed `eventId`, optional source/target feature IDs, optional `durationMs`, `durationKind`, and a tiny allow-listed metadata object such as `outcome` or `inputMethod`. Do not store user/entity titles, notes, check-in values, journal text, medical information, task/test/subject/activity names, book/text content, AI prompts/results, imported answer content, clipboard content, or raw URLs.
4. **[P1] Define semantic action IDs.** Include `feature.opened`, `action.completed`, and `action.failed` only with catalogued action names: habit toggle, task add/complete, check-in save, journal create/edit/delete, text import/reader start/text complete, book progress, stimulation entry add/remove, Screen Time import, School test/session/result actions, backup, restore, and export generation. Record successful domain outcomes, not every pointer click. Failure events contain only a bounded error category, never an error message that may include content.
5. **[P1] Instrument navigation centrally.** Emit a feature open only when the route becomes user-visible. Pre-rendering adjacent panels must not count. Record source → target for explicit navigation so common paths can be derived without reconstructing content.
6. **[P1] Define sessions honestly.** Start after the user passes the active auth/local lock and the shell is visible. End on explicit sign-out or after 30 minutes backgrounded/inactive; `pagehide` performs a best-effort flush. Active module time accumulates only while the document is visible and the user has generated input within the previous 60 seconds. Mark it `visible-active-estimate`, cap individual spans, and do not claim exact attention.
7. **[P1] Make tracking non-blocking.** Queue events in memory, batch IndexedDB writes during idle time or short timers, flush on visibility/pagehide, cap queue size, and drop telemetry before delaying a product mutation. Tracking exceptions must never fail a habit, journal, import, or route change.
8. **[P1] Add transparent controls.** Default local telemetry on after a one-time plain-language notice because it stays on-device and contains metadata only; provide Pause, Resume, Export raw usage data, and Delete all usage history. Show storage location, retention, and last event time. If the owner chooses off, record the preference but no subsequent behavioral events.
9. **[P2] Implement retention.** Keep raw events for 365 days by default. Before deleting older events, roll them into daily aggregates containing counts/durations only. Allow the owner to clear raw and aggregate history. Never use local telemetry clearing as a reason to clear application data.
10. **[P2] Add a telemetry privacy regression guard.** Central metadata validation rejects unknown keys and strings exceeding small fixed limits. Unit tests feed representative journal, text, School, and activity content and assert none reaches stored events.

#### UX behavior

The app explains once that private, structural usage metadata is stored only on this device to improve future organization. The user can inspect status, pause it, export it, or delete it. No cookie banner or advertising language is needed. Normal interactions do not wait for tracking.

#### Visual behavior

The notice and settings use a quiet privacy card and standard toggle. Do not add live counters to primary screens yet. No route-open animation or visible telemetry activity indicator is needed.

#### Data/schema changes

Example event shape (field names are normative, values illustrative):

```json
{
  "schemaVersion": 1,
  "id": "random-uuid",
  "sessionId": "random-uuid",
  "occurredAt": "ISO-8601 timestamp",
  "featureId": "school.plan",
  "eventId": "session.complete",
  "sourceFeatureId": "school.today",
  "durationMs": 42000,
  "durationKind": "visible-active-estimate",
  "metadata": { "outcome": "success" }
}
```

All identifiers and metadata values are catalog/allow-list controlled. The telemetry database contains no synced application content and no Supabase user ID is necessary for this single-device usage purpose.

#### Edge cases

- Tab pre-render, rapid tab switching, back/forward navigation, reload, and duplicate initialization.
- App backgrounded overnight or device sleeps.
- Multiple app tabs open; generate distinct sessions and avoid corrupting aggregates.
- System clock changes or timezone changes; retain UTC timestamps and derive local time bucket at aggregation with recorded timezone.
- Telemetry database quota or write failure.
- User clears telemetry during an active session or pauses while a batch is queued.
- A feature is renamed/retired.
- Tracking action fails after the domain action succeeds; domain action still wins.

#### Backward compatibility

No current user data is modified. Existing navigation continues to work. Feature identifiers are additive and versioned. Telemetry-off mode must be fully functional. Backup includes telemetry only as an explicit option; AI content exports do not yet include it until Phase 9.

#### Validation

- Run aggregate validation and core typecheck including telemetry files.
- Unit-test catalog validation, active-time caps, session boundaries, retention rollups, multi-tab IDs, and privacy metadata rejection.
- E2E each mode/tab and assert one visible open event, no event for pre-rendered panels, and correct source → target.
- E2E representative successful/failed actions and verify only allow-listed metadata.
- Search serialized usage data after entering unique sensitive canary strings in journal/check-in/Text/School fields; none may appear.
- Pause tracking, exercise every module, and verify no new behavioral events.
- Delete usage history and verify the application database/outbox is untouched.
- Measure a burst of 100 tracked actions; telemetry adds no visible input delay and does not create a long task over 50 ms.

#### Definition of Done

- Every current module has a stable feature ID and central route instrumentation.
- Major successful actions have semantic, privacy-filtered events.
- Active time is labeled and calculated as an estimate.
- Telemetry remains local-only, can be paused/exported/deleted, and cannot block product actions.
- Privacy canary tests prove sensitive text is absent.

#### Discord completion notification

After privacy and performance checks pass, notify project `DontDie`, phase `4`, name `Privacy-Preserving Feature Usage Telemetry (Phase A)`. Summarize event coverage, local-only storage, privacy tests, and performance measurements. Do not include telemetry contents or any user data in the notification.

### Phase 5 — Addressable Navigation and Coherent Information Architecture

#### Objective

Make DontDie easier to navigate and recover, establish one coherent global shell/Data & Privacy area, remove redundant mobile controls, and add contextual shortcuts without behavior-driven reordering.

#### Why this phase exists

The telemetry foundation is now collecting evidence, but immediate navigation defects do not require months of data. This phase fixes stable IA problems while deliberately keeping the core order fixed.

#### Files / systems involved

- Existing: `index.html`, `js/navigation.js`, `js/modes/controller.js`, `js/modes/registry.js`, `js/modes/go.js`, `js/main.js`, `js/home/today.js`, `quicklog.js`, `modules.js`, `js/tabs/settings.js`, `style.css`.
- Proposed: `js/router.js`, `js/routes.js`, `js/shell/header.js`, `js/settings/global.js`, `js/settings/dataPrivacy.js`, `js/ui/emptyState.js`.
- Existing export modules move behind Global Data & Privacy, but their implementation files remain under `js/export/`.
- Tests: `tests/unit/router.test.js`, `tests/e2e/navigation.spec.js`.

#### Required changes

1. **[P1] Define stable hash routes** because static hosting cannot guarantee server fallback: `#/home/today`, `#/home/log`, `#/home/review`, `#/home/modules`; equivalent explicit routes for every actual tab; and `#/settings/data`, `#/settings/usage`. Keep internal mode ID `mental` as a compatibility alias but use `mind` in new URLs and user-facing labels.
2. **[P1] Make `js/router.js` the single navigation authority.** Parse/validate routes, map legacy/unknown routes to a safe destination, update history for user navigation, replace history for redirects, update `document.title`, and expose route changes. Browser Back/Forward must restore the prior mode/tab without duplicating telemetry.
3. **[P1] Preserve navigation context.** Keep per-route scroll positions during a session, focus the route heading after browser navigation, and preserve a user's selected date/subsection where safe. A global Home quick-log link must explicitly open today's stimulation date; a deep Stimulation Log route may retain its last chosen date.
4. **[P1] Preserve the Phase 2 navigation-control decision.** The redundant header `#mode-switcher` is removed in Phase 2 at the owner's request. Keep the lower translucent `#mode-fab` as the single mode picker/Home shortcut, make its current-mode semantics and keyboard/screen-reader behavior explicit, and do not reintroduce a second header control during the router refactor. Retain the bottom tab dock and calculate content padding/offsets from the dock, the lower mode control, and `env(safe-area-inset-bottom)`.
5. **[P1] Create Global Data & Privacy.** Move backup, restore, AI exports, clear-data controls, authentication/sign-out, sync conflicts, telemetry controls, and usage placeholder into this destination. Link it from the header and Home Modules. Physical Settings becomes habit-specific settings; retain the old route as an alias and do not break existing functions.
6. **[P1] Standardize names.** Use `Mind` in all visible copy, `Physical` for the mode, `Habits` for habit-specific settings, and consistent `Screen Time` capitalization. Internal persisted IDs do not need destructive renaming.
7. **[P1] Add contextual routes/shortcuts.** Home cards link directly to the relevant route and date. Empty School state routes to Subjects/Settings before test creation if no subject exists. Habit-linked stimulation context offers a non-intrusive “View in Stimulation” link after logging. Export completion offers “Open Data & Privacy.”
8. **[P1] Standardize empty/error paths.** Every primary tab uses `js/ui/emptyState.js` with one clear next action, optional explanation, and no dead-end decorative dashboard. Loading, offline, conflict, and truly empty are separate states.
9. **[P2] Keep primary order stable.** Do not remove Home Log, reorder modes/tabs, or auto-promote features during this phase. Start a `docs/telemetry-decision-log.md` section that records hypotheses to evaluate after at least 30 active days.
10. **[P2] Add route-level telemetry.** Navigation events use final resolved routes and distinguish browser history, bottom tab, contextual shortcut, and mode switch only through an allow-listed input method.

#### UX behavior

URLs are bookmarkable; Back and Forward behave normally; refresh returns to the same valid module. Users find global backup/privacy/sync controls in one place. Mobile has the retained lower translucent mode switcher and one tab dock, neither covering content. Empty states tell the user exactly how to start.

#### Visual behavior

Retain the dark shell and dock silhouette while keeping the header free of the removed mode-switcher pill. Give the retained lower translucent mode control and global settings action clear selected/focus states, and reserve enough lower-page space that neither it nor the dock covers content. Route transitions remain minimal until the motion phase.

#### Data/schema changes

No personal-domain migration. Store only non-sensitive navigation preferences such as last valid route and session scroll positions. Route IDs map to the telemetry feature catalog. Legacy `mental` route/IDs remain readable.

#### Edge cases

- Unknown/malformed hash, removed tab, direct deep link while signed out, and post-auth return.
- Browser Back while a modal/reader is open; overlays should close before leaving the underlying route where appropriate.
- Refresh while offline.
- Deleted/archived entity referenced by contextual route.
- Mobile keyboard, landscape mode, notch/safe area, and desktop resize across the mobile breakpoint.
- Header settings, lower mode switcher, and bottom-dock focus order.

#### Backward compatibility

Default no-hash entry still opens Home Today. Existing mode/tab IDs and programmatic `goTo` call sites receive compatibility adapters during migration, then are removed only after reference checks. Do not change primary feature availability or reorder navigation.

#### Validation

- Run aggregate validation and router unit tests.
- E2E direct-load, refresh, Back, Forward, mode switch, tab switch, and unknown-route fallback for every route.
- Verify auth redirect returns to the requested safe route.
- Verify one route-open telemetry event per visible navigation.
- Test mobile at 320, 390, 768 widths and desktop at 1280; assert no dock/header overlap or horizontal overflow.
- Keyboard-only traversal of header actions, lower mode switcher, tabs, global settings, contextual links, and empty-state action; assert the removed header mode pill does not return.
- Verify document titles and focus destination after route changes.
- Confirm old settings links still resolve and global clear/export behavior is unchanged.

#### Definition of Done

- Every primary screen has a stable route and normal browser history behavior.
- Global Data & Privacy owns cross-product controls.
- Physical Settings contains only Physical/Habit concerns.
- Only the lower translucent mode control remains; the removed header duplicate does not return and no lower content is covered.
- Core navigation order remains stable and unpersonalized.

#### Discord completion notification

After route, history, responsive, keyboard, and compatibility checks pass, notify project `DontDie`, phase `5`, name `Addressable Navigation and Coherent Information Architecture`, including routes added, controls moved, responsive checks, and any retained legacy aliases.

### Phase 6 — Accessible Design System and Selective Glass Refinement

#### Objective

Turn the existing dark style into a coherent, reusable, accessible system; refine depth and selective Liquid Glass treatment; and make overlays, controls, charts, and state feedback consistent.

#### Why this phase exists

Navigation and data states are now stable enough for systematic visual work. The existing identity is valuable, so this phase extracts and normalizes it rather than applying a new theme.

#### Files / systems involved

- Existing: `style.css`, `index.html`, all renderer files that contain inline styles or one-off component markup, `js/ui/modal.js`, `toast.js`, `progress.js`, `chartLabels.js`, `confetti.js`.
- Proposed styles loaded in explicit order: `styles/tokens.css`, `base.css`, `shell.css`, `components.css`, `home.css`, `physical.css`, `mind.css`, `stimulation.css`, `school.css`, `reader.css`, `utilities.css`.
- Proposed primitives: `js/ui/button.js`, `dialog.js` (or upgraded `modal.js`), `sheet.js`, `field.js`, `segmentedControl.js`, `status.js`, `skeleton.js`, `chartA11y.js`.
- Proposed tests: `tests/e2e/accessibility.spec.js`, visual snapshot baselines under `tests/e2e/snapshots/`.

#### Required changes

1. **[P1] Formalize existing tokens.** In `tokens.css`, define semantic surfaces, text levels, mode accents, success/warning/error, focus ring, border/edge highlight, radii, shadows, blur levels, typography scale, icon sizes, spacing scale, touch targets, z-index layers, and motion tokens. Values should be derived from the current visual language, not a generic SaaS palette.
2. **[P1] Correct contrast and readability.** Raise muted/small-text contrast to WCAG AA for normal text against every actual surface. Remove `maximum-scale=1,user-scalable=no`. Restore text selection for content and inputs. Show subtle scrollbars on desktop/forced-colors contexts while retaining clean mobile scrolling.
3. **[P1] Establish glass usage rules in CSS.** Glass is allowed for the persistent header, bottom tab dock, modal/sheet containers, reader toolbar/temporary overlays, and at most one high-level summary/hero layer per screen. Use restrained transparency, edge highlights, and `backdrop-filter` only behind low-text-density surfaces. Dense cards, forms, lists, logs, tables, and chart plotting areas stay opaque. Provide `@supports` and reduced-transparency/low-performance fallbacks.
4. **[P1] Upgrade modal/sheet behavior.** The common primitive must provide `role="dialog"`, `aria-modal`, title/description relationships, focus trap, initial focus, Escape close when safe, focus restoration, background inertness, scroll lock, and a clear destructive-confirmation variant. Nested overlays and unsaved forms need explicit rules.
5. **[P1] Upgrade status primitives.** Toasts use an appropriate `aria-live` region without stealing focus. Loading buttons expose `aria-busy`, prevent duplicate submission, keep stable width, and state whether data is saved locally or synced. Disabled controls remain readable and explain prerequisites when non-obvious.
6. **[P1] Replace clickable containers.** Use real buttons/links for habit cards, journal entries/actions, activity rows, settings rows, and reader controls. If an entire card is interactive, avoid nested interactive elements and provide a clear accessible name. Give all icon-only controls labels.
7. **[P1] Make charts understandable without vision/color.** Add concise text summaries and, for detailed charts, expandable data tables. SVGs receive titles/descriptions or are hidden when a neighboring textual equivalent is authoritative. Do not use color alone for series/state. Normalize chart color tokens instead of hard-coded greens.
8. **[P1] Meet target and keyboard requirements.** Primary touch targets are at least 44 × 44 CSS px or have equivalent spacing. All interactive states have visible focus, hover only under hover-capable media, pressed, selected, disabled, loading, error, and success treatments. Word/sentence highlighting needs a keyboard-accessible selection/action alternative.
9. **[P2] Extract CSS incrementally.** Link new files before/after legacy CSS in a documented cascade order. Move one coherent section at a time, compare snapshots, and delete the old rule only when no longer referenced. Avoid `@import`. At the end, `style.css` may remain a small compatibility layer but must not duplicate extracted rules.
10. **[P2] Standardize component hierarchy.** Define three surface levels: page background, opaque content card, and elevated/glass overlay. Define heading/body/meta scale, consistent section gaps, card padding/radius, icon sizes, and compact versus standard controls. Replace inline magic values only where the matching token/primitive exists.
11. **[P2] Audit all empty/loading/error/success states visually.** Skeletons match content geometry; error cards include recovery action; destructive actions use confirmation or time-bounded undo; success feedback does not obscure the next action.
12. **[P2] Keep mode personality restrained.** Physical green, Mind violet, Stimulation amber/orange, and School blue accents can tint focus/progress/selected states, but text surfaces and component geometry remain one product system.

#### UX behavior

Controls behave consistently across modules, every workflow is keyboard reachable, dialogs manage focus correctly, charts have textual meaning, zoom works, and feedback clearly distinguishes local save/sync/error. Dense information remains easy to scan.

#### Visual behavior

The result remains unmistakably DontDie: near-black layered background, rich but controlled accent colors, opaque data cards, and selective translucent chrome with restrained blur/specular edges. Spacing, type, radii, focus, and interaction states become consistent. No light theme or glass-on-every-card treatment is introduced.

#### Data/schema changes

None. Component state contracts may gain accessible labels, busy state, severity, and focus-return options. Visual preferences should use platform media queries; do not persist a new theme setting without need.

#### Edge cases

- Long translated/user-created labels, large text/200% zoom, 320px viewport, landscape, virtual keyboard, safe areas.
- Forced colors/high contrast, reduced motion, unsupported backdrop filter, and low-end GPU.
- Nested modal/reader, destructive confirmation, and focus origin removed before close.
- Charts with no data, one point, extreme values, or several series.
- Touch devices with sticky hover and keyboard users on mobile hardware.

#### Backward compatibility

Preserve dark mode, current mode accents, information density, and recognizable card/navigation shapes. Do not change domain behavior. Extract CSS in small verified steps so selectors used by existing renderers remain valid until each renderer is migrated.

#### Validation

- Run aggregate validation and no-unused-selector/reference checks that are practical for dynamic class names.
- Run automated accessibility scans for every primary route and each common modal/sheet; manually verify findings rather than blindly suppressing them.
- Keyboard-only test all routes, forms, destructive flows, Text reader/highlights, and conflict recovery.
- Screen-reader spot check with browser accessibility tree for headings, nav landmarks, dialogs, toasts, forms, and chart summaries.
- Contrast-check tokens and text over actual translucent backgrounds; test 200% zoom and text scaling.
- Visual snapshots at 320 × 700, 390 × 844, 768 × 1024, and 1280 × 900 for every primary tab and important overlay.
- Use browser performance tooling on glass surfaces; scrolling must not exhibit sustained paint jank. Test the no-`backdrop-filter` fallback.
- Confirm no unintentional light surfaces, overflow, clipped focus rings, or controls below target size without equivalent spacing.

#### Definition of Done

- Tokens/primitives cover all common surfaces and interactive states.
- Dialog, toast, chart, keyboard, zoom, contrast, and touch-target requirements pass.
- Glass is selective and has safe fallbacks.
- Major inline magic values and duplicated primitive styles are removed.
- Visual snapshots confirm the original dark identity is preserved.

#### Discord completion notification

After accessibility, contrast, snapshot, responsive, and paint-performance checks pass, notify project `DontDie`, phase `6`, name `Accessible Design System and Selective Glass Refinement`. Summarize token/primitives work and accessibility fixes; note any intentional legacy CSS retained.

### Phase 7 — Module Workflow Consistency and High-Value Product Fixes

#### Objective

Resolve unfinished or inconsistent module workflows, reduce unnecessary steps, and make common actions predictable without flattening meaningful differences between modules.

#### Why this phase exists

The common navigation, data safety, and primitives now support domain-specific improvements with lower regression risk. These changes address concrete audit findings rather than speculative feature expansion.

#### Files / systems involved

- Physical: `js/tabs/today.js`, `week.js`, `stats.js`, `settings.js`, `js/habits.js`, `habitConfig.js`, `habitStimLink.js`.
- Training: `js/tabs/split.js`, `js/split/store.js`.
- Mind: `js/mental/tabs/checkin.js`, `tasks.js`, `texts.js`, `journal.js`, `stats.js`, `js/mental/texts/reader.js`, `highlights.js`, `books.js`, `booksUI.js`, `parser.js`, `store.js`.
- Stimulation: `js/stimulation/tabs/*`, `store.js`, `screenTime.js`.
- School: `js/school/planner.js`, `store.js`, `tabs/*`, `prompts.js`.
- Home: `js/home/today.js`, `review.js`, `quicklog.js`, `data.js`.
- Proposed pure module: `js/school/scheduler.js` and focused UI helpers alongside each module when a file split improves testability.

#### Required changes

1. **[P1] Standardize mutation behavior.** Every create/edit/archive/delete/complete action uses the repository result contract, prevents duplicate submits, provides local-save feedback, and either offers undo or a specific confirmation based on reversibility. Do not use a generic “Are you sure?” with no impact detail.
2. **[P1] Physical/Habits:** escape all custom names/labels; use archive for custom habits with history; clean or retain habit metadata intentionally; expose prior-week navigation without loading all history at once; label streaks precisely (`days with at least one scheduled habit completed`) unless the tested calculation changes; and show linked stimulation status only when relevant.
3. **[P1] Mind Journal:** allow editing an entry with original creation and new edited timestamps; warn before destructive deletion and support short undo through tombstones; preserve template provenance without coupling entries to later template edits.
4. **[P1] Mind Texts import:** impose documented payload limits (for example, maximum encoded bytes, text count, per-text body length, highlight count), validate the complete import before mutation, preview counts/warnings, and commit once transactionally. A quota/persistence failure must leave the prior library intact and must not claim success.
5. **[P1] Text reader:** debounce progress to no more than one compact progress write per five seconds plus pagehide/completion rather than rewriting the whole library; separate progress records if necessary. Count active reading time with the same visible/recent-input estimate and label it accordingly. Make queue/archive/removal management available without deleting completed history accidentally. Give keyboard users a selection-to-highlight action and accessible reader controls.
6. **[P1] Books:** apply the same archive/delete/undo language as other historical records; validate page/word corrections and explain derived word estimates as estimates. Keep books inside the Texts area but visually distinguish “Guided texts” and “Books” as subworkflows.
7. **[P1] Stimulation:** complete the v2 history UI from Phase 3; show overnight/variable block schedules correctly; preserve archived activity labels/scores; validate ranges and numeric values; and make Screen Time preview assumptions clear. Use source/import badges only in details, not as visual noise in the primary log.
8. **[P1] School scheduling:** make the stored controls truthful through a deterministic pure scheduler. Sort competing active tests by test date ascending, then lower readiness/grade, then higher `importance`. Generate future auto sessions using existing session-type rules, adjust standard session durations around `defaultSessionMinutes`, and allocate auto minutes per day up to `maxStudyMinutesPerDay`. Try the nearest earlier valid day before the test when a day is full. Never remove or shorten manual sessions; if required auto work cannot fit, show a capacity conflict rather than silently dropping it.
9. **[P1] School dormant fields:** keep and use test `importance` in the scheduler. Display parsed `recommendedNextSession`/`recommendedMinutes` as advisory and offer an explicit “Apply recommendation” action after validation; never silently replan from pasted AI text. Remove subject `defaultDifficulty` and unused `targetGrade` from visible forms/summaries unless a tested calculation uses them; preserve legacy fields in normalization/backup for compatibility.
10. **[P1] School replanning:** rebuild only future auto-generated sessions when a test, result, importance, or planning setting changes. Preserve completed and manually added sessions. Show a before/after summary and capacity conflicts. Archive tests by default so past results remain coherent.
11. **[P1] Home Review:** make every weekly number use the same local date range, separate completed versus missed School sessions, and ask concise questions based on actual data. Do not infer health/biology from behavioral completion or stimulation proxies.
12. **[P2] Home common actions:** keep Today scannable—habits/tasks/today's School sessions first, compact stimulation context second, deeper analytics behind routes. Keep Quick Log but remove redundant steps such as opening a second date picker when launched for today. Do not remove cards or reorder modes based on immature telemetry.
13. **[P2] Split oversized files only at behavior seams.** Extract pure parsing, scheduling, aggregation, or view-model functions from the listed hotspots when tests need them. Do not create wrapper abstractions that merely move markup without reducing coupling.
14. **[P2] Confirm dead code before removal.** Use ESLint and `rg` to verify dormant symbols identified in the audit. Delete only when no dynamic/reference path and no migration compatibility need remains; record each removal.

#### UX behavior

Similar actions feel similar across modules. Historical entities archive rather than disappear. Text import and School replan show previews before large changes. Common Home actions are fast, while advanced details remain available. AI-pasted recommendations remain advisory and user-approved.

#### Visual behavior

Use the Phase 6 primitives: consistent forms, archive badges, preview sheets, undo toasts, capacity warnings, and compact contextual links. Long workflows use progressive disclosure rather than more dashboard cards.

#### Data/schema changes

- Journal entries gain `editedAt` and retain creation/template metadata.
- Text progress may move to a compact independently keyed record; import schema gains enforced limits/version validation.
- School sessions explicitly distinguish `manual` and `auto`, retain generator version, and carry capacity-conflict/advisory state outside completed history.
- Legacy School fields remain readable/exportable even if hidden.
- Archive timestamps are used consistently for historical entities.

#### Edge cases

- Habit renamed/archived after logs; schedule changes mid-week; no scheduled habits.
- Journal edit/delete offline and undo after sync begins.
- Text payload exactly at/over limits, duplicate IDs, malformed Unicode, storage quota, and interrupted import.
- Reader closes/backgrounds without a recent write; highlights overlap or are keyboard-created.
- School maximum below one session, multiple tests on one date, weekend preference, past/tonight test, completed/manual sessions, and no feasible schedule.
- AI recommendation has unknown session type, excessive minutes, missing test, or stale test state.
- Screen Time import contains negative/duplicate/unmapped records.

#### Backward compatibility

Do not reinterpret completed historical data. Normalizers default new fields for legacy records. Preserve manual School sessions and all prior results. Preserve existing Text import version support while adding limits and explicit errors. Archived items remain visible in history/export.

#### Validation

- Run aggregate validation and expanded core typecheck for extracted pure domain modules.
- Unit-test habit schedule/streak labels, journal edit/tombstone, Text limits/transaction, reader active time/progress debounce, stimulation validation, and School scheduling/capacity/replan rules.
- Regression-test School result matching from Phase 3.
- E2E one complete happy path and one failure/offline path for every module listed in the feature map.
- Verify each major action emits one correct telemetry event with no content.
- Test archive, permanent delete where allowed, undo, reload, reconnect, and backup/restore.
- Responsive/keyboard/a11y test long Check-in, Text reader, Screen Time preview, School replan, and split editor.
- Manually compare Home totals with source-module records for a fixed fixture week.

#### Definition of Done

- Identified module bugs and dormant/misleading School controls are resolved.
- Destructive/history behavior is consistent and recoverable.
- Large imports and replans are previewed, bounded, and transactional.
- Home/review facts match source modules and selected periods.
- Common actions require no unnecessary intermediate navigation.
- No content leaks into telemetry.

#### Discord completion notification

After domain, offline, archive, telemetry, and cross-module regression checks pass, notify project `DontDie`, phase `7`, name `Module Workflow Consistency and High-Value Product Fixes`. Summarize changes by module and disclose any dormant field retained rather than removed.

### Phase 8 — Motion System, Perceived Performance, and Offline App Shell

#### Objective

Make state changes feel responsive and continuous while reducing initial work, network dependence, storage churn, and animation/blur cost; turn the service worker into a predictable offline shell.

#### Why this phase exists

Motion and performance tuning are safest after route, component, and workflow behavior stabilize. This phase raises perceived quality without hiding slow operations or adding decorative delay.

#### Files / systems involved

- Existing: `style.css`/new `styles/*`, `js/navigation.js`, `js/modes/controller.js`, `js/modes/registry.js`, `js/ui/modal.js`, `toast.js`, `progress.js`, `confetti.js`, module chart/renderers, `js/main.js`, `sw.js`, `index.html`.
- Proposed: `js/ui/motion.js`, `js/ui/transition.js`, `js/performance/measure.js`, `scripts/generate-sw-manifest.mjs`, `manifest.webmanifest`, `assets/fonts/`, `assets/icons/`.
- Proposed tests: `tests/e2e/motion.spec.js`, `tests/e2e/offline-shell.spec.js`, performance-budget script/report.

#### Required changes

1. **[P1] Define one motion contract.** Reuse/refine the existing values: micro feedback around 120–140 ms, standard transitions around 200–220 ms, and large overlay/route transitions around 300–320 ms. Define easing/spring presets by purpose. `js/ui/motion.js` reads the same CSS custom properties or exposes matching constants; remove hard-coded 280 ms coordination from navigation.
2. **[P1] Respect reduced motion behaviorally.** Under `prefers-reduced-motion`, make route/tab/modal changes effectively immediate, disable confetti creation and vibration, stop non-essential chart interpolation, avoid large slide travel, and retain non-motion success/status feedback. Do not rely only on `animation-duration: 0.01ms`.
3. **[P2] Apply motion only to meaningful transitions.** Use transform/opacity for route/tab continuity, modal/sheet elevation, accordions, item insertion/removal, empty→populated state, completion feedback, progress changes, and chart-data updates. Never delay a button result to finish an animation. Avoid animating layout-heavy properties, large blur radii, or long decorative loops.
4. **[P1] Lazy-load by mode.** Split `js/modes/registry.js` into lightweight metadata and dynamic `loadMode()` imports. Load Home initially, load another mode on demand, and prefetch only when idle or when user intent is clear. Within a mode, render active and adjacent swipe panels, not every heavy tab, while preserving keyboard and desktop behavior.
5. **[P2] Avoid destructive rerender churn.** Cache mounted route panels where state revisions have not changed, update focused subtrees for common actions, and preserve scroll/focus. Do not introduce a virtual DOM. Use module revision signals from repositories to decide when a rerender is required.
6. **[P1] Complete immediate local boot.** Show shell and local data promptly, defer noncritical remote reconciliation/telemetry aggregation, and use scoped skeletons only for genuinely absent local sections. A full-screen spinner must not replace usable cached content.
7. **[P2] Reduce write/render hotspots.** Verify the reader debounce and Screen Time batching from Phase 7, batch chart redraws, use event delegation where long lists benefit, and paginate/window only lists that measurements show are large. Do not add virtualization to short lists.
8. **[P1] Make a real offline shell.** Add `manifest.webmanifest` and correctly sized icons. Generate an explicit versioned precache manifest for the HTML, CSS, app entry, essential route modules, local fonts, and icons. Use network-first for HTML with cached fallback, cache-first/stale-while-revalidate for immutable static assets, and never cache Supabase authenticated API responses or notification scripts.
9. **[P1] Add safe service-worker updates.** Replace manually scattered `v20` query/cache values with one generated version. Install new assets atomically, retain the current cache until success, remove only old DontDie cache names, and show an “Update ready” action rather than force-reloading during unsaved work.
10. **[P2] Self-host fonts.** Add licensed WOFF2 subsets for the weights actually used, `font-display: swap`, metric-compatible system fallbacks, and preload only the critical face. Remove Google Fonts runtime dependency.
11. **[P2] Set and measure budgets.** On a representative mid-tier/mobile-emulated profile: local shell/content visible within 1 second after authentication/unlock; common tab input-to-render scripting under 100 ms; no common-action long task over 50 ms; CLS below 0.1; no sustained scroll frame drops on glass screens; and no regression in total initial transferred source. Record baseline and result rather than fabricating unavailable lab precision.
12. **[P1] Preserve and deepen the Phase 2 Split/swipe fixes.** Treat the Phase 2 first-activation Split test and mobile swipe performance trace as regression gates. The later motion abstraction, lazy loading, panel caching, and route transitions must not restore a double-tap requirement, stack gesture listeners, add main-thread work to gesture frames, or reintroduce the removed header mode pill. Compare Phase 8 traces directly with the stored Phase 2 baseline and fix any regression before completion.

#### UX behavior

The last local state appears quickly, tabs and sheets move with clear continuity, successful actions feel tactile, and reduced-motion users get immediate state changes. Offline reload works for previously installed app assets and clearly reports queued sync. Updates wait for user approval.

#### Visual behavior

Motion supports hierarchy: short pressed/completion feedback, standard tab continuity, and slightly larger sheet/modal movement. Glass does not animate blur continuously. Skeletons and content share geometry. Offline/update states use calm shell status rather than blocking overlays.

#### Data/schema changes

No personal-domain change. Service-worker cache schema/version changes and manifest/icon/font assets are added. Mounted panel caches hold derived UI only and must not become a source of truth.

#### Edge cases

- Reduced motion toggled while app is open.
- Rapid repeated navigation, reverse direction mid-transition, resize across breakpoint, and Back during animation.
- Dynamic import fails offline before a mode was ever cached.
- Service-worker install fails mid-precache or old tab uses old module graph.
- Unsynced local changes when update is ready.
- Font unavailable/corrupt, backdrop filter unsupported, low-power GPU.
- Large histories versus ordinary small lists.

#### Backward compatibility

All routes and features remain available without installation. Static hosting remains supported. Existing service-worker users upgrade through a compatible cache transition. No data lives only in mounted UI. The no-animation path is fully functional.

#### Validation

- Run aggregate validation and service-worker manifest consistency check.
- E2E normal and reduced-motion flows; assert confetti/vibration/decorative interpolation are not created in reduced mode.
- E2E rapid/reversed tab navigation and focus/scroll preservation.
- Record dynamic-import/network requests: initial Home must not load every module; first visit to each mode loads and caches it.
- Offline E2E: first online install, then offline reload of every previously visited route; verify uncached routes explain the limitation rather than blanking.
- Test service-worker update with unsaved/outbox data; no forced data loss.
- Measure budgets with browser performance traces at mobile and desktop profiles and compare to the pre-phase baseline.
- Verify fonts are same-origin, licensed/documented, and the app has no Google Fonts request.
- Inspect scrolling/paint on the heaviest charts, long lists, reader, and translucent shell.
- Re-run the Phase 2 Split first-tap/rapid-reversal suite and ten-swipe traces after lazy loading and motion changes; results must meet or improve the Phase 2 baseline.

#### Definition of Done

- Motion tokens and JS coordination are centralized and reduced-motion behavior is explicit.
- Initial Home no longer imports/renders every mode/tab.
- Common interactions meet documented performance budgets or have a measured, recorded exception.
- Installed/offline shell and update flow are predictable.
- Remote fonts and scattered cache-version constants are removed.

#### Discord completion notification

After motion, offline, update, and performance checks pass, notify project `DontDie`, phase `8`, name `Motion System, Perceived Performance, and Offline App Shell`. Include before/after measurements and any budget exception with its reason; do not claim a budget that was not measured.

### Phase 9 — Usage Summaries and AI-Ready Behavioral Export (Phases B and C)

#### Objective

Turn local telemetry into honest, useful summaries and add a privacy-safe “Application usage” section to export so a human or AI can recommend structural changes without seeing sensitive content.

#### Why this phase exists

Raw events are not actionable. This phase comes after stable feature IDs/routes and enough collection plumbing. It surfaces facts and estimates but does not dynamically reorganize the application.

#### Files / systems involved

- Existing: `js/export/collect.js`, `aiReflection.js`, `backup.js`, `download.js`, Global Data & Privacy from Phase 5.
- Proposed: `js/telemetry/aggregate.js`, `summary.js`, `compare.js`, `paths.js`, `export.js`, `js/settings/usageSummary.js`, `js/export/usageSection.js`.
- Proposed tests: `tests/unit/telemetry/summary.test.js`, `tests/unit/export/usageSection.test.js`, `tests/e2e/usage-summary.spec.js`.

#### Required changes

1. **[P1] Define report periods.** Offer last 7, 30, and 90 days plus all retained history. Compare to the immediately preceding equal-length period only when both periods have adequate data. Use local calendar days and state exact coverage/active days.
2. **[P1] Calculate factual metrics:** tracked sessions, active days, feature opens, major successful action counts, last-used timestamp, first/last event in period, and catalogued features with zero use. Separate unavailable/introduced-late features from genuinely unused ones.
3. **[P1] Calculate estimated metrics:** active time by module/feature from `visible-active-estimate`, with rounding and a measurement note. Never call it exact screen time or attention.
4. **[P1] Derive navigation paths carefully.** Count explicit adjacent feature transitions within a session and a bounded time gap. Report pairs or short three-step paths only above a minimum count; do not infer causality. Exclude pre-render and background transitions.
5. **[P1] Derive time-of-day usage.** Use broad local buckets (morning, afternoon, evening, night), state the timezone basis, and avoid minute-level behavioral timelines in the default report.
6. **[P1] Compute trends.** Show increasing/decreasing/stable only when each comparison period has a minimum number of active days/events. Include absolute counts alongside percentage change and suppress division-by-zero sensationalism. Mark this as derived.
7. **[P1] Build a Usage Summary screen.** Show coverage, sessions/active days, most opened, approximate time, most-used actions, least/unused catalog features, common transitions, time-of-day, and trends. Provide measurement definitions and a link to pause/delete/export telemetry. Keep it a readable report, not a gamified dashboard.
8. **[P1] Add an `Application usage` section to compact/full AI Markdown.** Default to aggregates only. Structure it as `Facts`, `Estimates`, `Derived patterns`, `Coverage and limitations`, and `Feature catalog/not used`. Include no raw timestamps or content by default. Let the user opt into a separate raw usage JSON export from Data & Privacy.
9. **[P1] Add a recommendation prompt, not automatic UI changes.** Include a copyable question such as: “Based on this behavior and the stable feature catalog, which parts should be easier to access, moved, merged, simplified, or deprioritized? Separate evidence from speculation and preserve stable core navigation.” The application does not execute or apply recommendations automatically.
10. **[P2] Protect privacy and small samples.** Do not show a “least used” ranking for only one or two active days; instead state insufficient history. Exclude failed-action details beyond bounded categories. Usage exports never join telemetry to journal, check-in, medical, School-answer, text, book-title, activity-name, or AI content.
11. **[P3] Document future personalization safeguards, but do not implement it.** Earliest consideration after at least 30 active days and user review. Allowed future mechanisms: user-pinned widgets, “recently used,” suggested shortcut cards, and explicit accept/reject recommendations. Core modes/tabs never silently reorder; pinned items never move; suggestions can be dismissed/reset; accessibility and a fixed-nav option are mandatory.

#### UX behavior

The owner can understand actual feature usage and export it for analysis. Every number states its period and measurement type. Sparse data produces “not enough history,” not confident advice. Nothing in navigation moves by itself.

#### Visual behavior

Use restrained ranked lists, compact bars, and small trend indicators with textual values. Avoid decorative charts or precision that the data does not support. Facts, estimates, and derived patterns have clear labels. The report uses opaque data surfaces; a high-level summary header may use the established selective glass treatment.

#### Data/schema changes

- Daily/session aggregates gain versioned fields for opens, actions, rounded active-duration estimates, transition counts, and local-time buckets.
- Summary output has a versioned, pure-data schema so Markdown and UI share calculations.
- Backup can include telemetry as a clearly separate opt-in dataset; restore never enables tracking without preserving the user's prior privacy preference.

#### Edge cases

- No telemetry, paused telemetry, cleared history, partial first period, or feature introduced mid-period.
- Session spans midnight/timezone change.
- Prior period has zero use.
- Many one-off transitions or one abnormally long session.
- Retired feature IDs and route aliases.
- Export generated while aggregation is updating or telemetry DB unavailable.

#### Backward compatibility

Existing backup and AI export sections remain; append the versioned usage section. Content-rich full export remains explicit and separately warned. Telemetry absence never blocks other exports. Feature IDs remain stable through label changes.

#### Validation

- Run aggregate validation and core typecheck.
- Unit-test every metric with hand-calculated fixtures, sparse samples, midnight/timezone boundaries, introduced/retired features, and zero denominators.
- Property-test or fixture-test that aggregate totals do not exceed source event counts/durations.
- Snapshot the Markdown usage section and verify Facts/Estimates/Derived/Coverage labels.
- Privacy canary test the UI, aggregate store, Markdown, JSON, clipboard, and Discord notification inputs.
- E2E pause/clear/export and no-history/adequate-history screens.
- Manual prompt review: another AI should be able to make IA recommendations while being explicitly told what is uncertain.
- Confirm no code reorders navigation or dashboard widgets.

#### Definition of Done

- Usage Summary accurately covers frequency, approximate time, paths, time of day, unused features, and trends when statistically supportable.
- AI export contains behavior-only usage context with fact/estimate/derived distinctions.
- Sparse/partial measurements are labeled honestly.
- No sensitive content is present.
- Adaptive UI remains explicitly deferred and core navigation remains stable.

#### Discord completion notification

After metric fixture, privacy, export, and E2E checks pass, notify project `DontDie`, phase `9`, name `Usage Summaries and AI-Ready Behavioral Export (Phases B and C)`. Summarize metrics and safeguards, state that adaptive navigation was not implemented, and include any insufficient-history behavior.

### Phase 10 — Full Regression, Migration Rehearsal, and Release Hardening

#### Objective

Prove the phased system works as one product, rehearse real upgrades/recovery, finish maintainability/documentation work, and produce a trustworthy release baseline.

#### Why this phase exists

Passing isolated phase tests is not enough for a personal operating system with cross-module links and offline data. This final gate catches integration, migration, accessibility, privacy, and performance regressions before declaring the plan complete.

#### Files / systems involved

- Entire repository, all migrations, all test suites, `README.md`, `docs/`, service-worker assets, package scripts, and deployment configuration.
- Proposed: `.github/workflows/validate.yml` if GitHub Actions is the actual host/repository, `docs/data-model.md`, `docs/telemetry.md`, `docs/testing.md`, `docs/release-checklist.md`, `CHANGELOG.md`.
- Proposed: expand `tsconfig.core.json` into `tsconfig.json` for all maintained JavaScript where feasible without blanket suppressions.

#### Required changes

1. **[P0] Rehearse upgrade from a realistic legacy snapshot.** In staging, start from the pre-plan schema/localStorage/service-worker version, populate every module including old habit history, offline operations, archived candidates, texts/books, School results, and stimulation v1 entries. Upgrade through every migration in order and verify normalized counts/content/checksums.
2. **[P0] Rehearse disaster recovery.** Restore the database-level pre-migration backup in an isolated project and restore a new app backup into an empty local/client environment. Document exact recovery time, manual steps, and known limitations.
3. **[P1] Create one cross-module E2E journey.** Authenticate, complete a linked habit, add tasks/check-in/journal, import/read a bounded Text, log and Screen Time-import stimulation, create/plan/complete/import a School result, go offline/reload/reconnect, review Home, produce backup/AI/usage exports, restore into an isolated profile, and verify summaries.
4. **[P1] Expand type safety deliberately.** Add JSDoc types and resolve TypeScript `checkJs` errors across maintained source in behavior-sized batches. Do not use broad `any`, unchecked casts, or repository-wide suppressions to make the command green. If a legacy UI renderer remains excluded, list the exact file and reason in the completion record and keep lint/syntax coverage.
5. **[P1] Make CI authoritative if the repository is hosted on GitHub.** On pull request/push, use the lock file to run syntax, lint, typecheck, unit, E2E smoke, service-worker manifest consistency, and secret scan. CI uses fake Supabase; staging policy tests are a protected/manual job with secrets. The Discord phase notifier is never run on arbitrary pull requests.
6. **[P1] Perform a final accessibility audit.** Cover every route, modal/sheet, reader, chart, validation error, loading state, and conflict/recovery flow at keyboard, screen-reader spot-check, 200% zoom, reduced motion, and forced colors.
7. **[P1] Perform a final privacy/security audit.** Re-run RLS cross-user tests; scan client bundles/source/cache manifest for secrets; verify CSP; verify logout clears sensitive memory/session; confirm telemetry privacy canaries and export warnings; ensure service worker never caches authenticated Supabase responses.
8. **[P1] Perform final responsive/performance audit.** Test 320px through wide desktop, portrait/landscape, safe areas, virtual keyboard, long labels/data, heavy history, offline/slow network, and low-powered CPU/GPU profiles. Compare Phase 8 budgets and document deviations.
9. **[P2] Finish documentation.** Document architecture/data flow, every Supabase migration and rollback/recovery procedure, local IndexedDB schemas, outbox/conflict semantics, feature/event catalog, retention/privacy behavior, testing commands, deployment/service-worker updates, and the safe webhook environment setup. Remove obsolete permissive SQL and false claims such as unconditional offline guarantees.
10. **[P2] Remove compatibility artifacts only with evidence.** After successful legacy upgrade and recovery, remove retained old localStorage keys in a versioned cleanup migration with one final export/notice. Delete legacy CSS/adapters/dead code only when coverage and references prove they are unused. If that proof is not available, leave a documented deprecation rather than risk data loss.
11. **[P2] Create a release checklist and changelog.** Include database backup, migration owner UUID, RLS verification, asset/cache version, telemetry schema, manual smoke, performance/a11y results, rollback path, and notification status.

#### UX behavior

The production upgrade preserves data and muscle memory. The app remains usable offline with honest sync status, and recovery/export flows are demonstrably effective. Users do not encounter new surprise personalization or changed core navigation.

#### Visual behavior

All audited routes and states use the same premium dark system, pass responsive/a11y checks, and retain selective glass/motion fallbacks. The final phase fixes regressions only; it does not introduce a new aesthetic direction.

#### Data/schema changes

Only versioned cleanup migrations proven safe by the rehearsal. Do not make ad hoc schema edits. Record final database, backup, telemetry, and service-worker schema versions in documentation.

#### Edge cases

- Upgrade skipped across several app versions.
- Legacy malformed local data plus valid cloud data.
- Outbox present during service-worker/app migration.
- Rollback to older frontend after new database schema.
- Empty/new account and years of history.
- CI has no production credentials.
- Discord endpoint absent during local validation.

#### Backward compatibility

The rehearsal is the compatibility proof. Database migrations must be forward-safe for the immediately previous deployed client until rollout completes, or deployment must explicitly gate old clients. Preserve legacy backup readers for documented support versions. Core routes receive redirect aliases where needed.

#### Validation

- Clean install: `npm ci && npm run validate`, full typecheck, full Playwright suite.
- Run every migration and verification script against staging from both empty and legacy snapshots.
- Execute cross-module E2E online, offline, slow network, reload, and restore.
- Run automated accessibility plus the manual audit matrix.
- Run RLS/security/CSP/secret/cache tests.
- Capture final performance traces and compare against Phase 8 budgets.
- Verify all documentation commands work on a clean checkout.
- Review every previous phase completion record, deviation, unresolved issue, and Discord status. No unresolved P0/P1 may be silently carried into release.

#### Definition of Done

- Legacy and clean migrations, backup restore, and disaster-recovery rehearsal succeed.
- Full CI/local validation passes with documented evidence.
- Cross-module behavior, offline convergence, telemetry privacy, exports, accessibility, and performance pass together.
- Documentation matches deployed reality.
- No unresolved P0/P1 remains; any P2/P3 deferral has an owner/reason and does not undermine claims.

#### Discord completion notification

After the complete release gate succeeds, notify project `DontDie`, phase `10`, name `Full Regression, Migration Rehearsal, and Release Hardening`. Include the full validation categories, migration/recovery result, success status, and every remaining low-priority deviation. This is a completion message, not a substitute for the release record.

## Claude Execution Protocol

1. Read this entire `plan.md` before starting, including every phase dependency, validation requirement, and the rules below.
2. Execute phases strictly in order. No phase in this plan is independent. Do not begin the next phase while the current phase has a failed required check or unresolved P0/P1 blocker.
3. Before each phase, inspect the relevant current files again. This plan describes the audited starting point; earlier phases will change repository reality.
4. Implement only the behavior described for the phase plus the smallest prerequisite changes. Do not perform opportunistic cross-repository cleanup.
5. Run all validation listed for the phase. Use fake/staging Supabase for destructive/security tests and never run a destructive test against production personal data.
6. Validate autonomously by default. Use Playwright/browser automation, authenticated test fixtures, screenshots, video, traces, DOM assertions, accessibility trees, network inspection, performance measurements, and direct read-only database verification as appropriate. Review the captured evidence yourself. Do not ask the owner to click through or judge a feature that can be exercised and measured with available tools. Human testing is reserved for an irreducible credential boundary, unavailable physical-device capability, destructive production approval, or genuinely subjective product choice; explain why automation cannot answer it before asking. The Phase 1 owner login confirmation is an accepted one-time credential-bound exception and must not become the normal pattern.
7. Fix regressions introduced by the phase before completing it. If a pre-existing unrelated failure is discovered, prove it is pre-existing, record it, and assess its priority; never hide it by weakening a test.
8. At the end of each phase, append a concise completion record immediately below that phase's Discord section using this exact shape:

   ```markdown
   > Completion record
   > - Status: Complete | Blocked
   > - Completed at: ISO-8601 date/time with timezone
   > - Files materially changed: paths
   > - Validation: commands and pass/fail counts
   > - Deviations: None, or exact deviation and reason
   > - Unresolved issues: None, or priority/impact/owner
   > - Discord notification: Sent at timestamp | Not sent (reason)
   ```

9. Before sending any final chat response after a turn in which Claude performed repository, database, Git, deployment, or test work, send exactly one Discord message. If a phase completed, send its normal completion notification. If work stopped incomplete, paused, or blocked, use the server-only `scripts/notify-status.mjs` and label the status truthfully; include work performed, checks, current state, and the next required action. Never call an incomplete phase complete merely to satisfy this notification rule. State the Discord delivery result in the final chat response. Send the notification immediately before the response so the owner knows the work turn is ready for review.
10. Send a phase-completion webhook only after that phase is successfully completed and all required validation passes. Use only `scripts/notify-phase.mjs` with `DONTDIE_DISCORD_WEBHOOK_URL` supplied through the development shell, secret manager, or protected CI environment. Never paste the URL into a command committed to history, source code, browser storage, frontend configuration, test snapshot, log, issue, or `plan.md`. The completion payload must contain: project `DontDie`; completed phase number; phase name; concise summary; tests/checks; `success: true`; blockers or deviations. A paused/blocked status uses the separate status notifier and must not contain completion wording.
11. Continue to the next phase only after updating the completion record and confirming completion-notification delivery. A webhook delivery failure does not invalidate code, but it does prevent the administrative phase-complete state; retry safely without exposing the endpoint.
12. Claude may deviate only when repository reality makes an instruction incorrect, unsafe, or impossible. Choose the smallest sensible deviation, preserve intended product behavior, document evidence and reason, and update affected tests/documentation. Do not repeatedly ask for minor choices already resolved here.
13. Stop and request owner action when new authority is required: Supabase admin access/owner UUID, production migration approval, webhook rotation/secret provisioning, or destructive production recovery. Prepare and validate everything possible in staging first. Never guess secret or production values.
14. Preserve user data before migrations and destructive operations. Prefer archive/tombstone/undo. Never clear localStorage, IndexedDB, Supabase tables, caches outside DontDie's exact namespace, or old backups without an explicit verified migration/recovery step.
15. Keep the architecture buildless/native-ES-module unless measured evidence and a separately approved plan justify a bundler/framework. Do not rewrite the application, replace the dark identity, delete functioning features without evidence, or introduce large dependencies without concrete benefit.
16. Usage telemetry is structural metadata only. Never record or join journal content, notes, check-in/medical values, task/test answers, subjects/titles, activity names, books/texts, AI conversations/prompts/results, or identifying free text. Treat an accidental content event as a privacy bug: stop collection, fix, clear affected local telemetry with owner consent, and document it.
17. Keep facts, estimates, and derived interpretations visibly separate. Stimulation, habit, reading, and check-in data are behavioral proxies; do not label them as biological/medical measurements.
18. Do not implement adaptive navigation during these phases. After at least 30 active days, the owner may request a separate evidence-based plan using pinned/recent/suggested shortcuts. Stable core navigation and user approval are non-negotiable safeguards.

## Final acceptance criteria

Another strong coding agent should be able to execute this plan without choosing a new architecture, analytics provider, design direction, routing model, persistence strategy, security boundary, or personalization behavior. The only intentionally external decisions are production-authority facts that cannot safely be inferred: the Supabase owner UUID/admin approval, secret provisioning/rotation, and final production rollout timing.

The project is not complete merely because it looks more polished. Completion requires verified owner-scoped security, complete recovery, durable local-first behavior, truthful data calculations, privacy-preserving usage evidence, stable navigation, accessible dark design, purposeful motion, measured performance, and a successful end-to-end migration rehearsal.
