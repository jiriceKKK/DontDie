# DontDie · Training Log

A personal habit tracker and workout log for a structured PPL training split. Runs entirely as a static site on GitHub Pages — no backend, no build step.

---

## What it is

A multi-mode health tracker. A **mode switcher** (top-left) flips the whole app
— its pages, bottom nav, and accent theme — between modes:

- **Physical Health** (green) — Today · Week · Stats · Split · Settings
- **Mental Health** (calm blue) — Check-in · Tasks · Journal · Stats
- **Stimulation** (amber) — Dashboard · Log · Activities · Stats · Settings
- **School** (sky blue) — Today · Plan · Tests · Results · Settings

Each mode has its own ordered tabs and mobile swipe navigation. Adding a future
mode (Sleep, Nutrition, Focus…) is one entry in `js/modes/registry.js`.

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

### Physical Health

- **Today tab** — daily habit checklist with optimistic sync
- **Week tab** — 7-day grid overview with per-day completion
- **Stats tab** — weekly bar chart, heatmap (GitHub-style), streak counter, per-habit analytics
- **Split tab** — editable, data-driven weekly plan (Full Week / Gym Only / Mobility) with an in-tab edit mode, a reusable exercise library, and a dynamic weekly-volume summary (direct + indirect sets)
- **Settings tab** — add custom habits, manage built-ins, export/clear data

### Mental Health

- **Check-in** — one entry per day: mood (emoji + score) plus 1–5 scales for stress, tension, energy, sleep and social, with quick tags and a one-line note
- **Tasks** — temporary, date-based to-dos (Today / Tomorrow), pending/done — not habits
- **Journal** — guided templates (quick reflection, CBT thought record, stress dump, trigger log, what helped / what made it worse, tomorrow reset)
- **Stats** — factual patterns only: mood/stress/energy trends, a per-day task-completion chart, tasks-vs-mood, sleep vs mood, top tags, best/worst weekday, recent-change summary

Mental Health is data-based and non-clinical — no diagnoses, no advice, no filler.

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

Data lives in Supabase (free tier is plenty). The app works offline and queues changes for retry.

---

## Setup (5 minutes)

### 1 — Fork or clone this repo

```
git clone https://github.com/YOUR_USERNAME/DontDie
```

### 2 — Create a free Supabase project

Go to [supabase.com](https://supabase.com), create a new project.

### 3 — Run the SQL schema

In your Supabase dashboard → **SQL Editor**, paste and run:

```sql
CREATE TABLE habit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  habit_id TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, habit_id)
);

CREATE TABLE custom_habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER[] NOT NULL,
  color TEXT DEFAULT '#6ee7b7',
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Editable training split (single JSON document)
CREATE TABLE split_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT split_config_singleton CHECK (id = 1)
);

-- Mental Health data: check-ins, tasks, journal (single JSON document)
CREATE TABLE mh_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mh_store_singleton CHECK (id = 1)
);

-- Stimulation data: activity library + per-day block logs (single JSON document)
CREATE TABLE stimulation_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT stimulation_store_singleton CHECK (id = 1)
);

-- School study-planner data: subjects, tests, sessions, results (single JSON document)
CREATE TABLE school_store (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT school_store_singleton CHECK (id = 1)
);

ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mh_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE stimulation_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all anon" ON habit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON custom_habits FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON split_config FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON mh_store FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON stimulation_store FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON school_store FOR ALL TO anon USING (true) WITH CHECK (true);
```

> The `split_config`, `mh_store`, `stimulation_store` and `school_store` tables
> are optional. Without them those features still work fully from `localStorage`
> — they just won't sync across devices until the tables exist.

### 4 — Fill in `js/config.js`

Open `js/config.js` and replace the placeholder values:

| Setting | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon public |

The `PIN_HASH` is already set to the hash of `3510`.

### 5 — Enable GitHub Pages

In your repo: **Settings → Pages → Source → main branch → / (root)** → Save.

Your app will be live at `https://YOUR_USERNAME.github.io/DontDie/`.

---

## Changing the PIN

The PIN is never stored in plain text. Only a SHA-256 hash lives in `js/config.js`.

To compute the hash of a new PIN, run this in your browser console:

```javascript
const pin = "YOUR_NEW_PIN";
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
console.log(hex); // paste this into js/config.js as PIN_HASH
```

Replace `PIN_HASH` in `js/config.js` with the output.

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
index.html          — app shell, PIN screen, navigation skeleton
style.css           — all styles and animations
js/
  main.js           — entry point: load data, then hand off to the mode controller
  config.js         — Supabase credentials + PIN hash  ← edit this file
  db.js             — Supabase client and all database functions
  constants.js      — BUILT_IN_HABITS, category maps, day/month names
  state.js          — shared mutable app state (incl. active mode + mental data)
  habits.js         — habit queries, streak/stats computation
  navigation.js     — switchTab(), initSwipe() — mode-agnostic, reads state.modeTabs
  sync.js           — offline queue, flushQueue(), setOnline()
  auth.js           — PIN hashing, initPin(), isConfigValid()
  modes/
    registry.js     — the mode list + their tabs (add a new mode here)
    controller.js   — setMode(), builds nav + panels, mode switcher menu
  mental/
    store.js        — Mental Health data: load/seed/save + CRUD + stats helpers
    journalTemplates.js — guided journal template definitions
    tabs/           — checkin · tasks · journal · stats
  stimulation/
    store.js        — Stimulation data: load/seed/save + CRUD + load/baseline calc + parser
    defaultActivities.js — seed activity library + categories + default settings
    tabs/           — dashboard · log · activities · stats · settings
  school/
    store.js        — School data: load/seed/save + subjects/tests/sessions/results CRUD + APP_RESULT parser
    planner.js      — pure rule-based study-session scheduler
    prompts.js      — the 8 English copy-paste prompt templates + buildPrompt()
    sessionTypes.js — session-type metadata (label, minutes, scored, colour)
    util.js         — esc(), copyToClipboard(), parseTopics()
    tabs/           — dashboard (Today) · plan · tests · results · settings (+ _shared.js)
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

When Supabase is unreachable, a banner appears at the top. Habit toggles still work — changes are queued in memory and retried every 30 seconds automatically. Data is not persisted offline if you close the tab before it syncs.

---

## Security note

The PIN hash in `js/config.js` is visible in the public repo. This is fine — SHA-256 of a 4-digit PIN cannot be reversed in practice without brute-forcing all 10,000 combinations, and the data itself (habit logs) is not sensitive. The PIN just prevents casual access.

If you want stronger security, move the repo to private or use Supabase Row Level Security with a proper auth flow.
