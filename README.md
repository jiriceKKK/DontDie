# DontDie · Training Log

A personal habit tracker and workout log for a structured PPL training split. Runs entirely as a static site on GitHub Pages — no backend, no build step.

---

## What it is

A multi-mode health tracker built around a global **command center** plus
mode-specific deep pages (a hybrid layout).

**Home** is the default landing area — an action-first daily surface. Its bottom
nav is global:

- **Today** — the command center: habits (tap to tick), tasks (add/tick inline),
  a compact Cheap-Stim status + fast block logging, today's study sessions
  (collapsed cards), training/split summary, and a check-in nudge.
- **Log** — the full Stimulation logger with a search box + recent activities.
- **Review** — a data-based weekly review with specific, data-driven reflection
  questions (no AI calls); links to the AI reflection export in Settings.
- **Modules** — a launcher into the deep modules below.

A **mode switcher** (top-left) and the Modules page open the deep modules, each
with its own ordered tabs, accent theme and mobile swipe navigation:

- **Physical Health** (green) — Today · Week · Stats · Split · Settings
- **Mind** (calm indigo) — Check-in · Tasks · Texts · Journal · Stats
  (check-in uses anchored scales, a 1–100 sleep score, and an honesty nudge;
  internal mode id / storage stays `mental` to avoid data migrations)
- **Stimulation** (amber) — Dashboard · Log · Activities · Stats · Settings
- **School** (sky blue) — Today · Plan · Tests · Results · Settings

Adding a future mode (Sleep, Nutrition, Focus…) is one entry in
`js/modes/registry.js`. The Home pages live in `js/home/`. A network-first
service worker (`sw.js`) makes new deploys appear on the next reload.

### Stimulation mode

A behaviour-based **estimate** of how stimulated you are across the day — *not*
a biological/medical measurement. You log activities into time blocks; each
activity has a `stimulationScore` and a category. The category decides which
metric the score feeds, so the model keeps **cheap stimulation** and
**productive activation** as two separate numbers instead of one mixed score:

| Category | Feeds | Examples |
|---|---|---|
| `high_stim` / `medium_stim` | **Cheap Stim** (`+score`) | Instagram, TikTok, porn, gaming, binge YouTube |
| `productive_stim` | **Productive Activation** (`+score`) | Gym, OAH/handstand, focused study, coding, school work |
| `recovery` | **Recovery effect** (`score`, negative) | Reading, walk no-phone, journaling, nap |
| `low_stim` | neutral | Cleaning, calm commute, eating no-phone |

Per metric: block value = `Σ(score × durationMinutes / blockMinutes)` over the
activities in that block, daily value = sum of blocks, and each **baseline** is
your recent average daily value (default last 7 days). Because productive
activity never feeds cheap stim, **gym/OAH/study/coding never raise your Cheap
Stim Load or Cheap Stim Baseline** — they raise Productive Activation instead.

The **Dashboard** has a `Cheap Stim · Productive` toggle (segmented control,
session-remembered). It swaps which metric is the main chart — cheap = amber
curve, productive = green curve — each plotted against *its own* baseline **and
a subtle target band** on a shared Y scale, so a small day always reads below a
larger baseline/target. The other metrics stay visible as smaller context cards
(Productive Activation / Cheap Stim Load / Recovery Effect).

**Target range** is a practical, behaviour-based band (*not* a medical target).
When there are ≥4 logged days it's estimated from your *better days* — days that
pair low cheap stim with decent productive activation; otherwise it falls back
to stable defaults (cheap `0–0.8`, productive `1.5–3.5`). Cheap and productive
targets are derived independently, so productive activity never widens the cheap
target. The dashboard shows the range, an `On target / Above / Below` status,
and folds it into the factual summary (e.g. *"Today is within your cheap-stim
target range. That's below your recent baseline (1.2 vs 3.4)."*). Stats shows
cheap-stim and productive trends separately, top activities per metric, and a
factual mood crossover if Mental Health data exists.

**Importing activities from text** (Activities → *Import from text*) — one per line:

```
name | category | score | minutes | tags
Instagram | high_stim | 5 | 15 | scrolling,social
Reading | recovery | -2 | 30 | calm
```

Categories: `high_stim · medium_stim · productive_stim · low_stim · recovery`.
A JSON array of the same fields also works. Invalid lines are reported in a
preview and skipped; duplicates (by name) are skipped on import.

**Screen Time import** (Log → *Import*, or Stimulation Settings) — paste your
iPhone Screen Time list and it becomes stimulation logs. Imports are treated as
**snapshots, not additive logs**: an extract is the running total so far that
day, so re-importing later only adds the *new* minutes. For each app it
reconciles `missing = max(0, screenTimeTotal − alreadyImported − alreadyLogged)`
where *already logged* counts both manual and habit-linked entries — so nothing
is ever double-counted. Pasting the same snapshot twice is detected as a
duplicate; a newer snapshot for the same day reconciles the delta. Ambiguous /
unknown apps go through a **one-tap classifier** (High / Medium / Productive /
Low / Recovery / Ignore) — one tap per app, auto-advancing, with a single
*Confirm import* at the end. Choices are remembered per app (context-sensitive
apps like Safari/YouTube keep a *change* option). Imported entries are tagged
`source: 'screen_time_import'` and shown as **Imported** in the log and chart
popup. The per-app activity is found by name or created once (tagged
`screen-time`), so the core scoring formulas are untouched.

Two input formats are accepted. The **simple** format is one app per line
(`Brawl Stars: 49 min`, `Instagram 1h 12m`, an optional `At 12:45` snapshot
time). The **advanced** format is a structured `DONTDIE_SCREEN_TIME_IMPORT_V1`
JSON block produced by an AI from a Screen Time screenshot — it carries the date,
snapshot time, daily total, source-confidence, per-app `stimulationGuess`, and
optional `hourlyEstimates` / `appTimeBlocks`. If the marker is present the parser
**always** uses the JSON path (smart/curly quotes are normalised first) and never
falls back to the line parser, so the marker line can't be mistaken for an app;
invalid JSON, a wrong `type`, or no apps each show a clear error instead. A
confident `stimulationGuess` auto-maps an app (skipping the classifier); `unknown`
or context-sensitive apps still go one-tap. When `hourlyEstimates` / `appTimeBlocks`
exist the preview offers **Snapshot time** (safe default — one block) or **Spread
across day** (estimated distribution across blocks, entries marked
`estimated: true` with a `timeConfidence`).

**Habit → Stimulation links** (habit editor → *Link to Stimulation*) — a habit
can mirror itself into Stimulation. Ticking *Zone 2 cardio* or *Meditation* adds
the chosen activity (e.g. 60 / 10 min) to the current time block with
`source: 'habit_link'` (shown as **From habit**); unticking removes exactly that
entry and never touches manual logs. No duplicate is created if one already
exists, and Screen Time import treats habit-linked minutes as already logged.

### Physical Health

- **Today tab** — daily habit checklist with optimistic sync
- **Week tab** — 7-day grid overview with per-day completion
- **Stats tab** — weekly bar chart, heatmap (GitHub-style), streak counter, per-habit analytics
- **Split tab** — editable, data-driven weekly plan (Full Week / Gym Only / Mobility) with an in-tab edit mode, a reusable exercise library, and a dynamic weekly-volume summary (direct + indirect sets)
- **Settings tab** — add custom habits, manage built-ins, export/clear data

### Mind

(User-facing name is **Mind**; the internal mode id, folder `js/mental/` and
storage keys stay `mental` so no data/import migration is needed.)

- **Check-in** — one entry per day: mood (emoji + score) plus 1–5 scales for stress, tension, energy, sleep and social, with quick tags and a one-line note
- **Tasks** — temporary, date-based to-dos (Today / Tomorrow), pending/done — not habits
- **Texts** — a guided educational reading habit (see below)
- **Journal** — guided templates (quick reflection, CBT thought record, stress dump, trigger log, what helped / what made it worse, tomorrow reset)
- **Stats** — factual patterns only: mood/stress/energy trends, a per-day task-completion chart, tasks-vs-mood, sleep vs mood, top tags, best/worst weekday, recent-change summary

Mind is data-based and non-clinical — no diagnoses, no advice, no filler.

#### Texts (guided reading)

A quiet reading system. The app **never calls an AI** — it only generates a
prompt, imports structured text produced in your own ChatGPT/Claude chat, stores
it, shows it one at a time, and exports feedback.

Workflow: **Copy generation prompt → paste into your AI chat → paste the five
texts it returns back into the app → Read → tap words / hold sentences to
highlight → submit a short reflection → later Copy feedback for AI** so the next
batch adapts to you.

- **No title browsing.** The queue serves one text at a time in a stable,
  randomized order. A text in progress is *locked* — you continue it, you can't
  skip to another. A completed text never returns.
- **Reader** — focused, single text, comfortable typography for long Czech text,
  restores scroll position, saves progress. Simple elapsed reading time only
  (visible-tab, reading-step only; stops at reflection). No words-per-minute.
- **Highlighting** — one subtle style. Tap a word to toggle it; press-and-hold
  (~460 ms) or double-click a sentence to toggle the whole line. Stored as stable
  `{paragraph, sentence, word}` coordinates, not DOM references.
- **Reflection** is the only completion path — engagement / learning / relevance
  (1–10 with anchor labels), difficulty, length fit, more-like-this, optional note.
- **Highlights viewer** — a vertical scroll-snap reel; each card centres one
  saved highlight with surrounding context fading above and below.
- **Import format** `DONTDIE_TEXTS_IMPORT_V1` — JSON after the marker; schema keys
  stay English, titles/paragraphs use the conversation's language. The app finds
  the block even amid prose, validates it, computes its own word counts and ids,
  and dedupes by a content fingerprint (re-importing the same batch adds nothing).
- **Feedback format** `DONTDIE_TEXTS_FEEDBACK_V1` — an English preamble + JSON of
  ratings, reading time and highlighted quotes. Scopes: new-since-last-export
  (default), current batch, or all completed.
- **Persistence** — dedicated store, localStorage key `dontdie_mind_texts_v1`,
  best-effort sync to the optional `mind_texts_store` Supabase table. If that
  table is absent, Texts works fully offline from localStorage. Full article
  bodies + highlights are included in the raw **backup** export only; the general
  AI-reflection export carries just a privacy-safe summary.

#### Books (physical reading)

A compact section inside Texts for tracking physical books — it never disrupts
the generated-text workflow above it.

- **Add a book** with total pages, estimated words/page and current page.
  Optionally *count pages already read* (creates one explicit baseline event);
  by default the current page is just a baseline and only future reading counts.
- **Update progress** logs a page delta once as a progress event and estimates
  `pageDelta × words/page`. Those estimated words join the big words-read total,
  shown as `generated texts · ≈books` (book words are always marked `≈`
  estimated). Re-submitting the same page or refreshing never double-counts —
  words live inside stored events.
- **Correct current page** is a distinct action that edits the latest event's
  end page (never adds fresh reading); **Delete latest** removes an event and
  restores the page.
- **Goals / milestones** — percentage (standard 25/50/75/100, on by default) or
  page targets. Each reaches exactly once, with a restrained grouped toast;
  completion is one combined message. A correction below a reached milestone
  keeps it historically reached (only an explicit *Reset* reactivates it).
- **Reading time is generated-text only** (labelled "in-app reading"); physical
  book time is never invented, and there is no words-per-minute.
- Stored in the same Texts store (`schemaVersion: 2`, `books: []`); old data
  without books normalizes safely to an empty list. Full book data (events +
  goals) is in the backup export; the reflection export carries a compact,
  text-free per-book summary.

### School

A **science-based study planner** for preparing for tests — not a calendar or
to-do list. It plans *what kind* of study session to do and when, then generates
a high-quality **copy-paste prompt** for Claude. The app itself never calls an AI
and never generates quiz content: you upload your notes/images into a Claude
chat, paste the prompt, and Claude builds the interactive session (often as an
HTML artifact). After a scored session you paste the `APP_RESULT` block back and
the plan adapts.

**Pages:** Today (dashboard) · Plan · Tests · Results · Settings (Subjects live
in Settings).

**Session types** (evidence-based): `diagnostic_quiz`, `active_reading`,
`active_recall`, `flashcards`, `mixed_quiz`, `weak_spots_drill`,
`interleaved_practice`, `final_review`. Each has its own English prompt template
that tells Claude to *"use only the notes, images, screenshots, text and context
already provided in this chat"* — so you never retype subject/source.

**How the plan is built** (`js/school/planner.js`, rule-based & explainable):
the slot's *days-until-test* sets its phase, so one plan naturally progresses —
spaced sessions far out (≥21d) → retrieval mid (8–20d) → drills/quizzes near
(3–7d) → final review last (0–2d, no big new content). Two inputs drive
intensity:

- **Worst acceptable grade (1–5)** — *"the worst grade you can get while still
  keeping the result you want."* 1 = high pressure (denser plan, higher readiness
  threshold, react harder to bad scores); 5 = light plan.
- **Last quiz score** — `<50%` adds foundations + weak-spot drills; `≥85%` shifts
  to interleaving/final review.

**APP_RESULT loop:** scored prompts ask Claude to print an `APP_RESULT … END_APP_RESULT`
block. Paste it (from a session card or the Results page); the parser validates
`session_type`/`score_percent`, extracts weak/strong topics, stores the result,
updates the test's readiness + weak topics, marks the session done, and (if
enabled) regenerates upcoming sessions. Invalid blocks show a clear error and
store nothing. Pasting is optional — you can also just mark a session done.

Stays factual — readiness %, risk level, weak topics, planned vs done. No
motivational filler, no fake certainty, no neuroscience claims.

### Data export (Physical Health → Settings → *Data Export*)

Three whole-app exports (every mode at once) with a time-range selector (Last
7 / 30 / 90 days / All time; default 30 for the AI reports):

- **AI reflection report** (`dontdie_ai_reflection_YYYY-MM-DD.md`) — the main
  one. A Markdown report an AI can read without knowing the app: how-to-read
  notes, plain-English explanations of every module, an executive summary,
  per-module factual summaries (completion rates, mood/stress trends, cheap vs
  productive averages, readiness/weak topics…), cross-module pattern prompts, a
  range-filtered raw-data appendix, and a ready-to-paste analysis prompt. Upload
  your notes into a chat and paste this to discuss your patterns.
- **Compact AI summary** (`dontdie_ai_summary_YYYY-MM-DD.md`) — same report
  without the raw appendix, for when the full file is too large for a chat.
- **Backup JSON** (`dontdie_backup_YYYY-MM-DD.json`) — raw, complete,
  machine-readable, always all-time.

Date-based logs (habit logs, check-ins, tasks, journal, stimulation blocks,
school sessions/results) are filtered to the selected range; configuration
(custom habits, split, activity library, subjects/tests, settings) is always
included in full. The export is **behaviour data only** — it never contains the
Supabase URL/key or any auth/session internals — and explicitly
states it is not medical/diagnostic. Files download via Blob (with an
open-in-new-tab fallback for older iOS). Code lives in `js/export/`.

Data lives in Supabase (free tier is plenty). The app works offline and queues changes for retry.

---

## Setup (5 minutes)

### 1 — Fork or clone this repo

```
git clone https://github.com/YOUR_USERNAME/DontDie
```

### 2 — Create a free Supabase project

Go to [supabase.com](https://supabase.com), create a new project.

### 3 — Create the schema

The schema is **versioned SQL in this repository**, not a snippet to paste from
a README. Apply it with the migration file so the deployed database and the code
always match:

```
supabase/migrations/001_owner_auth_and_rls.sql            the schema + owner-scoped RLS
supabase/verify/001_owner_auth_and_rls.sql                proof the boundary holds
supabase/migrations/002_revision_and_archive_support.sql  server-maintained revision/updated_at
supabase/verify/002_revision_and_archive_support.sql      proof compare-and-set holds
supabase/staging/*.sql                                    staging fixtures (never production)
```

Apply them in order. `002` needs no owner UUID: it adds a `revision` column and
a trigger that maintains `revision`/`updated_at` server-side, so a whole-document
write can be a compare-and-set instead of a last-write-wins overwrite. It is
additive and backward compatible — a client that knows nothing about revisions
still writes successfully.

Steps, in order — the full procedure, including the backup and the staging
rehearsal, is in [`docs/security-deployment.md`](docs/security-deployment.md):

1. Create the owner account: Dashboard → Authentication → Users → Add user.
   Copy its UUID.
2. Take a database-level backup (Dashboard → Database → Backups, or `pg_dump`).
3. Rehearse against a disposable Postgres: `npm run db:verify`.
4. Replace `OWNER_UUID_PLACEHOLDER` in the migration with the owner UUID and run
   the file. It is transactional: any failure rolls everything back.
5. Run the verification file and confirm every check passes.

> **Do not** create these tables with `USING (true)` / `WITH CHECK (true)`
> policies for the `anon` role. Earlier versions of this README documented
> exactly that, which let anyone holding the (public) project URL and anon key
> read and modify every row. The migration above removes those policies and
> replaces them with `auth.uid() = user_id` for the `authenticated` role only.

The `split_config`, `mh_store`, `stimulation_store`, `school_store`,
`habit_config` and `mind_texts_store` tables are optional. Without them those
features still work fully on the device — they just will not sync across
devices. (The reference deployment has no `habit_config` table, and both
migrations skip it explicitly rather than failing.) The migration handles a missing optional table explicitly instead of
failing halfway. Habit IDs never change, so existing `habit_logs` always keep
mapping to the right habit.

### 4 — Fill in `js/config.js`

Open `js/config.js` and replace the placeholder values:

| Setting | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon public |

Both values are **public** — every browser that loads the app can read them.
They are not credentials. Authorization is enforced server-side by the Row Level
Security policies in the migration, keyed on the signed-in owner. Never put a
service-role key, a password, or any webhook URL in `js/config.js` or anywhere
else under `js/`.

### 5 — Enable GitHub Pages

In your repo: **Settings → Pages → Source → main branch → / (root)** → Save.

Your app will be live at `https://YOUR_USERNAME.github.io/DontDie/`.

---

## Signing in, and the device lock

The app authenticates with **Supabase Auth** (owner email + password). The
session is persisted and refreshed automatically, so returning to the app does
not mean signing in again. Every database call runs under that session and is
scoped to the owner by RLS.

Optionally, a **device passcode** can be set on first sign-in. It is a privacy
convenience — it stops someone holding the unlocked phone from reading your
journal — and it is explicitly *not* account security:

- it is per device, set by you, and can be skipped;
- only a salted PBKDF2-SHA-256 verifier is stored locally, never the passcode;
- it requires at least six digits or a passphrase, and throttles failed attempts;
- **it never authorizes a database request.** Cloud data is decided by the
  Supabase session and RLS alone.

Sign out from the lock screen to clear the session and the unlock state.

> Versions before the security baseline used a four-digit PIN whose SHA-256 hash
> — and the PIN itself, in a comment — shipped in `js/config.js`. That was
> readable in downloaded source, trivially brute-forced offline, and it never
> protected Supabase. It has been removed. Treat the old PIN as public and do
> not reuse it.

---

## Adding custom habits

Open the app → **Settings tab** → fill in the name, select which days it applies, pick a color → **Add Habit**.

Custom habits appear alongside the built-in schedule on the relevant days.

---

## Training split reference

| Day | Focus |
|---|---|
| Monday | Push A (Chest · Back · Deltas · Calves) + OAH |
| Tuesday | Legs A (Quads · Glutes) + OAH |
| Wednesday | Pull A (Back · Biceps) |
| Thursday | Push B (Chest · Triceps · Deltas · Calves) + OAH |
| Friday | Pull B (Posterior · Biceps · Deltas) + OAH |
| Saturday | Cardio (HIIT + Zone 2) + Skill |
| Sunday | Active Recovery (Zone 2 + Mobility) |

Mobility runs every day. OAH is skipped Wednesday (CNS rest).

---

## File structure

```
index.html          — app shell, auth gate, navigation skeleton (CSP, no inline script)
style.css           — all styles and animations
js/
  main.js           — entry point: load data, then hand off to the mode controller
  config.js         — public Supabase URL + anon key  ← edit this file
  db.js             — Supabase client and all database functions
  constants.js      — BUILT_IN_HABITS, category maps, day/month names
  state.js          — shared mutable app state (incl. active mode + mental data)
  habits.js         — habit queries, streak/stats computation
  navigation.js     — switchTab(), initSwipe() — mode-agnostic, reads state.modeTabs
  sync.js           — the shell's view of connectivity (offline banner + reconciler)
  data/             — the local-first persistence layer (nothing else touches storage)
    types.js            — JSDoc contracts for documents, logs, outbox, conflicts
    indexedDb.js        — the dontdie_local_v2 database and its transactions
    repository.js       — the facade module stores call
    documentRepository.js — whole-document stores, local write + queued cloud write
    habitRepository.js  — habit logs and custom habits, with tombstones
    outbox.js           — durable queue, collapse rules, backoff
    reconcile.js        — the only place a remote write happens; compare-and-set
    conflicts.js        — both snapshots retained until the owner chooses
    migrations.js       — localStorage to IndexedDB, non-destructively
  auth.js           — the gate: Supabase session, sign in/out, device lock
  session.js        — authenticated session state (owner id, expiry)
  supabaseClient.js — the single shared Supabase client
  deviceLock.js     — optional on-device passcode (PBKDF2, throttled)
  ui/syncStatus.js  — the shell's sync chip and the conflict-recovery sheet
  boot.js           — self-healing bootstrap + service-worker registration
  ui/dom.js         — escapeHtml / safeColor / safeId output-safety helpers
  modes/
    registry.js     — the mode list + their tabs (add a new mode here)
    controller.js   — setMode(), builds nav + panels, mode switcher menu
  mental/           — the "Mind" mode (id stays `mental`)
    store.js        — check-ins / tasks / journal: load/seed/save + CRUD + stats helpers
    journalTemplates.js — guided journal template definitions
    texts/          — guided reading system (Texts tab)
      store.js      — reading library: queue, progress, highlights, reflections, stats
      parser.js     — DONTDIE_TEXTS_IMPORT_V1 parse + fingerprint + tokenizer
      prompts.js    — generation prompt + DONTDIE_TEXTS_FEEDBACK_V1 export
      reader.js     — focused reader overlay: reading timer, progress, reflection
      highlights.js — token render, tap/hold highlighting, highlights reel viewer
    tabs/           — checkin · tasks · texts · journal · stats
  stimulation/
    store.js        — Stimulation data: load/seed/save + CRUD + load/baseline calc + parser + entry sources/link/import helpers
    screenTime.js   — Screen Time import model: tolerant parser, app→category mappings, snapshot reconciliation, duplicate detection
    defaultActivities.js — seed activity library + categories + default settings
    tabs/           — dashboard · log · activities · stats · settings · importScreen (Screen Time import modal flow)
  habitConfig.js    — built-in overrides + custom-habit meta (tags, schedule, stim links)
  habitStimLink.js  — mirrors a linked habit's completion into a Stimulation log
  school/
    store.js        — School data: load/seed/save + subjects/tests/sessions/results CRUD + APP_RESULT parser
    planner.js      — pure rule-based study-session scheduler
    prompts.js      — the 8 English copy-paste prompt templates + buildPrompt()
    sessionTypes.js — session-type metadata (label, minutes, scored, colour)
    util.js         — esc(), copyToClipboard(), parseTopics()
    tabs/           — dashboard (Today) · plan · tests · results · settings (+ _shared.js)
  export/
    collect.js      — whole-app raw data collection + date-range filtering (Set→array, deep clone)
    backup.js       — buildBackup() → complete all-time JSON
    aiReflection.js — buildReflection() → Markdown report: explanations + summaries + appendix + prompt
    download.js     — Blob download with iOS open-in-tab fallback
  utils/
    date.js         — formatDate, parseDate, today, addDays, getMondayOfWeek, …
  ui/
    toast.js        — showToast()
    modal.js        — openModal(), closeModal()
    confetti.js     — launchConfetti()
    progress.js     — updateProgressRing()
  split/
    defaultSplit.js — the migrated default plan (seed only)
    store.js        — split load/seed/save, volume math, exercise/library CRUD
  tabs/
    today.js        — renderToday(), renderTodayHabits(), toggleHabit(), day-log modal
    week.js         — renderWeek()
    stats.js        — renderStats(), bar chart, heatmap, activity, insights
    split.js        — renderSplit(), normal + edit-mode views, gym/mobility edit modals
    settings.js     — renderSettings(), custom habit CRUD, loadHiddenBuiltins()
README.md           — this file
```

### The editable Split

The Split tab is data-driven. The plan (days, gym exercises, mobility work,
exercise library, muscle volume tags, target ranges) lives as one JSON document:

- **at runtime** in `state.split`,
- **persisted** to `localStorage` immediately on every edit, and
- **synced** best-effort to the `split_config` Supabase row (newer `updatedAt` wins).

Tap **✎ Edit** in the Split tab to add/edit/delete gym and mobility exercises,
set planned sets/reps/rest, assign days, organise sections, and manage volume
tags. Each gym exercise can tag multiple muscles as **direct** or **indirect**
(each toggleable on/off for counting); the Gym Only volume summary recomputes
live from planned sets — the big number is direct volume, the small `+n` is
indirect. Mobility uses a flexible **detail** field (sec / rounds / reps / rest)
instead of muscle volume. The first run seeds everything from
`js/split/defaultSplit.js`, after which the UI reads only from the saved plan.

The app uses native ES modules (`<script type="module">`). No build step, no bundler — works directly on GitHub Pages over HTTPS.

---

## Adding a new tab / category

The page system is data-driven, so adding a whole new section (e.g. a "Sleep"
category with its own page) is a few small, local edits — no rewrite:

1. **Create the module** — `js/tabs/sleep.js`, exporting a `renderSleep()` that
   fills `#tab-sleep` (mirror the shape of `tabs/week.js`).
2. **Register the id** — add `'sleep'` to `TAB_ORDER` in `js/constants.js`.
   This alone makes swipe navigation and the pre-render loop include it.
3. **Add the markup** — in `index.html`, add a `<button … data-tab="sleep">` to
   both navs and a `<div class="tab-panel" id="tab-sleep" data-tab="sleep">`
   inside `#tab-slider`.
4. **Wire the render** — import `renderSleep` in `js/main.js` and add it to the
   `renderTab()` dispatcher map.

`switchTab()`, the swipe handler, and nav-button wiring all read from
`TAB_ORDER` and the registered dispatcher, so nothing else needs touching.

---

## Offline behavior

The app is local-first. Everything you see is read from IndexedDB
(`dontdie_local_v2`) before the cloud is contacted, so it renders immediately
and a slow or missing connection never blocks it.

Every change is written locally and queued in a **durable outbox** inside the
same transaction. That is what makes "saved" honest: closing the tab, reloading,
or losing the connection cannot lose a change, because the queue is on disk
rather than in memory. It drains at startup, when the connection returns, and
after each successful write, with bounded backoff in between.

The shell carries one compact status: *saved on this device*, *syncing*,
*offline — saved on this device*, *synced*, *sync failed — retrying*, or
*needs your choice*. It is hidden entirely when everything is in sync.

If the same document changed on two devices, neither copy is discarded. The
status opens a recovery sheet offering **Keep this device**, **Use cloud**, and
**Download both before deciding**. Habit logs are the one exception: they are
independently keyed by date and habit, so they merge automatically, newest
wins, and a delete is never resurrected by a later sync.

Where the browser refuses to give us a database at all (private mode, a blocked
upgrade), the app still runs from its legacy `localStorage` mirror and writes
straight to the cloud — and if neither is available it says the change could
not be saved instead of showing a success it cannot back up.

---

## Security note

The Supabase project URL and anon key in `js/config.js` are published values, and
that is by design — they identify the project, they are not credentials. The
actual boundary is **Row Level Security**: every personal table carries a
`user_id`, and every policy grants access only when `auth.uid() = user_id`. The
`anon` role holds no table privileges at all. Somebody with the URL and the anon
key, but no owner session, can read nothing and write nothing.

The local device lock is a privacy convenience, not authorization — see
"Signing in, and the device lock" above.

Never commit a service-role key, an owner password, a database connection
string, or the Discord webhook. `.env` is git-ignored; `.env.example` carries
variable names only. Run `npm run secretscan` before committing.

Full detail — the boundary, the CSP, migration and rollback procedure, key
rotation, and incident response — is in
[`docs/security-deployment.md`](docs/security-deployment.md).
