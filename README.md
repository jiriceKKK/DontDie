# DontDie · Training Log

A personal habit tracker and workout log for a structured PPL training split. Runs entirely as a static site on GitHub Pages — no backend, no build step.

---

## What it is

- **Today tab** — daily habit checklist with optimistic sync
- **Week tab** — 7-day grid overview with per-day completion
- **Stats tab** — weekly bar chart, heatmap (GitHub-style), streak counter, per-habit analytics
- **Split tab** — full weekly schedule + detailed gym session breakdown
- **Settings tab** — add custom habits, manage built-ins, export/clear data

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

ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_habits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all anon" ON habit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON custom_habits FOR ALL TO anon USING (true) WITH CHECK (true);
```

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
  main.js           — entry point: startApp(), PIN gate, online/offline wiring
  config.js         — Supabase credentials + PIN hash  ← edit this file
  db.js             — Supabase client and all database functions
  constants.js      — BUILT_IN_HABITS, category maps, TAB_ORDER, day/month names
  state.js          — shared mutable app state object
  habits.js         — habit queries, streak/stats computation
  navigation.js     — switchTab(), initSwipe(), registerRenders(), getPanelWidth()
  sync.js           — offline queue, flushQueue(), setOnline()
  auth.js           — PIN hashing, initPin(), isConfigValid()
  utils/
    date.js         — formatDate, parseDate, today, addDays, getMondayOfWeek, …
  ui/
    toast.js        — showToast()
    modal.js        — openModal(), closeModal()
    confetti.js     — launchConfetti()
    progress.js     — updateProgressRing()
  tabs/
    today.js        — renderToday(), renderTodayHabits(), toggleHabit(), day-log modal
    week.js         — renderWeek()
    stats.js        — renderStats(), bar chart, heatmap, activity, insights
    split.js        — renderSplit(), all split/mobility data and sub-renderers
    settings.js     — renderSettings(), custom habit CRUD, loadHiddenBuiltins()
README.md           — this file
```

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
